import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Asset, Keypair } from '@stellar/stellar-sdk';
import { createTestApp, resetDatabase, tokenFor } from './helpers/test-app.js';
import { StellarService, type IncomingPayment } from '../src/payments/stellar/stellar.service.js';
import { FxRateService } from '../src/payments/stellar/fx-rate.service.js';
import { StellarCheckoutService } from '../src/orders/stellar-checkout.service.js';
import { EscrowService } from '../src/escrow/escrow.service.js';
import { EscrowTransaction } from '../src/escrow/entities/escrow-transaction.entity.js';
import { Order } from '../src/orders/entities/order.entity.js';
import { User } from '../src/users/entities/user.entity.js';
import { TailorProfile } from '../src/tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../src/merchants/entities/merchant-profile.entity.js';
import { Fabric, FabricUnit } from '../src/fabrics/entities/fabric.entity.js';
import { fromStroops, toStroops } from '../src/payments/stellar/money.js';
import { KycStatus, UserRole } from '../src/types/index.js';

/** Real, valid (unfunded) Stellar public keys; nothing talks to the network. */
const fakeAddress = () => Keypair.random().publicKey();

const OPERATING = fakeAddress();
// A syntactically valid issuer key so `new Asset()` accepts it; nothing talks to the network.
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const CUSTOMER_WALLET = fakeAddress();
const MERCHANT_WALLET = fakeAddress();
const NO_TRUST_WALLET = fakeAddress();
const RATE = '1500.0000000';


/** Stands in for Horizon: records what would be signed and sent, and every submission lands. */
class FakeStellar {
  readonly checkoutEnabled = true;
  readonly payoutsEnabled = true;
  readonly isConfigured = true;
  readonly canSign = true;
  readonly network = 'testnet';
  readonly operatingAddress = OPERATING;
  readonly usdc = new Asset('USDC', ISSUER);
  readonly quoteTtlMinutes = 15;
  readonly spreadBps = 0;
  readonly lateToleranceBps = 100;
  readonly overpayRefundBps = 100;
  readonly floatMaxUsdc = null;
  readonly minXlm = 0n;
  sent: { to: string; amount: string; memo: string | null }[] = [];
  private n = 0;
  assertCheckoutEnabled() {}
  explorerUrl(hash: string) {
    return `https://stellar.expert/explorer/testnet/tx/${hash}`;
  }
  payUri(input: { amount: string; memo: string }) {
    return `web+stellar:pay?destination=${OPERATING}&amount=${input.amount}&memo=${input.memo}`;
  }
  isUsdc(code: string | null, issuer: string | null) {
    return code === 'USDC' && issuer === ISSUER;
  }
  async checkAddress(address: string) {
    if (address === NO_TRUST_WALLET) return { ok: false, reason: 'no_trustline', message: 'This account does not accept USDC yet.' };
    return { ok: true };
  }
  async withSubmitLock<T>(fn: () => Promise<T>) {
    return fn();
  }
  async signPayment(input: { to: string; stroops: bigint; memo: string | null }) {
    this.sent.push({ to: input.to, amount: fromStroops(input.stroops), memo: input.memo });
    this.n++;
    return { hash: `${'0'.repeat(60)}${String(this.n).padStart(4, '0')}`, xdr: `xdr${this.n}`, maxTime: new Date(Date.now() + 60_000) };
  }
  async submit() {
    return { status: 'success' };
  }
  async transactionStatus() {
    return 'success';
  }
  async latestLedgerCloseTime() {
    return new Date();
  }
  async operatingBalances() {
    return { usdc: toStroops('1000'), xlm: toStroops('50') };
  }
}

describe('Stellar payments', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
  const stellar = new FakeStellar();
  const t: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let op = 5000;

  const as = (who: string) => ({
    get: (url: string) => http.get(url).set('Authorization', `Bearer ${t[who]}`),
    post: (url: string, body: object = {}) => http.post(url).set('Authorization', `Bearer ${t[who]}`).send(body),
    put: (url: string, body: object = {}) => http.put(url).set('Authorization', `Bearer ${t[who]}`).send(body),
  });
  const incoming = (extra: Partial<IncomingPayment>): IncomingPayment => {
    op++;
    return {
      id: String(op),
      pagingToken: String(op),
      txHash: `${'a'.repeat(60)}${op}`,
      successful: true,
      from: CUSTOMER_WALLET,
      to: OPERATING,
      assetCode: 'USDC',
      assetIssuer: ISSUER,
      amount: '0',
      memo: null,
      memoType: 'text',
      createdAt: new Date(),
      ...extra,
    };
  };
  const escrowRows = (orderId: string) =>
    ds.getRepository(EscrowTransaction).find({ where: { orderId }, order: { createdAt: 'ASC' } });

  beforeAll(async () => {
    app = await createTestApp({
      override: (b) =>
        b
          .overrideProvider(StellarService)
          .useValue(stellar)
          .overrideProvider(FxRateService)
          .useValue({ isConfigured: true, ngnPerUsdc: async () => RATE }),
    });
    http = request(app.getHttpServer());
    await resetDatabase(app);
    ds = app.get(DataSource);
    const passwordHash = await bcrypt.hash('Needle2026', 4);
    const mkUser = async (key: string, role: UserRole, fullName: string) => {
      const users = ds.getRepository(User);
      const user = await users.save(users.create({ email: `${key}@stellar.test`, fullName, role, emailVerified: true, status: 'active', passwordHash }));
      ids[key] = user.id;
      t[key] = tokenFor(app, user);
      return user;
    };
    await mkUser('customer', UserRole.CUSTOMER, 'Ada Obi');
    await mkUser('admin', UserRole.ADMIN, 'Ops');
    const tailor = await mkUser('tailor', UserRole.TAILOR, 'Ngozi Adeyemi');
    const merchant = await mkUser('merchant', UserRole.MERCHANT, 'Bola Textiles');
    const bank = { bankName: 'GTB', bankCode: '058', accountNumber: '0123456789', accountName: 'TEST' };
    await ds.getRepository(TailorProfile).save(
      ds.getRepository(TailorProfile).create({
        userId: tailor.id, displayName: 'Ngozi', atelierName: 'Ngozi Atelier', city: 'Lagos', state: 'Lagos', workshopAddress: '3 Awolowo Way', kycStatus: KycStatus.APPROVED, ...bank,
      }),
    );
    ids.merchantProfile = (
      await ds.getRepository(MerchantProfile).save(
        ds.getRepository(MerchantProfile).create({
          userId: merchant.id, businessName: 'Bola Textiles', city: 'Lagos', state: 'Lagos', verificationStatus: KycStatus.APPROVED, ...bank,
          payoutMethod: 'stellar', stellarAddress: MERCHANT_WALLET, stellarMemo: null,
        }),
      )
    ).id;
    ids.fabric = (
      await ds.getRepository(Fabric).save(
        ds.getRepository(Fabric).create({
          merchantId: ids.merchantProfile, name: 'Indigo Wax Print', category: 'Ankara', price: 10000, unit: FabricUnit.YARD, imageUrl: 'https://res.cloudinary.com/x/f.jpg', isPublished: true,
        }),
      )
    ).id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  const newOrder = async () => {
    const { body } = await as('customer')
      .post('/orders/fabric-checkout', {
        fabrics: [{ fabricId: ids.fabric, quantity: 2 }],
        destination: 'customer',
        deliveryAddress: { line1: '7 Bourdillon Road, Ikoyi', city: 'Lagos', state: 'Lagos', phone: '+234 801 234 5678' },
      })
      .expect(201);
    return body as { id: string; reference: string; totalAmount: number };
  };

  it('advertises Stellar as a payment method', async () => {
    const { body } = await http.get('/payments/methods').expect(200);
    expect(body).toMatchObject({ stellar: true, stellarPayouts: true, stellarNetwork: 'testnet' });
  });

  it('quotes USDC for the order total and reuses the quote until it changes', async () => {
    const order = await newOrder();
    const { body: first } = await as('customer').post(`/orders/${order.id}/pay`, { method: 'stellar', payerAddress: CUSTOMER_WALLET }).expect(200);
    expect(first).toMatchObject({
      method: 'stellar',
      reference: `${order.reference}-S1`,
      memo: `${order.reference}-S1`,
      destination: OPERATING,
      nairaAmount: order.totalAmount,
      status: 'awaiting',
    });
    expect(toStroops(first.amount)).toBe(toStroops(fromStroops((BigInt(order.totalAmount) * 10_000_000n + 1499n) / 1500n)));
    const { body: again } = await as('customer').post(`/orders/${order.id}/pay`, { method: 'stellar' }).expect(200);
    expect(again.reference).toBe(first.reference);
    // Another customer can't see it.
    await as('admin').get(`/orders/${order.id}/stellar-intent`).expect(403);
  });

  it('settles a matching payment into escrow once, and refunds a second payment in USDC', async () => {
    const order = await newOrder();
    const { body: intent } = await as('customer').post(`/orders/${order.id}/pay`, { method: 'stellar', payerAddress: CUSTOMER_WALLET }).expect(200);
    const checkout = app.get(StellarCheckoutService);

    const payment = incoming({ amount: intent.amount, memo: intent.memo });
    await checkout.handleIncoming(payment);
    await checkout.handleIncoming(payment); // the watcher may see it twice

    const { body: status } = await as('customer').get(`/orders/${order.id}/stellar-intent`).expect(200);
    expect(status.orderStatus).toBe('paid');
    expect(status.intent).toMatchObject({ status: 'paid', txHash: payment.txHash });
    let rows = await escrowRows(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'hold', provider: 'stellar', amount: order.totalAmount, destination: CUSTOMER_WALLET });

    // The customer pays again by mistake: held and sent straight back.
    await checkout.handleIncoming(incoming({ amount: intent.amount, memo: intent.memo }));
    rows = await escrowRows(order.id);
    const refund = rows.find((r) => r.type === 'refund')!;
    expect(refund).toMatchObject({ provider: 'stellar', status: 'success', destination: CUSTOMER_WALLET, assetAmount: intent.amount });
    expect(stellar.sent.at(-1)).toEqual({ to: CUSTOMER_WALLET, amount: intent.amount, memo: null });
  });

  it('pays a merchant who chose Stellar in USDC at the payout rate', async () => {
    const order = await newOrder();
    const { body: intent } = await as('customer').post(`/orders/${order.id}/pay`, { method: 'stellar' }).expect(200);
    await app.get(StellarCheckoutService).handleIncoming(incoming({ amount: intent.amount, memo: intent.memo }));

    const escrow = app.get(EscrowService);
    const reserved = await ds.transaction(async (em) => {
      const locked = await em.findOneOrFail(Order, { where: { id: order.id } });
      return escrow.reserveRelease(em, locked, { type: 'merchant', id: ids.merchantProfile }, 20_000);
    });
    expect(reserved).toMatchObject({ provider: 'stellar' });
    const paid = await escrow.execute(reserved!);
    expect(paid).toMatchObject({ status: 'success', destination: MERCHANT_WALLET, fxRate: RATE });
    expect(stellar.sent.at(-1)).toEqual({ to: MERCHANT_WALLET, amount: '13.3333333', memo: reserved!.reference });
  });

  it('records a deposit without a memo for an admin, who can refund it', async () => {
    await app.get(StellarCheckoutService).handleIncoming(incoming({ amount: '25.0000000', memo: null, memoType: 'none' }));
    const { body: open } = await as('admin').get('/admin/stellar/unmatched').expect(200);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ reason: 'no_memo', amount: '25.0000000', status: 'open' });

    const { body: refunded } = await as('admin')
      .post(`/admin/stellar/unmatched/${open[0].id}/refund`, { address: CUSTOMER_WALLET, memo: '445566' })
      .expect(200);
    expect(refunded.status).toBe('refunded');
    expect(stellar.sent.at(-1)).toEqual({ to: CUSTOMER_WALLET, amount: '25.0000000', memo: '445566' });
    await as('admin').post(`/admin/stellar/unmatched/${open[0].id}/refund`, { address: CUSTOMER_WALLET }).expect(409);
  });

  it('only accepts a Stellar payout address that can receive USDC', async () => {
    await as('tailor').put('/tailors/me/profile', { payoutMethod: 'stellar', stellarAddress: NO_TRUST_WALLET }).expect(400);
    await as('tailor').put('/tailors/me/profile', { payoutMethod: 'stellar' }).expect(400);
    const { body } = await as('tailor').put('/tailors/me/profile', { payoutMethod: 'stellar', stellarAddress: MERCHANT_WALLET.toLowerCase() }).expect(200);
    expect(body).toMatchObject({ payoutMethod: 'stellar', stellarAddress: MERCHANT_WALLET });
  });

  it('shows the treasury to admins', async () => {
    const { body } = await as('admin').get('/admin/stellar/treasury').expect(200);
    expect(body).toMatchObject({ configured: true, usdc: '1000.0000000', canSign: true });
  });
});
