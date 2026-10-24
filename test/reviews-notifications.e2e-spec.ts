import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, resetDatabase, tokenFor } from './helpers/test-app.js';
import { PaystackService } from '../src/payments/paystack.service.js';
import { User } from '../src/users/entities/user.entity.js';
import { TailorProfile } from '../src/tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../src/merchants/entities/merchant-profile.entity.js';
import { Fabric, FabricUnit } from '../src/fabrics/entities/fabric.entity.js';
import { KycStatus, UserRole } from '../src/types/index.js';

const PASSWORD = 'Needle2026';

/**
 * Paystack stand-in: payments started with initialize() verify as paid for the same amount,
 * and payouts succeed. Nothing leaves the process.
 */
class FakePaystack {
  private readonly started = new Map<string, { amount: number; metadata: Record<string, unknown> }>();
  get isConfigured() {
    return true;
  }
  assertConfigured() {}
  async initialize(input: { amountKobo: number; reference: string; metadata: Record<string, unknown> }) {
    this.started.set(input.reference, { amount: input.amountKobo, metadata: input.metadata });
    return { authorizationUrl: `https://checkout.test/${input.reference}`, reference: input.reference };
  }
  async verify(reference: string) {
    const tx = this.started.get(reference);
    return { status: tx ? 'success' : 'abandoned', reference, amount: tx?.amount ?? 0, currency: 'NGN', metadata: tx?.metadata ?? null };
  }
  async listBanks() {
    return [];
  }
  async resolveAccount() {
    return 'TEST ACCOUNT';
  }
  async createRecipient() {
    return 'RCP_test';
  }
  async transfer() {
    return { status: 'success', transferCode: 'TRF_test' };
  }
  async refund() {
    return { id: '1', status: 'pending' };
  }
  verifySignature() {
    return false;
  }
}

/** Polls until `check` returns a truthy value (notifications are written just after the response). */
async function eventually<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null | undefined | false;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms (last value: ${JSON.stringify(last)})`);
}

// socket.io-client is a web-app dependency; use it from there when present rather than adding it to the API.
const WEB_PKG = new URL('../../afrocouture-web/package.json', import.meta.url);
/** The slice of socket.io-client this suite uses. */
interface ClientSocket {
  on(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, payload: unknown, ack?: (res: any) => void): void;
  close(): void;
}
const socketClient: { io: (url: string, opts: Record<string, unknown>) => ClientSocket } | null = existsSync(WEB_PKG)
  ? (() => {
      try {
        return createRequire(WEB_PKG)('socket.io-client');
      } catch {
        return null;
      }
    })()
  : null;

interface Note {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  orderId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Reviews on finished orders, the artisan's reply, moderation, and the notification centre. */
describe('Reviews & notifications', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
  let port: number;
  const t: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const as = (who: string | null) => {
    const auth = (req: request.Test) => (who ? req.set('Authorization', `Bearer ${t[who]}`) : req);
    return {
      get: (url: string) => auth(http.get(url)),
      post: (url: string, body: object = {}) => auth(http.post(url).send(body)),
      put: (url: string, body: object = {}) => auth(http.put(url).send(body)),
      patch: (url: string, body: object = {}) => auth(http.patch(url).send(body)),
    };
  };
  const notes = async (who: string, query = 'limit=20'): Promise<{ items: Note[]; unreadCount: number; hasMore: boolean }> =>
    (await as(who).get(`/notifications?${query}`).expect(200)).body;
  const waitForNote = (who: string, match: (n: Note) => boolean) =>
    eventually(async () => (await notes(who, 'limit=50')).items.find(match));
  const unread = async (who: string) => (await as(who).get('/notifications/unread-count').expect(200)).body.unreadCount as number;

  /** Request → quote → pay (fake Paystack) → verify. */
  async function placeAndPay(brief: string, fabrics = true) {
    const { body: order } = await as('customer')
      .post('/orders', { tailorId: ids.tailorProfile, garmentType: 'Agbada', brief, ...(fabrics ? { fabrics: [{ fabricId: ids.fabric, quantity: 2 }] } : {}) })
      .expect(201);
    await as('tailor').post(`/orders/${order.id}/quote`, { workmanshipPrice: 40000, deliveryFee: 5000, estimatedDeliveryDate: '2099-03-01' }).expect(200);
    const { body: pay } = await as('customer').post(`/orders/${order.id}/pay`).expect(200);
    const { body: paid } = await as('customer').post(`/orders/${order.id}/verify-payment`, { reference: pay.reference }).expect(200);
    expect(paid.status).toBe('paid');
    return paid as { id: string; reference: string; items: { id: string }[] };
  }

  beforeAll(async () => {
    app = await createTestApp({ override: (b) => b.overrideProvider(PaystackService).useValue(new FakePaystack()) });
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    http = request(app.getHttpServer());
    await resetDatabase(app);
    ds = app.get(DataSource);
    const passwordHash = await bcrypt.hash(PASSWORD, 4);

    const mkUser = async (key: string, role: UserRole, fullName: string) => {
      const users = ds.getRepository(User);
      const user = await users.save(
        users.create({ email: `${key}@reviews.test`, fullName, role, emailVerified: true, status: 'active', passwordHash }),
      );
      ids[key] = user.id;
      t[key] = tokenFor(app, user);
      return user;
    };
    await mkUser('customer', UserRole.CUSTOMER, 'Tunde Bakare');
    await mkUser('otherCustomer', UserRole.CUSTOMER, 'Kemi Adebayo');
    const tailor = await mkUser('tailor', UserRole.TAILOR, 'Ngozi Adeyemi');
    const merchant = await mkUser('merchant', UserRole.MERCHANT, 'Bola Textiles');
    await mkUser('admin', UserRole.ADMIN, 'Ops Admin');

    const bank = { bankName: 'Guaranty Trust Bank', bankCode: '058', accountNumber: '0123456789', accountName: 'TEST ACCOUNT' };
    ids.tailorProfile = (
      await ds.getRepository(TailorProfile).save(
        ds.getRepository(TailorProfile).create({
          userId: tailor.id, displayName: 'Ngozi Adeyemi', atelierName: 'Ngozi Atelier', city: 'Lagos', kycStatus: KycStatus.APPROVED, ...bank,
        }),
      )
    ).id;
    ids.merchantProfile = (
      await ds.getRepository(MerchantProfile).save(
        ds.getRepository(MerchantProfile).create({
          userId: merchant.id, businessName: 'Bola Textiles', city: 'Kano', verificationStatus: KycStatus.APPROVED, ...bank,
        }),
      )
    ).id;
    ids.fabric = (
      await ds.getRepository(Fabric).save(
        ds.getRepository(Fabric).create({
          merchantId: ids.merchantProfile, name: 'Indigo Wax Print', category: 'Ankara', price: 10000, unit: FabricUnit.YARD,
          imageUrl: 'https://res.cloudinary.com/x/f.jpg', isPublished: true,
        }),
      )
    ).id;
    await as('customer')
      .put('/measurements/me', {
        chest: 42, shoulderWidth: 19.5, sleeveLength: 25, kaftanLength: 58, waist: 34, neck: 16, unit: 'in', drapeSilhouette: 'classic_regal',
        deliveryAddress: { line1: '7 Bourdillon Road, Ikoyi', city: 'Lagos', state: 'Lagos', phone: '+234 801 234 5678' },
      })
      .expect(200);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('order notifications', () => {
    let order: Awaited<ReturnType<typeof placeAndPay>>;

    it('notifies each party as the order moves, linking to the order', async () => {
      order = await placeAndPay('A royal blue agbada with silver embroidery on the chest and sleeves.');
      const requested = await waitForNote('tailor', (n) => n.type === 'order_requested' && n.orderId === order.id);
      expect(requested.link).toBe(`/orders/${order.id}`);
      await waitForNote('tailor', (n) => n.type === 'order_paid' && n.orderId === order.id);
      const quoted = await waitForNote('customer', (n) => n.type === 'order_quoted');
      expect(quoted.title).toContain(order.reference);
      await waitForNote('merchant', (n) => n.type === 'fabric_order' && n.orderId === order.id);
    });

    it('tells the customer about milestones and the merchant about their payout', async () => {
      await as('merchant').post(`/orders/${order.id}/items/${order.items[0].id}/ship`, { note: 'GIG #1' }).expect(200);
      await as('tailor').post(`/orders/${order.id}/items/${order.items[0].id}/receive`).expect(200);
      await as('tailor').post(`/orders/${order.id}/milestone`, { milestone: 'cutting', note: 'Fabric cut today' }).expect(200);
      await waitForNote('customer', (n) => n.type === 'order_milestone' && n.body === 'Fabric cut today');
      const payout = await waitForNote('merchant', (n) => n.type === 'payout');
      expect(payout.body).toMatch(/₦/);
    });

    it('collapses chat messages into one unread notification per order', async () => {
      await as('tailor').post('/notifications/read', { all: true }).expect(200);
      await as('customer').post(`/orders/${order.id}/messages`, { content: 'Can we do the fitting on Friday?' }).expect(201);
      await as('customer').post(`/orders/${order.id}/messages`, { content: 'Afternoon works best for me.' }).expect(201);
      const page = await eventually(async () => {
        const p = await notes('tailor', 'unread=1');
        return p.items.find((n) => n.type === 'chat' && n.body === 'Afternoon works best for me.') ? p : null;
      });
      expect(page.items.filter((n) => n.type === 'chat')).toHaveLength(1);
      expect(page.unreadCount).toBe(1);
      expect(page.items[0].title).toContain('Tunde');

      const { body } = await as('tailor').post('/notifications/read', { orderId: order.id }).expect(200);
      expect(body.unreadCount).toBe(0);
      await as('customer').post(`/orders/${order.id}/messages`, { content: 'Thanks!' }).expect(201);
      await eventually(async () => (await unread('tailor')) === 1);
    });

    it('approving with a rating records the review and the artisan average', async () => {
      await as('tailor').post(`/orders/${order.id}/milestone`, { milestone: 'delivery' }).expect(200);
      await as('tailor').post(`/orders/${order.id}/deliver`, { note: 'Collected in person' }).expect(200);
      const { body } = await as('customer').post(`/orders/${order.id}/approve`, { rating: 4, review: 'Beautiful embroidery, slightly late.' }).expect(200);
      expect(body).toMatchObject({ status: 'completed', rating: 4 });
      expect(body.reviewedAt).toBeTruthy();
      const { body: tailor } = await as(null).get(`/tailors/${ids.tailorProfile}`).expect(200);
      expect(tailor).toMatchObject({ rating: 4, reviewCount: 1 });
      await as('customer').post(`/orders/${order.id}/review`, { rating: 5 }).expect(409);
      ids.order1 = order.id;
    });

    it('lets the artisan reply once, and tells the customer', async () => {
      await as('customer').post(`/orders/${order.id}/review/reply`, { reply: 'Thank you!' }).expect(403);
      const { body } = await as('tailor').post(`/orders/${order.id}/review/reply`, { reply: 'Thank you for your patience, Tunde.' }).expect(200);
      expect(body.reviewReply).toBe('Thank you for your patience, Tunde.');
      await as('tailor').post(`/orders/${order.id}/review/reply`, { reply: 'Again' }).expect(409);
      await waitForNote('customer', (n) => n.type === 'review_reply');
    });
  });

  describe('reviews after a dispute', () => {
    it('notifies admins of a dispute, then allows a late review once settled', async () => {
      const order = await placeAndPay('An Aso Ebi gown in emerald lace with a fitted bodice and flared skirt.', false);
      ids.order2 = order.id;
      await as('customer').post(`/orders/${order.id}/dispute`, { reason: 'The fitting was cancelled twice without notice.' }).expect(200);
      const note = await waitForNote('admin', (n) => n.type === 'admin_dispute' && n.orderId === order.id);
      expect(note.link).toBe(`/admin/orders/${order.id}`);

      await as('customer').post(`/orders/${order.id}/review`, { rating: 2 }).expect(409);
      const { body: resolved } = await as('admin').post(`/admin/orders/${order.id}/resolve`, { outcome: 'release', note: 'Work was completed as agreed.' }).expect(200);
      expect(resolved.status).toBe('completed');

      await as('tailor').post(`/orders/${order.id}/review`, { rating: 2 }).expect(403);
      // Someone else's order: 403 or 404 (see docs/rbac.md), never a review.
      expect([403, 404]).toContain((await as('otherCustomer').post(`/orders/${order.id}/review`, { rating: 2 })).status);
      const { body } = await as('customer').post(`/orders/${order.id}/review`, { rating: 2, review: 'Communication could be better.' }).expect(200);
      expect(body.rating).toBe(2);
      const { body: tailor } = await as(null).get(`/tailors/${ids.tailorProfile}`).expect(200);
      expect(tailor).toMatchObject({ rating: 3, reviewCount: 2 });
      const review = await waitForNote('tailor', (n) => n.type === 'review');
      expect(review.title).toContain('2-star');
    });
  });

  describe('public reviews', () => {
    it('lists newest first with the breakdown, reviewer initials and replies, nothing private', async () => {
      const { body } = await as(null).get(`/tailors/${ids.tailorProfile}/reviews`).expect(200);
      expect(body.items.map((r: { id: string }) => r.id)).toEqual([ids.order2, ids.order1]);
      expect(body.breakdown).toMatchObject({ 4: 1, 2: 1, 5: 0 });
      expect(body.items.every((r: { reviewerName: string }) => r.reviewerName === 'Tunde B.')).toBe(true);
      expect(body.items[1].reply).toBe('Thank you for your patience, Tunde.');
      expect(JSON.stringify(body)).not.toMatch(/customerId|email|deliveryAddress|fitSnapshot|totalAmount/);
    });

    it('paginates and 404s for unknown artisans', async () => {
      const first = (await as(null).get(`/tailors/${ids.tailorProfile}/reviews?limit=1`).expect(200)).body;
      expect(first.hasMore).toBe(true);
      const next = (await as(null).get(`/tailors/${ids.tailorProfile}/reviews?limit=1&before=${encodeURIComponent(first.items[0].reviewedAt)}`).expect(200)).body;
      expect(next.items.map((r: { id: string }) => r.id)).toEqual([ids.order1]);
      await as(null).get('/tailors/00000000-0000-4000-8000-000000000000/reviews').expect(404);
    });
  });

  describe('moderation', () => {
    it('hiding a review removes it from the profile and the average; unhiding restores it', async () => {
      await as('customer').patch(`/admin/reviews/${ids.order2}`, { hidden: true }).expect(403);
      const { body } = await as('admin').patch(`/admin/reviews/${ids.order2}`, { hidden: true }).expect(200);
      expect(body.reviewHiddenAt).toBeTruthy();
      expect((await as(null).get(`/tailors/${ids.tailorProfile}`).expect(200)).body).toMatchObject({ rating: 4, reviewCount: 1 });
      const pub = (await as(null).get(`/tailors/${ids.tailorProfile}/reviews`).expect(200)).body;
      expect(pub.items.map((r: { id: string }) => r.id)).toEqual([ids.order1]);
      const admin = (await as('admin').get('/admin/reviews').expect(200)).body;
      expect(admin.items).toContainEqual(expect.objectContaining({ id: ids.order2, customer: expect.objectContaining({ fullName: 'Tunde Bakare' }) }));
      expect((await as('customer').get(`/orders/${ids.order2}`).expect(200)).body.reviewHiddenAt).toBeTruthy();

      await as('admin').patch(`/admin/reviews/${ids.order2}`, { hidden: false }).expect(200);
      expect((await as(null).get(`/tailors/${ids.tailorProfile}`).expect(200)).body).toMatchObject({ rating: 3, reviewCount: 2 });
    });
  });

  describe('notification centre access', () => {
    it('requires sign-in and only touches your own notifications', async () => {
      await as(null).get('/notifications').expect(401);
      const mine = (await notes('customer')).items[0];
      await as('tailor').post('/notifications/read', { ids: [mine.id] }).expect(200);
      expect((await notes('customer', 'unread=1&limit=50')).items.map((n) => n.id)).toContain(mine.id);
    });

    it('validates input, paginates, and marks everything read', async () => {
      await as('customer').post('/notifications/read', { ids: ['not-a-uuid'] }).expect(400);
      await as('customer').get('/notifications?limit=500').expect(400);
      const first = await notes('customer', 'limit=2');
      expect(first.hasMore).toBe(true);
      const older = await notes('customer', `limit=2&before=${encodeURIComponent(first.items[1].createdAt)}`);
      expect(older.items.length).toBeGreaterThan(0);
      expect(older.items.some((n) => first.items.some((f) => f.id === n.id))).toBe(false);
      const { body } = await as('customer').post('/notifications/read', { all: true }).expect(200);
      expect(body.unreadCount).toBe(0);
    });
  });

  describe.skipIf(!socketClient)('live push over the socket', () => {
    it('pushes new notifications, and skips chat notifications while the chat is open', async () => {
      const socket = socketClient!.io(`http://127.0.0.1:${port}/chat`, { transports: ['websocket'], auth: { token: t.tailor }, forceNew: true });
      const pushed: { notification: Note; unreadCount: number }[] = [];
      socket.on('notification', (p: { notification: Note; unreadCount: number }) => pushed.push(p));
      try {
        await new Promise<void>((resolve, reject) => {
          socket.on('connect', () => resolve());
          socket.on('connect_error', reject);
        });

        const { body: order } = await as('customer')
          .post('/orders', { tailorId: ids.tailorProfile, garmentType: 'Kaftan', brief: 'A white linen kaftan with subtle gold piping on the placket.' })
          .expect(201);
        const push = await eventually(async () => pushed.find((p) => p.notification.type === 'order_requested' && p.notification.orderId === order.id));
        expect(push.unreadCount).toBeGreaterThan(0);

        // With the order room open, a new message raises no notification.
        const joined = await new Promise<{ ok: boolean }>((resolve) => socket.emit('join_order', { orderId: order.id }, resolve));
        expect(joined.ok).toBe(true);
        await as('tailor').post('/notifications/read', { all: true }).expect(200);
        await as('customer').post(`/orders/${order.id}/messages`, { content: 'See you Friday' }).expect(201);
        await new Promise((r) => setTimeout(r, 400));
        expect(await unread('tailor')).toBe(0);

        // After leaving, the next message does.
        await new Promise((resolve) => socket.emit('leave_order', { orderId: order.id }, resolve));
        await as('customer').post(`/orders/${order.id}/messages`, { content: 'One more thing' }).expect(201);
        await eventually(async () => pushed.find((p) => p.notification.type === 'chat' && p.notification.body === 'One more thing'));
      } finally {
        socket.close();
      }
    });
  });
});
