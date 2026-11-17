import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, resetDatabase, tokenFor } from './helpers/test-app.js';
import { PaystackService } from '../src/payments/paystack.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderItem } from '../src/orders/entities/order-item.entity.js';
import { EscrowService } from '../src/escrow/escrow.service.js';
import { EscrowTransaction } from '../src/escrow/entities/escrow-transaction.entity.js';
import { User } from '../src/users/entities/user.entity.js';
import { TailorProfile } from '../src/tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../src/merchants/entities/merchant-profile.entity.js';
import { Fabric, FabricUnit } from '../src/fabrics/entities/fabric.entity.js';
import { KycStatus, UserRole } from '../src/types/index.js';

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

const ADDRESS = { line1: '7 Bourdillon Road, Ikoyi', city: 'Lagos', state: 'Lagos', phone: '+234 801 234 5678' };
const KANO_ADDRESS = { ...ADDRESS, city: 'Kano', state: 'Kano' };
const TAILOR_PHONE = '+234 802 111 2233';
const TAILOR_WHATSAPP = '+234 803 444 5566';
/** Kano → Lagos is over the 500 km far-band threshold. */
const FAR_INTERSTATE_FEE = 7_000;
const INTRA_STATE_FEE = 2_000;
const VALUE_TIER_SURCHARGE = 7_000;

describe('Fabric checkout', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
  let feePercent: number;
  const t: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const as = (who: string) => ({
    get: (url: string) => http.get(url).set('Authorization', `Bearer ${t[who]}`),
    post: (url: string, body: object = {}) => http.post(url).set('Authorization', `Bearer ${t[who]}`).send(body),
  });
  const fabrics = (quantity = 2) => [{ fabricId: ids.fabric, quantity }];
  const toMe = () => ({ fabrics: fabrics(), destination: 'customer', deliveryAddress: ADDRESS });
  const toTailor = (tailorProfile = ids.tailorProfile) => ({ fabrics: fabrics(), destination: 'tailor', tailorId: tailorProfile });
  const releases = (orderId: string) =>
    ds.getRepository(EscrowTransaction).find({ where: { orderId, type: 'release_merchant' as never } });
  const tailorReleases = (orderId: string) =>
    ds.getRepository(EscrowTransaction).find({ where: { orderId, type: 'release_tailor' as never } });

  async function pay(orderId: string, who = 'customer') {
    const { body: started } = await as(who).post(`/orders/${orderId}/pay`).expect(200);
    const { body: paid } = await as(who).post(`/orders/${orderId}/verify-payment`, { reference: started.reference }).expect(200);
    expect(paid.status).toBe('paid');
    return paid;
  }
  async function checkoutAndPay(body: object) {
    const { body: order } = await as('customer').post('/orders/fabric-checkout', body).expect(201);
    return pay(order.id);
  }

  beforeAll(async () => {
    app = await createTestApp({ override: (b) => b.overrideProvider(PaystackService).useValue(new FakePaystack()) });
    http = request(app.getHttpServer());
    await resetDatabase(app);
    ds = app.get(DataSource);
    const passwordHash = await bcrypt.hash('Needle2026', 4);
    const mkUser = async (key: string, role: UserRole, fullName: string) => {
      const users = ds.getRepository(User);
      const user = await users.save(users.create({ email: `${key}@fabric.test`, fullName, role, emailVerified: true, status: 'active', passwordHash }));
      ids[key] = user.id;
      t[key] = tokenFor(app, user);
      return user;
    };
    await mkUser('customer', UserRole.CUSTOMER, 'Tunde Bakare');
    await mkUser('otherCustomer', UserRole.CUSTOMER, 'Kemi Adebayo');
    const tailor = await mkUser('tailor', UserRole.TAILOR, 'Ngozi Adeyemi');
    const bareTailor = await mkUser('bareTailor', UserRole.TAILOR, 'Emeka Okafor');
    const merchant = await mkUser('merchant', UserRole.MERCHANT, 'Bola Textiles');
    const bank = { bankName: 'GTB', bankCode: '058', accountNumber: '0123456789', accountName: 'TEST' };
    ids.tailorProfile = (
      await ds.getRepository(TailorProfile).save(
        ds.getRepository(TailorProfile).create({
          userId: tailor.id, displayName: 'Ngozi', atelierName: 'Ngozi Atelier', city: 'Lagos', state: 'Lagos', workshopAddress: '3 Awolowo Way', kycStatus: KycStatus.APPROVED, ...bank,
          contactPhone: TAILOR_PHONE, whatsappNumber: TAILOR_WHATSAPP,
        }),
      )
    ).id;
    // Verified, but no workshop contact details: fabric can't be sent there yet.
    ids.bareTailorProfile = (
      await ds.getRepository(TailorProfile).save(
        ds.getRepository(TailorProfile).create({
          userId: bareTailor.id, displayName: 'Emeka', atelierName: 'Emeka Atelier', city: 'Enugu', state: 'Enugu', workshopAddress: '9 Ogui Road', kycStatus: KycStatus.APPROVED, ...bank,
        }),
      )
    ).id;
    ids.merchantProfile = (
      await ds.getRepository(MerchantProfile).save(
        ds.getRepository(MerchantProfile).create({ userId: merchant.id, businessName: 'Bola Textiles', city: 'Kano', state: 'Kano', verificationStatus: KycStatus.APPROVED, ...bank }),
      )
    ).id;
    ids.fabric = (
      await ds.getRepository(Fabric).save(
        ds.getRepository(Fabric).create({
          merchantId: ids.merchantProfile, name: 'Indigo Wax Print', category: 'Ankara', price: 10000, unit: FabricUnit.YARD, imageUrl: 'https://res.cloudinary.com/x/f.jpg', isPublished: true,
        }),
      )
    ).id;
    feePercent = (await as('customer').get('/orders/checkout-config').expect(200)).body.platformFeePercent;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('needs no fit profile, and charges fabric + platform fee + retained delivery fee', async () => {
    const { body } = await as('customer').post('/orders/fabric-checkout', toMe()).expect(201);
    const fee = Math.round((20000 * feePercent) / 100);
    expect(body).toMatchObject({
      type: 'fabric',
      fabricDestination: 'customer',
      status: 'quoted',
      tailorId: null,
      fitSnapshot: null,
      fabricTotal: 20000,
      platformFee: fee,
      deliveryFee: FAR_INTERSTATE_FEE,
      totalAmount: 20000 + fee + FAR_INTERSTATE_FEE,
    });
  });

  it('quotes the same server-authoritative total the checkout will charge', async () => {
    const { body } = await as('customer').post('/orders/fabric-quote', toMe()).expect(201);
    const fee = Math.round((20000 * feePercent) / 100);
    expect(body).toMatchObject({
      fabricTotal: 20000,
      platformFee: fee,
      deliveryFee: FAR_INTERSTATE_FEE,
      totalAmount: 20000 + fee + FAR_INTERSTATE_FEE,
      currency: 'NGN',
    });
    expect(body.shipments).toHaveLength(1);
    expect(body.shipments[0]).toMatchObject({ band: 'inter_state', far: true, amount: FAR_INTERSTATE_FEE });
  });

  it('charges the intra-state rate and adds value tiers only to interstate shipments', async () => {
    const { body: local } = await as('customer')
      .post('/orders/fabric-quote', { ...toMe(), deliveryAddress: KANO_ADDRESS })
      .expect(201);
    expect(local.deliveryFee).toBe(INTRA_STATE_FEE);

    const { body: valuable } = await as('customer')
      .post('/orders/fabric-quote', { fabrics: [{ fabricId: ids.fabric, quantity: 31 }], destination: 'customer', deliveryAddress: ADDRESS })
      .expect(201);
    expect(valuable.fabricTotal).toBe(310000);
    expect(valuable.deliveryFee).toBe(FAR_INTERSTATE_FEE + VALUE_TIER_SURCHARGE);
  });

  it('rejects a checkout without somewhere to send the fabric', async () => {
    await as('customer').post('/orders/fabric-checkout', { fabrics: fabrics(), destination: 'customer' }).expect(400);
    await as('customer').post('/orders/fabric-checkout', { fabrics: fabrics(), destination: 'customer', deliveryAddress: { ...ADDRESS, phone: undefined } }).expect(400);
    await as('customer').post('/orders/fabric-checkout', { fabrics: fabrics(), destination: 'tailor' }).expect(400);
    await as('customer').post('/orders/fabric-checkout', { fabrics: [], destination: 'tailor', tailorId: ids.tailorProfile }).expect(400);
    // Merchants sell fabric; they don't buy it at this checkout.
    await as('merchant').post('/orders/fabric-checkout', toMe()).expect(403);
  });

  it('needs a contactable workshop before fabric can be sent to an artisan', async () => {
    await as('customer').post('/orders/fabric-checkout', toTailor(ids.bareTailorProfile)).expect(409);
    await as('tailor').post('/orders/fabric-checkout', toTailor(ids.tailorProfile)).expect(400);
  });

  it('only advertises artisans a merchant can actually deliver to', async () => {
    const { body } = await as('customer').get('/tailors').expect(200);
    const ready = body.filter((t: { canReceiveFabric: boolean }) => t.canReceiveFabric).map((t: { id: string }) => t.id);
    expect(ready).toContain(ids.tailorProfile);
    expect(ready).not.toContain(ids.bareTailorProfile);
  });

  it('hides an unpaid order from the tailor, and they cannot quote on it', async () => {
    const { body: order } = await as('customer').post('/orders/fabric-checkout', toTailor()).expect(201);
    await as('tailor').get(`/orders/${order.id}`).expect(404);
    const { body: list } = await as('tailor').get('/orders?role=tailor').expect(200);
    expect(list.map((o: { id: string }) => o.id)).not.toContain(order.id);
    await as('tailor').post(`/orders/${order.id}/quote`, { workmanshipPrice: 5000, deliveryFee: 0, estimatedDeliveryDate: '2099-03-01' }).expect(409);
  });

  it('cancels before payment', async () => {
    const { body: order } = await as('customer').post('/orders/fabric-checkout', toMe()).expect(201);
    const { body } = await as('customer').post(`/orders/${order.id}/cancel`).expect(200);
    expect(body.status).toBe('cancelled');
  });

  describe('an artisan buying fabric', () => {
    it('checks out to their own address and pays', async () => {
      const { body: order } = await as('tailor').post('/orders/fabric-checkout', toMe()).expect(201);
      expect(order).toMatchObject({ type: 'fabric', fabricDestination: 'customer', customerId: ids.tailor, status: 'quoted' });
      const paid = await pay(order.id, 'tailor');
      expect(paid.status).toBe('paid');

      // It shows up under the artisan's own orders as a buyer…
      const { body: list } = await as('tailor').get('/orders?role=customer').expect(200);
      expect(list.map((o: { id: string }) => o.id)).toContain(order.id);
      // …and the merchant only learns where to ship it and how to reach them.
      const { body } = await as('merchant').get(`/orders/${order.id}`).expect(200);
      expect(body.shipTo).toMatchObject({ name: 'Ngozi Adeyemi', phone: ADDRESS.phone });
    });

    it('can only confirm their own fabric arrived, which pays the merchant', async () => {
      const { body: order } = await as('tailor').post('/orders/fabric-checkout', toMe()).expect(201);
      await pay(order.id, 'tailor');
      const itemId = order.items[0].id;
      await as('merchant').post(`/orders/${order.id}/items/${itemId}/ship`).expect(200);
      await as('otherCustomer').post(`/orders/${order.id}/items/${itemId}/receive`).expect(404);
      await as('tailor').post(`/orders/${order.id}/items/${itemId}/receive`).expect(200);
      expect(await releases(order.id)).toHaveLength(1);
    });
  });

  describe('delivered to the customer', () => {
    let order: { id: string; items: { id: string }[] };

    it('shows the merchant the customer address once paid', async () => {
      await as('customer').post('/saved', { itemType: 'fabric', itemId: ids.fabric, quantity: 2 });
      order = await checkoutAndPay(toMe());
      const { body } = await as('merchant').get(`/orders/${order.id}`).expect(200);
      expect(body.shipTo).toMatchObject({ name: 'Tunde Bakare', city: 'Lagos, Lagos', phone: ADDRESS.phone, whatsapp: null });
      expect(body.shipTo.address).toContain('Bourdillon');
      expect(body.fabricDestination).toBe('customer');
    });

    it('removes paid fabric from the selection', async () => {
      const { body: saved } = await as('customer').get('/saved').expect(200);
      expect(saved.filter((s: { itemId: string }) => s.itemId === ids.fabric)).toHaveLength(0);
    });

    it('only the customer can confirm it arrived, which pays the merchant and completes the order', async () => {
      const itemId = order.items[0].id;
      await as('merchant').post(`/orders/${order.id}/items/${itemId}/ship`, { note: 'GIG 123' }).expect(200);
      await as('otherCustomer').post(`/orders/${order.id}/items/${itemId}/receive`).expect(404);
      await as('tailor').post(`/orders/${order.id}/items/${itemId}/receive`).expect(404);
      const { body } = await as('customer').post(`/orders/${order.id}/items/${itemId}/receive`).expect(200);
      expect(body.status).toBe('completed');
      const paid = await releases(order.id);
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ amount: 20000, partyId: ids.merchantProfile });
    });

    it('has no review', async () => {
      await as('customer').post(`/orders/${order.id}/review`, { rating: 5 }).expect(409);
    });
  });

  describe('sent to a tailor', () => {
    let order: { id: string; items: { id: string }[] };

    it('tells the merchant to ship to the workshop, with its contact details, and keeps the customer address private', async () => {
      order = await checkoutAndPay(toTailor());
      const { body } = await as('merchant').get(`/orders/${order.id}`).expect(200);
      expect(body.shipTo).toMatchObject({
        name: 'Ngozi Atelier',
        address: '3 Awolowo Way',
        phone: TAILOR_PHONE,
        whatsapp: TAILOR_WHATSAPP,
      });
      const { body: tailorView } = await as('tailor').get(`/orders/${order.id}`).expect(200);
      expect(tailorView.deliveryAddress).toBeNull();
      expect(tailorView.viewerRole).toBe('tailor');
    });

    it('has no production stages', async () => {
      await as('tailor').post(`/orders/${order.id}/milestone`, { milestone: 'cutting' }).expect(409);
      await as('tailor').post(`/orders/${order.id}/deliver`).expect(409);
    });

    it('only the tailor can confirm it arrived', async () => {
      const itemId = order.items[0].id;
      await as('merchant').post(`/orders/${order.id}/items/${itemId}/ship`).expect(200);
      await as('customer').post(`/orders/${order.id}/items/${itemId}/receive`).expect(404);
      const { body } = await as('tailor').post(`/orders/${order.id}/items/${itemId}/receive`).expect(200);
      expect(body.status).toBe('completed');
      expect(await releases(order.id)).toHaveLength(1);
      // The delivery fee stays with IPILE; receiving the fabric is not a tailor payout.
      expect(await tailorReleases(order.id)).toHaveLength(0);
      const platformFee = Math.round((20000 * feePercent) / 100);
      expect(await app.get(EscrowService).summary(order.id)).toMatchObject({
        held: 20000 + platformFee + FAR_INTERSTATE_FEE,
        released: 20000,
        balance: platformFee + FAR_INTERSTATE_FEE,
      });
    });
  });

  it('releases a merchant whose recipient never confirms, but not before the last line shipped', async () => {
    const order = await checkoutAndPay(toMe());
    const orders = app.get(OrdersService);
    const later = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await orders.autoApproveDue(later);
    expect((await as('customer').get(`/orders/${order.id}`).expect(200)).body.status).toBe('paid');

    await as('merchant').post(`/orders/${order.id}/items/${order.items[0].id}/ship`).expect(200);
    await orders.autoApproveDue(later);
    expect((await as('customer').get(`/orders/${order.id}`).expect(200)).body.status).toBe('completed');
    expect(await releases(order.id)).toHaveLength(1);
    expect(await ds.getRepository(OrderItem).countBy({ orderId: order.id })).toBe(1);
  });

  it('refunds a disputed order delivered to the customer', async () => {
    const order = await checkoutAndPay(toMe());
    const { body } = await as('customer').post(`/orders/${order.id}/dispute`, { reason: 'It never arrived.' }).expect(200);
    expect(body.status).toBe('disputed');
    const admin = await ds.getRepository(User).save(
      ds.getRepository(User).create({ email: 'admin@fabric.test', fullName: 'Ops', role: UserRole.ADMIN, emailVerified: true, status: 'active', passwordHash: 'x' }),
    );
    t.admin = tokenFor(app, admin);
    const { body: resolved } = await as('admin').post(`/admin/orders/${order.id}/resolve`, { outcome: 'refund', note: 'Courier lost the parcel.' }).expect(200);
    expect(resolved.status).toBe('refunded');
    expect(resolved.escrow.refunded).toBe(resolved.totalAmount);
  });
});
