import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, resetDatabase, tokenFor } from './helpers/test-app.js';
import { User } from '../src/users/entities/user.entity.js';
import { TailorProfile } from '../src/tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../src/merchants/entities/merchant-profile.entity.js';
import { Fabric, FabricUnit } from '../src/fabrics/entities/fabric.entity.js';
import { Order, OrderStatus } from '../src/orders/entities/order.entity.js';
import { OrderItem } from '../src/orders/entities/order-item.entity.js';
import { AiDesign } from '../src/ai-studio/entities/ai-design.entity.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import { KycStatus, UserRole } from '../src/types/index.js';

/**
 * Route × role matrix (docs/rbac.md): unauthenticated → 401 unless public, wrong role → 403,
 * someone else's resource → 403/404, the right person → 2xx, and nothing private leaks.
 */
describe('RBAC', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const t: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const as = (who: string | null) => {
    const auth = (req: request.Test) => (who ? req.set('Authorization', `Bearer ${t[who]}`) : req);
    return {
      get: (url: string) => auth(http.get(url)),
      post: (url: string, body: object = {}) => auth(http.post(url).send(body)),
      put: (url: string, body: object = {}) => auth(http.put(url).send(body)),
      patch: (url: string, body: object = {}) => auth(http.patch(url).send(body)),
      delete: (url: string) => auth(http.delete(url)),
    };
  };

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    await resetDatabase(app);
    const ds = app.get(DataSource);

    const mkUser = async (key: string, role: UserRole, extra: Partial<User> = {}) => {
      const user = await ds.getRepository(User).save(
        ds.getRepository(User).create({ email: `${key}@rbac.test`, fullName: `${key} Test`, role, emailVerified: true, status: 'active', ...extra }),
      );
      ids[key] = user.id;
      t[key] = tokenFor(app, user);
      return user;
    };
    await mkUser('customer', UserRole.CUSTOMER);
    await mkUser('otherCustomer', UserRole.CUSTOMER);
    const tailor = await mkUser('tailor', UserRole.TAILOR);
    const otherTailor = await mkUser('otherTailor', UserRole.TAILOR);
    const merchant = await mkUser('merchant', UserRole.MERCHANT);
    const otherMerchant = await mkUser('otherMerchant', UserRole.MERCHANT);
    await mkUser('admin', UserRole.ADMIN);
    await mkUser('suspended', UserRole.CUSTOMER, { status: 'suspended' });
    await mkUser('unverified', UserRole.CUSTOMER, { emailVerified: false });

    const tailorProfile = (userId: string, name: string) =>
      ds.getRepository(TailorProfile).save(
        ds.getRepository(TailorProfile).create({
          userId, displayName: name, atelierName: `${name} Atelier`, city: 'Lagos', kycStatus: KycStatus.APPROVED,
          legalName: `${name} Legal`, idDocumentUrl: 'https://res.cloudinary.com/x/id.jpg', workshopAddress: '1 Secret St',
          bankName: 'Bank', bankCode: '058', accountNumber: '0123456789', accountName: 'Legal Name',
        }),
      );
    ids.tailorProfile = (await tailorProfile(tailor.id, 'Ngozi')).id;
    await tailorProfile(otherTailor.id, 'Bisi');
    const merchantProfile = (userId: string, name: string) =>
      ds.getRepository(MerchantProfile).save(
        ds.getRepository(MerchantProfile).create({
          userId, businessName: name, city: 'Kano', verificationStatus: KycStatus.APPROVED, cacNumber: 'RC123',
          bankName: 'Bank', bankCode: '058', accountNumber: '9876543210', accountName: name,
        }),
      );
    ids.merchantProfile = (await merchantProfile(merchant.id, 'Bola Textiles')).id;
    await merchantProfile(otherMerchant.id, 'Kano Weaves');
    const fabric = await ds.getRepository(Fabric).save(
      ds.getRepository(Fabric).create({
        merchantId: ids.merchantProfile, name: 'Indigo Adire', category: 'Adire', price: 8000, unit: FabricUnit.YARD,
        imageUrl: 'https://res.cloudinary.com/x/f.jpg', isPublished: true,
      }),
    );
    ids.fabric = fabric.id;

    const mkOrder = async (reference: string, paid: boolean) => {
      const order = await ds.getRepository(Order).save(
        ds.getRepository(Order).create({
          reference, customerId: ids.customer, tailorId: ids.tailorProfile, tailorUserId: ids.tailor,
          status: paid ? OrderStatus.PAID : OrderStatus.REQUESTED, paidAt: paid ? new Date() : null,
          garmentType: 'Agbada', brief: 'A navy agbada for a wedding in December.', referenceImageUrls: ['https://res.cloudinary.com/x/ref.jpg'],
          fitSnapshot: { chest: 42, shoulderWidth: 18, sleeveLength: 25, kaftanLength: 40, waist: 34, neck: 15, drapeSilhouette: 'classic_regal', unit: 'in', frontPhotoUrl: null, sidePhotoUrl: null },
          deliveryAddress: { line1: '12 Bourdillon Rd', city: 'Lagos', state: 'Lagos' },
          workmanshipPrice: 50000, deliveryFee: 5000, fabricTotal: 24000, totalAmount: 79000,
        }),
      );
      await ds.getRepository(OrderItem).save(
        ds.getRepository(OrderItem).create({
          orderId: order.id, fabricId: fabric.id, merchantId: ids.merchantProfile, fabricName: fabric.name,
          imageUrl: fabric.imageUrl, unit: 'yard', quantity: 3, unitPrice: 8000, lineTotal: 24000,
        }),
      );
      return order.id;
    };
    ids.order = await mkOrder('AC-RBAC01', true);
    ids.unpaidOrder = await mkOrder('AC-RBAC02', false);

    ids.design = (
      await ds.getRepository(AiDesign).save(
        ds.getRepository(AiDesign).create({
          userId: ids.customer, prompt: 'Navy agbada', options: {}, imageUrls: ['https://res.cloudinary.com/x/d.jpg'],
          selectedIndex: 0, model: 'test', aspectRatio: '3:4', saved: false,
        }),
      )
    ).id;
    ids.notification = (
      await ds.getRepository(Notification).save(
        ds.getRepository(Notification).create({ userId: ids.customer, type: 'order_quoted', title: 'Quote ready' }),
      )
    ).id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('public routes need no token', () => {
    it.each([
      '/', '/tailors', '/fabrics', '/fabrics/categories', '/styles',
    ])('GET %s', async (url) => {
      await as(null).get(url).expect(200);
    });

    it('artisan, fabric and review pages', async () => {
      await as(null).get(`/tailors/${ids.tailorProfile}`).expect(200);
      await as(null).get(`/tailors/${ids.tailorProfile}/reviews`).expect(200);
      await as(null).get(`/fabrics/${ids.fabric}`).expect(200);
    });

    it('health is reachable without a token', async () => {
      const res = await as(null).get('/health');
      expect([200, 503]).toContain(res.status);
    });

    it('the Paystack webhook still demands a signature', async () => {
      await as(null).post('/payments/paystack/webhook', { event: 'charge.success' }).expect(401);
    });
  });

  describe('everything else needs a token', () => {
    it.each([
      ['get', '/auth/me'], ['post', '/auth/logout'], ['patch', '/users/me'], ['patch', '/users/me/role'],
      ['post', '/uploads?purpose=chat'], ['get', '/tailors/me/profile'], ['put', '/tailors/me/profile'],
      ['post', '/tailors/me/submit'], ['get', '/merchants/me/profile'], ['get', '/measurements/me'],
      ['get', '/saved'], ['get', '/orders'], ['post', '/orders'], ['get', '/ai-studio/quota'],
      ['get', '/ai-studio/designs'], ['get', '/notifications'], ['post', '/notifications/read'],
      ['get', '/fabrics/mine'], ['post', '/fabrics'], ['get', '/payments/resolve-account'],
      ['get', '/admin/verifications'], ['get', '/admin/orders'], ['get', '/admin/reviews'], ['get', '/admin/escrow'],
      ['get', '/surveys/me'], ['get', '/surveys/me/status'], ['put', '/surveys/me/answers'], ['post', '/surveys/me/complete'],
      ['post', '/surveys/me/dismiss'], ['get', '/admin/surveys'], ['get', '/admin/surveys/customer-v1/export.csv'],
    ] as const)('%s %s → 401', async (method, url) => {
      await as(null)[method](url).expect(401);
    });

    it('order-scoped routes → 401', async () => {
      await as(null).get(`/orders/${ids.order}`).expect(401);
      await as(null).get(`/orders/${ids.order}/messages`).expect(401);
      await as(null).post(`/orders/${ids.order}/approve`, { rating: 5 }).expect(401);
    });

    it('a forged or garbage token → 401', async () => {
      await http.get('/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });
  });

  describe('account status is checked on every request', () => {
    it('suspended accounts are refused even with a valid token', async () => {
      const res = await as('suspended').get('/auth/me').expect(401);
      expect(res.body.error).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    });

    it('unverified accounts are refused', async () => {
      const res = await as('unverified').get('/auth/me').expect(401);
      expect(res.body.error).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    });

    it('the role comes from the database, not the token', async () => {
      // A token claiming admin for a customer account must not open admin routes.
      const forged = tokenFor(app, { id: ids.customer, email: 'customer@rbac.test', role: UserRole.ADMIN });
      await http.get('/admin/verifications').set('Authorization', `Bearer ${forged}`).expect(403);
    });
  });

  describe('wrong role → 403', () => {
    const forbidden: [string, 'get' | 'post' | 'put' | 'patch', string, object?][] = [
      ['customer', 'get', '/admin/verifications'],
      ['tailor', 'get', '/admin/orders'],
      ['merchant', 'get', '/admin/reviews'],
      ['customer', 'get', '/admin/escrow'],
      ['customer', 'get', '/tailors/me/profile'],
      ['merchant', 'get', '/tailors/me/profile'],
      ['customer', 'get', '/merchants/me/profile'],
      ['tailor', 'get', '/merchants/me/profile'],
      ['customer', 'get', '/fabrics/mine'],
      ['tailor', 'post', '/fabrics', { name: 'x' }],
      ['tailor', 'get', '/measurements/me'],
      ['merchant', 'get', '/measurements/me'],
      ['admin', 'get', '/measurements/me'],
      ['tailor', 'post', '/orders', {}],
      ['merchant', 'post', '/orders', {}],
      ['admin', 'post', '/orders', {}],
      ['customer', 'get', '/payments/resolve-account?accountNumber=0123456789&bankCode=058'],
      ['admin', 'patch', '/users/me/role', { role: 'customer' }],
      ['customer', 'post', '/uploads?purpose=tailor-kyc'],
      ['customer', 'post', '/uploads?purpose=merchant-verification'],
      ['tailor', 'post', '/uploads?purpose=fit-photo'],
      ['customer', 'post', '/uploads?purpose=fabric'],
      ['merchant', 'post', '/uploads?purpose=chat'],
      ['admin', 'post', '/uploads?purpose=chat'],
      ['admin', 'get', '/surveys/me'],
      ['admin', 'put', '/surveys/me/answers', { answers: {} }],
      ['customer', 'get', '/admin/surveys'],
      ['tailor', 'get', '/admin/surveys/tailor-v1/responses'],
      ['merchant', 'get', '/admin/surveys/merchant-v1/export.csv'],
    ];
    it.each(forbidden)('%s %s %s', async (who, method, url, body) => {
      await as(who)[method](url, body ?? {}).expect(403);
    });

    it.each([
      ['customer', 'quote'], ['merchant', 'quote'], ['tailor', 'approve'], ['merchant', 'dispute'],
      ['customer', 'deliver'], ['tailor', 'pay'], ['admin', 'approve'],
    ])('%s cannot %s an order', async (who, action) => {
      await as(who).post(`/orders/${ids.order}/${action}`, {}).expect(403);
    });
  });

  describe('surveys are scoped to the caller’s role', () => {
    it('each member gets the form for their database role', async () => {
      for (const [who, survey] of [['customer', 'customer-v1'], ['tailor', 'tailor-v1'], ['merchant', 'merchant-v1']]) {
        const res = await as(who).get('/surveys/me').expect(200);
        expect(res.body.survey.id).toBe(survey);
      }
    });

    it('answers must belong to that form and to the questions currently shown', async () => {
      const other = await as('customer').put('/surveys/me/answers', { answers: { listing_info: { value: ['material'] } } }).expect(400);
      expect(other.body.error).toMatchObject({ code: 'SURVEY_INVALID_ANSWER', question: 'listing_info' });
      // custom_order_flow is only asked when usage involves a tailor.
      await as('customer').put('/surveys/me/answers', { answers: { usage: { value: 'fabrics' }, custom_order_flow: { value: 'yes' } } }).expect(400);
      await as('customer').put('/surveys/me/answers', { answers: { usage: { value: 'find_tailor' }, custom_order_flow: { value: 'yes' } } }).expect(200);
      const incomplete = await as('customer').post('/surveys/me/complete').expect(400);
      expect(incomplete.body.error).toMatchObject({ code: 'SURVEY_INCOMPLETE' });
      expect(incomplete.body.error.missing).toContain('navigation');
    });

    it('a submitted response is visible to admins and exported to CSV, never to other members', async () => {
      await as('customer').put('/surveys/me/answers', {
        answers: {
          navigation: { value: 'easy' }, discovery: { value: 'easy' }, trust_info: { value: ['reviews'] },
          hesitations: { value: ['nothing'] }, escrow_comfort: { value: 'very' }, ordering_clarity: { value: 'very_clear' },
          had_problem: { value: 'no' }, improvements: { value: ['=cmd|calc', '', ''] },
        },
      }).expect(200);
      await as('customer').post('/surveys/me/complete').expect(200);
      expect((await as('customer').get('/surveys/me/status').expect(200)).body).toMatchObject({ completed: true });
      // The other customer has their own, empty response.
      expect((await as('otherCustomer').get('/surveys/me').expect(200)).body.response).toBeNull();

      const list = await as('admin').get('/admin/surveys/customer-v1/responses?status=completed').expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].user).toMatchObject({ email: 'customer@rbac.test' });
      await as('admin').get(`/admin/surveys/responses/${list.body.items[0].id}`).expect(200);

      const csv = await as('admin').get('/admin/surveys/customer-v1/export.csv').expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('customer@rbac.test');
      expect(csv.text).toContain(`"'=cmd|calc"`);
    });
  });

  describe("someone else's resources", () => {
    it('another customer or artisan cannot see the order', async () => {
      await as('otherCustomer').get(`/orders/${ids.order}`).expect(404);
      await as('otherTailor').get(`/orders/${ids.order}`).expect(404);
      await as('otherMerchant').get(`/orders/${ids.order}`).expect(404);
    });

    it('nor act on it', async () => {
      await as('otherCustomer').post(`/orders/${ids.order}/dispute`, { reason: 'Not mine but let me try' }).expect(404);
      await as('otherTailor').post(`/orders/${ids.order}/milestone`, { milestone: 'cutting' }).expect(404);
    });

    it('nor read or write its chat', async () => {
      await as('otherCustomer').get(`/orders/${ids.order}/messages`).expect(403);
      await as('otherTailor').post(`/orders/${ids.order}/messages`, { content: 'hello' }).expect(403);
      await as('merchant').get(`/orders/${ids.order}/messages`).expect(403);
    });

    it("AI designs are private to their owner", async () => {
      await as('otherCustomer').get(`/ai-studio/designs/${ids.design}`).expect(404);
      await as('otherCustomer').patch(`/ai-studio/designs/${ids.design}`, { saved: true }).expect(404);
      await as('otherCustomer').delete(`/ai-studio/designs/${ids.design}`).expect(404);
    });

    it("a merchant cannot edit another merchant's fabric", async () => {
      await as('otherMerchant').patch(`/fabrics/${ids.fabric}`, { name: 'Hijacked listing' }).expect(403);
      await as('otherMerchant').delete(`/fabrics/${ids.fabric}`).expect(403);
    });

    it("marking someone else's notification read does nothing", async () => {
      await as('otherCustomer').post('/notifications/read', { ids: [ids.notification] }).expect(200);
      const res = await as('customer').get('/notifications/unread-count').expect(200);
      expect(res.body.unreadCount).toBe(1);
    });
  });

  describe('the right person gets in — and only sees what they should', () => {
    it('the customer and artisan see the full order, including measurements', async () => {
      for (const who of ['customer', 'tailor']) {
        const res = await as(who).get(`/orders/${ids.order}`).expect(200);
        expect(res.body.fitSnapshot).toMatchObject({ chest: 42 });
      }
      await as('customer').get(`/orders/${ids.order}/messages`).expect(200);
    });

    it('the fabric merchant sees their lines and the atelier, never the customer', async () => {
      const res = await as('merchant').get(`/orders/${ids.order}`).expect(200);
      expect(res.body.viewerRole).toBe('merchant');
      for (const key of ['fitSnapshot', 'deliveryAddress', 'customer', 'brief', 'referenceImageUrls']) {
        expect(res.body).not.toHaveProperty(key);
      }
      const list = await as('merchant').get('/orders').expect(200);
      expect(list.body.map((o: { id: string }) => o.id)).toEqual([ids.order]); // unpaid order hidden
      expect(list.body[0].customer.fullName).toBeNull();
      expect(list.body[0].referenceImageUrls).toEqual([]);
    });

    it('a merchant cannot see an order before it is paid', async () => {
      await as('merchant').get(`/orders/${ids.unpaidOrder}`).expect(404);
    });

    it('admins reach every admin route and any order', async () => {
      for (const url of ['/admin/verifications', '/admin/orders', '/admin/reviews', '/admin/escrow', `/admin/orders/${ids.order}`]) {
        await as('admin').get(url).expect(200);
      }
      await as('admin').get(`/orders/${ids.order}`).expect(200);
    });

    it('role-scoped profile routes', async () => {
      await as('tailor').get('/tailors/me/profile').expect(200);
      await as('merchant').get('/merchants/me/profile').expect(200);
      await as('merchant').get('/fabrics/mine').expect(200);
      await as('customer').get('/measurements/me').expect(200);
      await as('customer').get('/saved').expect(200);
    });

    it('/auth/me never returns secrets', async () => {
      const res = await as('customer').get('/auth/me').expect(200);
      expect(res.body).toMatchObject({ id: ids.customer, role: 'customer', status: 'active' });
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('refreshTokenHash');
    });

    it('public artisan and fabric responses carry no KYC or bank details', async () => {
      const privateTailorFields = ['legalName', 'idDocumentUrl', 'workshopAddress', 'bankName', 'bankCode', 'accountNumber', 'accountName', 'paystackRecipientCode', 'userId', 'reviewNote'];
      for (const body of [(await as(null).get(`/tailors/${ids.tailorProfile}`)).body, (await as(null).get('/tailors')).body[0]]) {
        for (const key of privateTailorFields) expect(body).not.toHaveProperty(key);
      }
      const fabric = (await as(null).get(`/fabrics/${ids.fabric}`)).body;
      for (const key of ['cacNumber', 'bankCode', 'accountNumber', 'accountName', 'userId']) expect(fabric.merchant).not.toHaveProperty(key);
    });
  });

  describe('role changes', () => {
    it('an account with orders cannot switch role', async () => {
      const res = await as('tailor').patch('/users/me/role', { role: 'merchant' }).expect(409);
      expect(res.body.error).toMatchObject({ code: 'ROLE_LOCKED' });
    });

    it('sign-up can never create an admin', async () => {
      await as(null).post('/auth/register', { email: 'sneaky@rbac.test', password: 'Needle2026', fullName: 'Sneaky', role: 'admin' }).expect(400);
    });
  });
});
