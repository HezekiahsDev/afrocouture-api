import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, resetDatabase, tokenFor } from './helpers/test-app.js';
import { User } from '../src/users/entities/user.entity.js';
import { TailorProfile } from '../src/tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../src/merchants/entities/merchant-profile.entity.js';
import { Fabric, FabricUnit } from '../src/fabrics/entities/fabric.entity.js';
import { Order, OrderStatus } from '../src/orders/entities/order.entity.js';
import { OrderEvent } from '../src/orders/entities/order-event.entity.js';
import {
  EscrowTransaction,
  EscrowTransactionStatus,
  EscrowTransactionType,
} from '../src/escrow/entities/escrow-transaction.entity.js';
import { ChatMessage, ChatMessageType } from '../src/chat/entities/chat-message.entity.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import { AdminAuditLog } from '../src/admin/audit/admin-audit-log.entity.js';
import { KycStatus, UserRole } from '../src/types/index.js';

const PASSWORD = 'Needle2026';

/** The admin console API (docs/rbac.md "Admin console"): access, behaviour and the audit trail. */
describe('Admin console', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
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
  const audit = (action: string, targetId: string) => ds.getRepository(AdminAuditLog).findOne({ where: { action, targetId } });

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    await resetDatabase(app);
    ds = app.get(DataSource);
    const passwordHash = await bcrypt.hash(PASSWORD, 4);

    const mkUser = async (key: string, role: UserRole, extra: Partial<User> = {}) => {
      const users = ds.getRepository(User);
      const user = await users.save(
        users.create({ email: `${key}@admin.test`, fullName: `${key} Person`, role, emailVerified: true, status: 'active', passwordHash, ...extra }),
      );
      ids[key] = user.id;
      t[key] = tokenFor(app, user);
      return user;
    };
    await mkUser('admin', UserRole.ADMIN);
    await mkUser('otherAdmin', UserRole.ADMIN);
    await mkUser('customer', UserRole.CUSTOMER, { fullName: 'Tunde Bakare' });
    await mkUser('victim', UserRole.CUSTOMER, { fullName: 'Kemi Adebayo' });
    const tailor = await mkUser('tailor', UserRole.TAILOR);
    const merchant = await mkUser('merchant', UserRole.MERCHANT);
    await mkUser('alreadySuspended', UserRole.CUSTOMER, { status: 'suspended' });

    ids.tailorProfile = (
      await ds.getRepository(TailorProfile).save(
        ds.getRepository(TailorProfile).create({
          userId: tailor.id, displayName: 'Ngozi Adeyemi', atelierName: 'Ngozi Atelier', city: 'Lagos', kycStatus: KycStatus.APPROVED,
        }),
      )
    ).id;
    ids.pendingTailor = (
      await ds.getRepository(TailorProfile).save(
        ds.getRepository(TailorProfile).create({ displayName: 'Pending Tailor', atelierName: 'Pending Atelier', kycStatus: KycStatus.PENDING }),
      )
    ).id;
    ids.merchantProfile = (
      await ds.getRepository(MerchantProfile).save(
        ds.getRepository(MerchantProfile).create({ userId: merchant.id, businessName: 'Bola Textiles', city: 'Kano', verificationStatus: KycStatus.APPROVED }),
      )
    ).id;
    ids.fabric = (
      await ds.getRepository(Fabric).save(
        ds.getRepository(Fabric).create({
          merchantId: ids.merchantProfile, name: 'Indigo Adire', category: 'Adire', price: 8000, unit: FabricUnit.YARD,
          imageUrl: 'https://res.cloudinary.com/x/f.jpg', isPublished: true,
        }),
      )
    ).id;

    // Orders: one completed (₦100,000, fee ₦5,000, one failed tailor payout), one disputed (₦50,000 held), one requested.
    const mkOrder = async (reference: string, status: OrderStatus, total: number, fee: number, extra: Partial<Order> = {}) =>
      (
        await ds.getRepository(Order).save(
          ds.getRepository(Order).create({
            reference, customerId: ids.customer, tailorId: ids.tailorProfile, tailorUserId: ids.tailor, status,
            garmentType: 'Agbada', brief: 'A navy agbada for a wedding in December.',
            fitSnapshot: { chest: 42, shoulderWidth: 18, sleeveLength: 25, kaftanLength: 40, waist: 34, neck: 15, drapeSilhouette: 'classic_regal', unit: 'in', frontPhotoUrl: null, sidePhotoUrl: null },
            deliveryAddress: { line1: '12 Bourdillon Rd', city: 'Lagos', state: 'Lagos' },
            workmanshipPrice: total - fee, deliveryFee: 0, totalAmount: total, platformFee: fee,
            paidAt: status === OrderStatus.REQUESTED ? null : new Date(),
            ...extra,
          }),
        )
      ).id;
    ids.completed = await mkOrder('AC-DONE01', OrderStatus.COMPLETED, 100000, 5000, { rating: 5, review: 'Great', reviewedAt: new Date() });
    ids.disputed = await mkOrder('AC-DISP01', OrderStatus.DISPUTED, 50000, 2500, { disputeReason: 'Late' });
    ids.requested = await mkOrder('AC-REQ001', OrderStatus.REQUESTED, 0, 0);

    const tx = (orderId: string, type: EscrowTransactionType, status: EscrowTransactionStatus, amount: number, ref: string, partyType = 'tailor') =>
      ds.getRepository(EscrowTransaction).save(
        ds.getRepository(EscrowTransaction).create({ orderId, type, status, amount, reference: ref, partyType, partyId: partyType === 'customer' ? ids.customer : ids.tailorProfile }),
      );
    await tx(ids.completed, EscrowTransactionType.HOLD, EscrowTransactionStatus.SUCCESS, 100000, 'H1', 'customer');
    ids.failedTx = (await tx(ids.completed, EscrowTransactionType.RELEASE_TAILOR, EscrowTransactionStatus.FAILED, 95000, 'R1-AAAAAAAA')).id;
    await tx(ids.disputed, EscrowTransactionType.HOLD, EscrowTransactionStatus.SUCCESS, 50000, 'H2', 'customer');

    await ds.getRepository(OrderEvent).save([
      ds.getRepository(OrderEvent).create({ orderId: ids.completed, type: 'completed', label: 'Order approved' }),
      ds.getRepository(OrderEvent).create({ orderId: ids.disputed, type: 'disputed', label: 'Dispute opened' }),
    ]);
    await ds.getRepository(ChatMessage).save(
      ds.getRepository(ChatMessage).create({ orderId: ids.disputed, senderId: ids.customer, type: ChatMessageType.TEXT, content: 'Where is my agbada?' }),
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('access', () => {
    const routes: [string, string, object?][] = [
      ['get', '/admin/overview'],
      ['get', '/admin/users'],
      ['get', '/admin/users/00000000-0000-4000-8000-000000000000'],
      ['post', '/admin/users/00000000-0000-4000-8000-000000000000/suspend', { reason: 'Testing access' }],
      ['post', '/admin/users/00000000-0000-4000-8000-000000000000/reactivate'],
      ['get', '/admin/orders'],
      ['get', '/admin/orders/00000000-0000-4000-8000-000000000000/messages'],
      ['get', '/admin/fabrics'],
      ['patch', '/admin/fabrics/00000000-0000-4000-8000-000000000000', { isPublished: true }],
      ['get', '/admin/audit'],
    ];
    it.each(routes)('%s %s → 401 without a token', async (method, url, body) => {
      await (as(null) as any)[method](url, body).expect(401);
    });
    it.each(routes)('%s %s → 403 for non-admins', async (method, url, body) => {
      for (const who of ['customer', 'tailor', 'merchant']) await (as(who) as any)[method](url, body).expect(403);
    });
  });

  describe('overview', () => {
    it('summarises users, orders, money, queues and reviews', async () => {
      const { body } = await as('admin').get('/admin/overview').expect(200);
      expect(body.users).toMatchObject({ total: 7, byRole: { customer: 3, tailor: 1, merchant: 1, admin: 2 }, newLast7d: 7, suspended: 1 });
      expect(body.orders.total).toBe(3);
      expect(body.orders.byStatus).toMatchObject({ completed: 1, disputed: 1, requested: 1, paid: 0, refunded: 0 });
      expect(Object.keys(body.orders.byStatus)).toHaveLength(Object.values(OrderStatus).length);
      expect(body.orders.last30d).toHaveLength(30);
      const today = body.orders.last30d.at(-1);
      expect(today).toMatchObject({ count: 3, gmv: 150000 });
      expect(body.orders.last30d[0].date < today.date).toBe(true);
      expect(body.money).toEqual({
        gmv: 150000,
        platformFees: 5000,
        // Completed: 100,000 held − 5,000 fee (failed payout still owed) + disputed 50,000.
        escrowHeld: 145000,
        refunded: 0,
        failedPayouts: { count: 1, amount: 95000 },
      });
      expect(body.queues).toEqual({ pendingVerifications: 1, openDisputes: 1, failedPayouts: 1, hiddenReviews: 0 });
      expect(body.reviews).toEqual({ count: 1, average: 5, last7d: 1 });
      expect(body.recentActivity[0]).toMatchObject({ orderId: expect.any(String), reference: expect.stringMatching(/^AC-/), type: expect.any(String) });
    });
  });

  describe('users', () => {
    it('lists with search, role and status filters, and order counts', async () => {
      let res = await as('admin').get('/admin/users?limit=3').expect(200);
      expect(res.body).toMatchObject({ total: 7, page: 1, limit: 3 });
      expect(res.body.items).toHaveLength(3);
      res = await as('admin').get('/admin/users?q=tunde').expect(200);
      expect(res.body.items).toEqual([expect.objectContaining({ id: ids.customer, orderCount: 3, role: 'customer' })]);
      expect(res.body.items[0]).not.toHaveProperty('passwordHash');
      res = await as('admin').get('/admin/users?role=admin').expect(200);
      expect(res.body.total).toBe(2);
      res = await as('admin').get('/admin/users?status=suspended').expect(200);
      expect(res.body.items.map((u: User) => u.id)).toEqual([ids.alreadySuspended]);
      await as('admin').get('/admin/users?limit=500').expect(400);
      await as('admin').get('/admin/users?role=superuser').expect(400);
    });

    it('shows a user with profiles, stats and recent orders', async () => {
      const { body } = await as('admin').get(`/admin/users/${ids.tailor}`).expect(200);
      expect(body.user).toMatchObject({ id: ids.tailor, role: 'tailor', orderCount: 3, suspendedAt: null });
      expect(body.tailorProfile).toMatchObject({ id: ids.tailorProfile, atelierName: 'Ngozi Atelier' });
      expect(body.merchantProfile).toBeNull();
      expect(body.stats).toEqual({ ordersAsCustomer: 0, ordersAsTailor: 3, spent: 0, earned: 0 });
      expect(body.recentOrders).toHaveLength(3);
      expect(body.recentOrders[0].as).toBe('tailor');
      const customer = await as('admin').get(`/admin/users/${ids.customer}`).expect(200);
      expect(customer.body.stats).toMatchObject({ ordersAsCustomer: 3, spent: 150000 });
      await as('admin').get('/admin/users/00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('cannot suspend yourself or another admin', async () => {
      await as('admin').post(`/admin/users/${ids.admin}/suspend`, { reason: 'Testing self' }).expect(403);
      await as('admin').post(`/admin/users/${ids.otherAdmin}/suspend`, { reason: 'Testing admin' }).expect(403);
      await as('admin').post(`/admin/users/${ids.customer}/suspend`, { reason: 'no' }).expect(400);
      await as('admin').post(`/admin/users/${ids.alreadySuspended}/suspend`, { reason: 'Again please' }).expect(409);
      await as('admin').post(`/admin/users/${ids.customer}/reactivate`).expect(409);
    });

    it('suspending locks the account out everywhere; reactivating restores it', async () => {
      const login = await http.post('/auth/login').send({ email: 'victim@admin.test', password: PASSWORD }).expect(200);
      const { accessToken, refreshToken } = login.body;

      const res = await as('admin').post(`/admin/users/${ids.victim}/suspend`, { reason: 'Repeated chargebacks' }).expect(200);
      expect(res.body).toMatchObject({ id: ids.victim, status: 'suspended' });

      const denied = await http.post('/auth/login').send({ email: 'victim@admin.test', password: PASSWORD }).expect(403);
      expect(denied.body.error).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
      await http.get('/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
      await http.post('/auth/refresh').send({ refreshToken }).expect(401);

      const detail = await as('admin').get(`/admin/users/${ids.victim}`).expect(200);
      expect(detail.body.user).toMatchObject({ status: 'suspended', suspensionReason: 'Repeated chargebacks', suspendedAt: expect.any(String) });
      expect(await audit('user.suspend', ids.victim)).toMatchObject({ adminId: ids.admin, details: { reason: 'Repeated chargebacks' } });

      await as('admin').post(`/admin/users/${ids.victim}/reactivate`).expect(200);
      await http.post('/auth/login').send({ email: 'victim@admin.test', password: PASSWORD }).expect(200);
      // The refresh token from before the suspension stays revoked.
      await http.post('/auth/refresh').send({ refreshToken }).expect(401);
      const after = await as('admin').get(`/admin/users/${ids.victim}`).expect(200);
      expect(after.body.user).toMatchObject({ status: 'active', suspensionReason: null, suspendedAt: null });
      expect(await audit('user.reactivate', ids.victim)).toBeTruthy();
    });
  });

  describe('orders', () => {
    it('pages all orders, newest first, with status lists and search', async () => {
      let res = await as('admin').get('/admin/orders').expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, limit: 20 });
      expect(res.body.items[0]).toMatchObject({ customer: { id: ids.customer, fullName: 'Tunde Bakare' }, tailor: { atelierName: 'Ngozi Atelier' } });
      expect(res.body.items[0].escrow).toEqual(expect.objectContaining({ balance: expect.any(Number) }));
      res = await as('admin').get('/admin/orders?status=disputed,completed').expect(200);
      expect(res.body.items.map((o: Order) => o.reference).sort()).toEqual(['AC-DISP01', 'AC-DONE01']);
      res = await as('admin').get('/admin/orders?q=disp01').expect(200);
      expect(res.body.items.map((o: Order) => o.id)).toEqual([ids.disputed]);
      res = await as('admin').get('/admin/orders?q=tunde&limit=1&page=2').expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 2, limit: 1 });
      expect(res.body.items).toHaveLength(1);
      res = await as('admin').get('/admin/orders?q=ngozi').expect(200);
      expect(res.body.total).toBe(3);
      await as('admin').get('/admin/orders?status=bogus').expect(400);
    });

    it('reads an order chat without joining it', async () => {
      const res = await as('admin').get(`/admin/orders/${ids.disputed}/messages`).expect(200);
      expect(res.body.map((m: ChatMessage) => m.content)).toEqual(['Where is my agbada?']);
      await as('admin').get('/admin/orders/00000000-0000-4000-8000-000000000000/messages').expect(404);
      // Admins still can't post through the member endpoint.
      await as('admin').post(`/orders/${ids.disputed}/messages`, { content: 'hi' }).expect(403);
    });

    it('lists every escrow transaction with status=all', async () => {
      const res = await as('admin').get('/admin/escrow?status=all').expect(200);
      expect(res.body).toHaveLength(3);
      await as('admin').get('/admin/escrow?status=bogus').expect(400);
      const failed = await as('admin').get('/admin/escrow').expect(200);
      expect(failed.body.map((x: EscrowTransaction) => x.id)).toEqual([ids.failedTx]);
    });
  });

  describe('fabric moderation', () => {
    it('unpublishing hides the fabric, locks it, and tells the merchant', async () => {
      await as('admin').patch(`/admin/fabrics/${ids.fabric}`, { isPublished: false }).expect(400); // note required
      const res = await as('admin').patch(`/admin/fabrics/${ids.fabric}`, { isPublished: false, note: 'Photos show a different fabric' }).expect(200);
      expect(res.body).toMatchObject({ isPublished: false, unpublishedReason: 'Photos show a different fabric', merchant: { id: ids.merchantProfile } });

      const pub = await http.get('/fabrics').expect(200);
      expect(pub.body.map((f: Fabric) => f.id)).not.toContain(ids.fabric);
      await http.get(`/fabrics/${ids.fabric}`).expect(404);

      const locked = await as('merchant').patch(`/fabrics/${ids.fabric}`, { isPublished: true });
      expect(locked.status).toBe(409);
      await as('merchant').patch(`/fabrics/${ids.fabric}`, { description: 'Updated photos coming' }).expect(200);

      await new Promise((r) => setTimeout(r, 100));
      const note = await ds.getRepository(Notification).findOne({ where: { userId: ids.merchant, type: 'fabric_moderation' } });
      expect(note).toMatchObject({ link: `/merchant/fabrics/${ids.fabric}` });
      expect(await audit('fabric.unpublish', ids.fabric)).toMatchObject({ details: { note: 'Photos show a different fabric' } });

      const list = await as('admin').get('/admin/fabrics?published=false&q=adire').expect(200);
      expect(list.body).toMatchObject({ total: 1, items: [expect.objectContaining({ id: ids.fabric, isSample: false })] });

      await as('admin').patch(`/admin/fabrics/${ids.fabric}`, { isPublished: true }).expect(200);
      expect((await http.get('/fabrics').expect(200)).body.map((f: Fabric) => f.id)).toContain(ids.fabric);
      expect(await audit('fabric.publish', ids.fabric)).toBeTruthy();
    });
  });

  describe('audit trail', () => {
    it('records verification, review, dispute and payout actions', async () => {
      await as('admin').patch(`/admin/tailors/${ids.pendingTailor}/review`, { decision: 'reject', note: 'ID unreadable' }).expect(200);
      expect(await audit('verification.reject', ids.pendingTailor)).toMatchObject({ targetType: 'tailor', details: { note: 'ID unreadable' } });

      await as('admin').patch(`/admin/reviews/${ids.completed}`, { hidden: true }).expect(200);
      await as('admin').patch(`/admin/reviews/${ids.completed}`, { hidden: false }).expect(200);
      expect(await audit('review.hide', ids.completed)).toBeTruthy();
      expect(await audit('review.unhide', ids.completed)).toBeTruthy();

      await as('admin').post(`/admin/orders/${ids.disputed}/resolve`, { outcome: 'refund', refundAmount: 20000, note: 'Delivered late; partial refund.' }).expect(200);
      expect(await audit('dispute.resolve', ids.disputed)).toMatchObject({ details: { outcome: 'refund', refundAmount: 20000 } });

      // The retry itself may fail again at Paystack (no payout account here); the admin action is still recorded.
      await as('admin').post(`/admin/escrow/${ids.failedTx}/retry`).expect(200);
      expect(await audit('payout.retry', ids.failedTx)).toMatchObject({ targetType: 'escrow_transaction', details: { amount: 95000 } });

      const { body } = await as('admin').get('/admin/audit?limit=3').expect(200);
      expect(body.items).toHaveLength(3);
      expect(body.hasMore).toBe(true);
      expect(body.items[0]).toMatchObject({ admin: { id: ids.admin, email: 'admin@admin.test' }, summary: expect.any(String) });
      const byTarget = await as('admin').get(`/admin/audit?targetType=user&targetId=${ids.victim}`).expect(200);
      expect(byTarget.body.items.map((i: AdminAuditLog) => i.action)).toEqual(['user.reactivate', 'user.suspend']);
      const older = await as('admin').get(`/admin/audit?before=${encodeURIComponent(body.items[2].createdAt)}`).expect(200);
      expect(older.body.items.every((i: AdminAuditLog) => new Date(i.createdAt) < new Date(body.items[2].createdAt))).toBe(true);
    });
  });
});
