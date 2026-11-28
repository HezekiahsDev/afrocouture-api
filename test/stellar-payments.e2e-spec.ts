import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Keypair } from '@stellar/stellar-sdk';
import { createTestApp, resetDatabase, tokenFor } from './helpers/test-app.js';
import { StellarPaymentsClient, StellarServiceError } from '../src/payments/stellar/stellar-payments.client.js';
import { sign } from '../src/payments/stellar/webhook-signature.js';
import { EscrowService } from '../src/escrow/escrow.service.js';
import { EscrowTransaction } from '../src/escrow/entities/escrow-transaction.entity.js';
import { Order } from '../src/orders/entities/order.entity.js';
import { User } from '../src/users/entities/user.entity.js';
import { TailorProfile } from '../src/tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../src/merchants/entities/merchant-profile.entity.js';
import { Fabric, FabricUnit } from '../src/fabrics/entities/fabric.entity.js';
import { KycStatus, UserRole } from '../src/types/index.js';

const WEBHOOK_SECRET = randomBytes(32).toString('hex');
const PAYER = Keypair.random().publicKey();
const MERCHANT_WALLET = Keypair.random().publicKey();
const NO_TRUST = Keypair.random().publicKey();
const OPERATING = Keypair.random().publicKey();

/**
 * Stands in for stellar-payment-service at its HTTP boundary: same method names and response
 * shapes as StellarPaymentsClient, records every call, and can be told to fail or be down.
 */
class FakeServiceClient {
  isConfigured = true;
  calls: { method: string; args: unknown }[] = [];
  intents: Record<string, unknown>[] = [];
  payments = new Map<string, Record<string, unknown>[]>();
  transfers = new Map<string, Record<string, unknown>>();
  transferResult: 'success' | 'pending' | 'failed' = 'success';
  down = false;
  async serviceConfig() {
    return { network: 'testnet', checkoutEnabled: true, payoutsEnabled: true, asset: { code: 'USDC', issuer: 'GISSUER' }, operatingAddress: OPERATING, quoteTtlMinutes: 15 };
  }
  async checkoutEnabled() {
    return true;
  }
  async payoutsEnabled() {
    return true;
  }
  explorerUrl(h: string) {
    return `https://stellar.expert/explorer/testnet/tx/${h}`;
  }
  private log(method: string, args: unknown) {
    this.calls.push({ method, args });
    if (this.down) throw new StellarServiceError('stellar-payment-service unreachable: ECONNREFUSED', 0);
  }
  async createIntent(body: { clientReference: string; nairaAmount: number }) {
    this.log('createIntent', body);
    const n = this.intents.filter((i) => i.clientReference === body.clientReference).length + 1;
    const intent = {
      id: randomUUID(), clientReference: body.clientReference, reference: `${body.clientReference}-S${n}`, status: 'awaiting', network: 'testnet',
      destination: OPERATING, memo: `${body.clientReference}-S${n}`, memoType: 'text', asset: { code: 'USDC', issuer: 'GISSUER' },
      amount: (body.nairaAmount / 1500).toFixed(7), nairaAmount: body.nairaAmount, fxRate: '1500.0000000', expiresAt: new Date(Date.now() + 900_000).toISOString(),
      payerAddress: null, refundAddress: null, refundMemo: null, metadata: null, sep7Uri: 'web+stellar:pay?x', createdAt: new Date().toISOString(),
    };
    this.intents.unshift(intent);
    return intent;
  }
  async listIntents(ref: string) {
    this.log('listIntents', ref);
    return this.intents.filter((i) => i.clientReference === ref);
  }
  async getIntent(id: string) {
    this.log('getIntent', id);
    return { ...this.intents.find((i) => i.id === id)!, payments: this.payments.get(id) ?? [] };
  }
  private transfer(kind: string, body: Record<string, unknown>) {
    const existing = this.transfers.get(body.clientReference as string);
    if (existing) return existing;
    const t = { id: randomUUID(), clientReference: body.clientReference, kind, status: this.transferResult, destination: body.destination ?? PAYER, memo: body.memo ?? null,
      nairaAmount: body.nairaAmount ?? null, amount: '13.3333333', fxRate: '1500.0000000', paymentId: body.paymentId ?? null,
      txHash: this.transferResult === 'success' ? 'f'.repeat(64) : null, explorerUrl: null, failureReason: this.transferResult === 'failed' ? 'op_underfunded' : null, attempts: 1 };
    this.transfers.set(t.clientReference as string, t);
    return t;
  }
  async createPayout(body: Record<string, unknown>) {
    this.log('createPayout', body);
    return this.transfer('payout', body);
  }
  async createRefund(body: Record<string, unknown>) {
    this.log('createRefund', body);
    return this.transfer('refund', body);
  }
  async retryTransfer(id: string) {
    this.log('retryTransfer', id);
    const t = [...this.transfers.values()].find((x) => x.id === id)!;
    Object.assign(t, { status: 'success', failureReason: null, txHash: 'e'.repeat(64), attempts: (t.attempts as number) + 1 });
    return t;
  }
  async checkAddress(address: string) {
    this.log('checkAddress', address);
    return address === NO_TRUST ? { ok: false, reason: 'no_trustline', message: 'This account does not accept USDC yet.' } : { ok: true };
  }
  async treasury() {
    return { configured: true, network: 'testnet', checkoutEnabled: true, payoutsEnabled: true, canSign: true, operatingAddress: OPERATING, usdc: '1000.0000000', xlm: '50.0000000', pendingTransfersUsdc: '0.0000000', floatMaxUsdc: null, minXlm: '20.0000000', openDeposits: 1, warnings: ['1 unmatched deposit(s) need attention.'] };
  }
  async listDeposits(status: string) {
    this.log('listDeposits', status);
    return [{ id: randomUUID(), operationId: '1', txHash: 'a'.repeat(64), fromAddress: PAYER, amount: '25.0000000', assetCode: 'USDC', assetIssuer: 'GISSUER', memo: null, reason: 'no_memo', status: 'open', paymentId: null, transferId: null, note: null, receivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  }
}

describe('Stellar payments through stellar-payment-service', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
  const fake = new FakeServiceClient();
  const t: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (who: string) => ({
    get: (url: string) => http.get(url).set('Authorization', `Bearer ${t[who]}`),
    post: (url: string, body: object = {}) => http.post(url).set('Authorization', `Bearer ${t[who]}`).send(body),
    put: (url: string, body: object = {}) => http.put(url).set('Authorization', `Bearer ${t[who]}`).send(body),
  });
  /** Delivers a service event exactly as stellar-payment-service would. */
  const deliver = (type: string, data: Record<string, unknown>, opts: { id?: string; secret?: string } = {}) => {
    const body = JSON.stringify({ id: opts.id ?? randomUUID(), type, createdAt: new Date().toISOString(), data });
    return http.post('/payments/stellar/webhook').set('content-type', 'application/json').set('x-stellar-signature', sign(opts.secret ?? WEBHOOK_SECRET, body)).send(body);
  };
  /** The service's event names the order by clientReference (= order.reference), not by the API's view. */
  const paymentEvent = (intent: Record<string, unknown>, order: { reference: string }, extra: Record<string, unknown> = {}) => ({
    paymentId: randomUUID(), intentReference: intent.reference, clientReference: order.reference, quotedNairaAmount: intent.nairaAmount,
    amount: intent.amount, fxRate: '1500.0000000', onTime: true, coversQuote: true, overpaid: false, nairaValue: intent.nairaAmount, txHash: 'b'.repeat(64), ...extra,
  });
  const rows = (orderId: string) => ds.getRepository(EscrowTransaction).find({ where: { orderId }, order: { createdAt: 'ASC' } });

  beforeAll(async () => {
    process.env.STELLAR_WEBHOOK_SECRET = WEBHOOK_SECRET;
    app = await createTestApp({ override: (b) => b.overrideProvider(StellarPaymentsClient).useValue(fake) });
    http = request(app.getHttpServer());
    await resetDatabase(app);
    ds = app.get(DataSource);
    const passwordHash = await bcrypt.hash('Needle2026', 4);
    const mkUser = async (key: string, role: UserRole) => {
      const users = ds.getRepository(User);
      const user = await users.save(users.create({ email: `${key}@svc.test`, fullName: key, role, emailVerified: true, status: 'active', passwordHash }));
      ids[key] = user.id;
      t[key] = tokenFor(app, user);
      return user;
    };
    await mkUser('customer', UserRole.CUSTOMER);
    await mkUser('admin', UserRole.ADMIN);
    const tailor = await mkUser('tailor', UserRole.TAILOR);
    const merchant = await mkUser('merchant', UserRole.MERCHANT);
    const bank = { bankName: 'GTB', bankCode: '058', accountNumber: '0123456789', accountName: 'TEST' };
    await ds.getRepository(TailorProfile).save(ds.getRepository(TailorProfile).create({ userId: tailor.id, displayName: 'N', atelierName: 'N Atelier', city: 'Lagos', state: 'Lagos', workshopAddress: '3 Way', kycStatus: KycStatus.APPROVED, ...bank }));
    ids.merchantProfile = (await ds.getRepository(MerchantProfile).save(ds.getRepository(MerchantProfile).create({
      userId: merchant.id, businessName: 'Bola', city: 'Lagos', state: 'Lagos', verificationStatus: KycStatus.APPROVED, ...bank, payoutMethod: 'stellar', stellarAddress: MERCHANT_WALLET, stellarMemo: null,
    }))).id;
    ids.fabric = (await ds.getRepository(Fabric).save(ds.getRepository(Fabric).create({
      merchantId: ids.merchantProfile, name: 'Indigo', category: 'Ankara', price: 10000, unit: FabricUnit.YARD, imageUrl: 'https://res.cloudinary.com/x/f.jpg', isPublished: true,
    }))).id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.STELLAR_WEBHOOK_SECRET;
  });

  const newOrder = async () =>
    (await as('customer').post('/orders/fabric-checkout', {
      fabrics: [{ fabricId: ids.fabric, quantity: 2 }], destination: 'customer',
      deliveryAddress: { line1: '7 Bourdillon Road, Ikoyi', city: 'Lagos', state: 'Lagos', phone: '+234 801 234 5678' },
    }).expect(201)).body as { id: string; reference: string; totalAmount: number };

  const payAndSettle = async () => {
    const order = await newOrder();
    const { body: intent } = await as('customer').post(`/orders/${order.id}/pay`, { method: 'stellar' }).expect(200);
    const event = paymentEvent(intent, order);
    await deliver('payment.received', event).expect(200);
    return { order, intent, event };
  };

  it('advertises Stellar from the service config', async () => {
    const { body } = await http.get('/payments/methods').expect(200);
    expect(body).toMatchObject({ stellar: true, stellarPayouts: true, stellarNetwork: 'testnet' });
  });

  it('starts checkout through the service, keyed by the order reference', async () => {
    const order = await newOrder();
    const { body } = await as('customer').post(`/orders/${order.id}/pay`, { method: 'stellar', payerAddress: PAYER }).expect(200);
    expect(body).toMatchObject({ method: 'stellar', reference: `${order.reference}-S1`, destination: OPERATING, status: 'awaiting', nairaAmount: order.totalAmount });
    expect(fake.calls.at(-1)).toMatchObject({ method: 'createIntent', args: { clientReference: order.reference, nairaAmount: order.totalAmount, payerAddress: PAYER, metadata: { orderId: order.id } } });
  });

  it('only accepts correctly signed webhooks', async () => {
    await deliver('intent.expired', {}, { secret: 'wrong' }).expect(401);
    await http.post('/payments/stellar/webhook').set('content-type', 'application/json').send('{"id":"x"}').expect(401);
  });

  it('settles an order from payment.received, once', async () => {
    const order = await newOrder();
    const { body: intent } = await as('customer').post(`/orders/${order.id}/pay`, { method: 'stellar' }).expect(200);
    const event = paymentEvent(intent, order);
    const id = randomUUID();
    await deliver('payment.received', event, { id }).expect(200);
    const { body: again } = await deliver('payment.received', event, { id }).expect(200);
    expect(again.duplicate).toBe(true);
    await deliver('payment.received', event).expect(200); // same payment, new event id: still applied once

    expect((await ds.getRepository(Order).findOneByOrFail({ id: order.id })).status).toBe('paid');
    const holds = (await rows(order.id)).filter((r) => r.type === 'hold');
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ provider: 'stellar', amount: order.totalAmount, providerCode: event.paymentId, txHash: event.txHash });

    Object.assign(fake.intents.find((i) => i.id === intent.id)!, { status: 'received' });
    fake.payments.set(intent.id, [{ id: event.paymentId, txHash: event.txHash }]);
    const { body: polled } = await as('customer').get(`/orders/${order.id}/stellar-intent`).expect(200);
    expect(polled).toMatchObject({ orderStatus: 'paid', intent: { status: 'paid', txHash: event.txHash } });
  });

  it('refunds a second payment through the service, against that payment', async () => {
    const { order, intent } = await payAndSettle();
    const second = paymentEvent(intent, order);
    await deliver('payment.received', second).expect(200);
    const refund = (await rows(order.id)).find((r) => r.type === 'refund')!;
    expect(refund).toMatchObject({ provider: 'stellar', status: 'success' });
    expect(fake.calls.find((c) => c.method === 'createRefund' && (c.args as { paymentId: string }).paymentId === second.paymentId)?.args)
      .toMatchObject({ clientReference: refund.reference, share: { part: order.totalAmount, whole: order.totalAmount } });
  });

  it('sends merchant payouts as service transfers and follows transfer webhooks', async () => {
    const { order } = await payAndSettle();
    const escrow = app.get(EscrowService);
    fake.transferResult = 'pending';
    onTestFinished(() => {
      fake.transferResult = 'success';
    });
    const reserved = await ds.transaction(async (em) =>
      escrow.reserveRelease(em, await em.findOneByOrFail(Order, { id: order.id }), { type: 'merchant', id: ids.merchantProfile }, 20_000),
    );
    const sent = await escrow.execute(reserved!);
    expect(sent).toMatchObject({ provider: 'stellar', status: 'pending', destination: MERCHANT_WALLET });
    expect(fake.calls.at(-1)).toMatchObject({ method: 'createPayout', args: { clientReference: reserved!.reference, destination: MERCHANT_WALLET, nairaAmount: 20_000 } });
    const transfer = fake.transfers.get(reserved!.reference)!;
    await deliver('transfer.succeeded', { ...transfer, status: 'success', txHash: 'c'.repeat(64) }).expect(200);
    expect(await ds.getRepository(EscrowTransaction).findOneByOrFail({ id: reserved!.id })).toMatchObject({ status: 'success', txHash: 'c'.repeat(64) });
    fake.transferResult = 'success';
  });

  it('retries a failed Stellar payout on the same service transfer', async () => {
    const { order } = await payAndSettle();
    const escrow = app.get(EscrowService);
    fake.transferResult = 'failed';
    onTestFinished(() => {
      fake.transferResult = 'success';
    });
    const reserved = await ds.transaction(async (em) =>
      escrow.reserveRelease(em, await em.findOneByOrFail(Order, { id: order.id }), { type: 'merchant', id: ids.merchantProfile }, 5_000),
    );
    const failed = await escrow.execute(reserved!);
    expect(failed).toMatchObject({ status: 'failed', failureReason: 'op_underfunded' });
    fake.transferResult = 'success';
    const retried = await escrow.retry(failed.id);
    expect(retried).toMatchObject({ status: 'success', reference: reserved!.reference });
    expect(fake.calls.at(-1)).toMatchObject({ method: 'retryTransfer', args: failed.providerCode });
  });

  it('keeps a payout pending while the service is down, then the reconciler completes it', async () => {
    const { order } = await payAndSettle();
    const escrow = app.get(EscrowService);
    const reserved = await ds.transaction(async (em) =>
      escrow.reserveRelease(em, await em.findOneByOrFail(Order, { id: order.id }), { type: 'merchant', id: ids.merchantProfile }, 4_000),
    );
    fake.down = true;
    try {
      expect(await escrow.execute(reserved!)).toMatchObject({ status: 'pending', failureReason: 'Waiting for stellar-payment-service' });
    } finally {
      fake.down = false;
    }
    await escrow.reconcileStellar(new Date(Date.now() + 5 * 60 * 1000));
    expect(await ds.getRepository(EscrowTransaction).findOneByOrFail({ id: reserved!.id })).toMatchObject({ status: 'success' });
    expect(fake.calls.filter((c) => c.method === 'createPayout' && (c.args as { clientReference: string }).clientReference === reserved!.reference)).toHaveLength(2);
  });

  it('checks payout addresses through the service', async () => {
    await as('tailor').put('/tailors/me/profile', { payoutMethod: 'stellar', stellarAddress: NO_TRUST }).expect(400);
    const { body } = await as('tailor').put('/tailors/me/profile', { payoutMethod: 'stellar', stellarAddress: MERCHANT_WALLET }).expect(200);
    expect(body).toMatchObject({ payoutMethod: 'stellar', stellarAddress: MERCHANT_WALLET });
  });

  it('proxies the admin treasury and deposits in the console shape', async () => {
    const { body: treasury } = await as('admin').get('/admin/stellar/treasury').expect(200);
    expect(treasury).toMatchObject({ configured: true, usdc: '1000.0000000', pendingPayoutsUsdc: '0.0000000', openUnmatched: 1 });
    const { body: deposits } = await as('admin').get('/admin/stellar/unmatched').expect(200);
    expect(deposits[0]).toMatchObject({ reason: 'no_memo', amount: '25.0000000', status: 'open', refundTxHash: null });
  });
});
