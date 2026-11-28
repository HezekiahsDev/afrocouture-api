/**
 * LIVE end-to-end on Stellar TESTNET: this API + the real stellar-payment-service (as a separate
 * process) + real Horizon, real signed transactions and real webhooks. Opt-in:
 *
 *   STELLAR_LIVE=1 STELLAR_SERVICE_DIR=../stellar-payment-service SERVICE_DB_NAME=stellar_payment_service_live \
 *     DB_NAME=afrocouture_e2e_x pnpm test:e2e test/stellar-live.e2e-spec.ts
 *
 * The service must be built (pnpm build) and its database migrated. Accounts are created with
 * Friendbot each run, and "USDC" is a test asset issued by an account this test creates, so no
 * real funds or third-party faucets are involved.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { Asset, BASE_FEE, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { createTestApp, resetDatabase, tokenFor } from './helpers/test-app.js';
import { EscrowService } from '../src/escrow/escrow.service.js';
import { EscrowTransaction } from '../src/escrow/entities/escrow-transaction.entity.js';
import { Order } from '../src/orders/entities/order.entity.js';
import { User } from '../src/users/entities/user.entity.js';
import { TailorProfile } from '../src/tailors/entities/tailor-profile.entity.js';
import { MerchantProfile } from '../src/merchants/entities/merchant-profile.entity.js';
import { Fabric, FabricUnit } from '../src/fabrics/entities/fabric.entity.js';
import { KycStatus, UserRole } from '../src/types/index.js';

const live = process.env.STELLAR_LIVE === '1';
const HORIZON = 'https://horizon-testnet.stellar.org';
const SERVICE_PORT = 4611;
const horizon = new Horizon.Server(HORIZON);
const issuer = Keypair.random();
const operating = Keypair.random();
const payer = Keypair.random();
const payee = Keypair.random();
const USDC = new Asset('USDC', issuer.publicKey());
const keys = { api: randomBytes(32).toString('hex'), admin: randomBytes(32).toString('hex'), hook: randomBytes(32).toString('hex') };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false>, timeoutMs = 90_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn().catch(() => undefined);
    if (v) return v as T;
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
async function friendbot(pub: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://friendbot.stellar.org/?addr=${pub}`, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return;
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt >= 4) throw new Error(`Friendbot failed for ${pub}: ${(err as Error).message}`);
      await sleep(3000 * attempt);
    }
  }
}
async function submit(source: Keypair, ops: ReturnType<typeof Operation.payment>[], memo?: string) {
  const account = await horizon.loadAccount(source.publicKey());
  const b = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }).setTimeout(60);
  for (const op of ops) b.addOperation(op);
  if (memo) b.addMemo(Memo.text(memo));
  const tx = b.build();
  tx.sign(source);
  return horizon.submitTransaction(tx);
}
async function usdcBalance(pub: string): Promise<number> {
  const a = await horizon.loadAccount(pub);
  const line = a.balances.find((b) => 'asset_code' in b && b.asset_code === 'USDC' && 'asset_issuer' in b && b.asset_issuer === issuer.publicKey());
  return Number(line?.balance ?? 0);
}

describe.runIf(live)('LIVE testnet: API + stellar-payment-service', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let ds: DataSource;
  let service: ChildProcess;
  const serviceLog: string[] = [];
  const t: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (who: string) => ({
    get: (url: string) => http.get(url).set('Authorization', `Bearer ${t[who]}`),
    post: (url: string, body: object = {}) => http.post(url).set('Authorization', `Bearer ${t[who]}`).send(body),
  });

  beforeAll(async () => {
    // 1. Testnet accounts, trustlines, and 1000 test USDC for the payer.
    for (const k of [issuer, operating, payer, payee]) await friendbot(k.publicKey());
    for (const k of [operating, payer, payee]) await submit(k, [Operation.changeTrust({ asset: USDC })]);
    await submit(issuer, [Operation.payment({ destination: payer.publicKey(), asset: USDC, amount: '1000' })]);

    // 2. This API, listening for the service's webhooks.
    Object.assign(process.env, {
      STELLAR_SERVICE_URL: `http://127.0.0.1:${SERVICE_PORT}`,
      STELLAR_SERVICE_API_KEY: keys.api,
      STELLAR_SERVICE_ADMIN_KEY: keys.admin,
      STELLAR_WEBHOOK_SECRET: keys.hook,
    });
    app = await createTestApp();
    await app.listen(0, '127.0.0.1');
    const apiPort = (app.getHttpServer().address() as { port: number }).port;
    http = request(app.getHttpServer());
    await resetDatabase(app);
    ds = app.get(DataSource);

    // 3. The real stellar-payment-service as a separate process.
    const dir = resolve(process.env.STELLAR_SERVICE_DIR ?? '../stellar-payment-service');
    service = spawn('node', ['dist/main'], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'development',
        PORT: String(SERVICE_PORT),
        HOST: '127.0.0.1',
        DB_HOST: process.env.DB_HOST ?? 'localhost',
        DB_PORT: process.env.DB_PORT,
        DB_USER: process.env.DB_USER,
        DB_PASSWORD: process.env.DB_PASSWORD,
        DB_NAME: process.env.SERVICE_DB_NAME ?? 'stellar_payment_service_live',
        SERVICE_API_KEY: keys.api,
        ADMIN_API_KEY: keys.admin,
        WEBHOOK_URL: `http://127.0.0.1:${apiPort}/payments/stellar/webhook`,
        WEBHOOK_SECRET: keys.hook,
        STELLAR_ENABLED: 'true',
        STELLAR_PAYOUTS_ENABLED: 'true',
        STELLAR_NETWORK: 'testnet',
        STELLAR_HORIZON_URL: HORIZON,
        STELLAR_OPERATING_PUBLIC: operating.publicKey(),
        STELLAR_OPERATING_SECRET: operating.secret(),
        STELLAR_USDC_ISSUER: issuer.publicKey(),
        STELLAR_FX_SPREAD_BPS: '0',
        STELLAR_POLL_MS: '2000',
        FX_RATE_PROVIDER: 'fixed',
        FX_NGN_PER_USDC: '1500',
      },
    });
    service.stdout?.on('data', (d) => serviceLog.push(String(d)));
    service.stderr?.on('data', (d) => serviceLog.push(String(d)));
    await waitFor('the service to start', async () => (await fetch(`http://127.0.0.1:${SERVICE_PORT}/health`)).ok, 30_000);

    // 4. Users, a merchant paid in USDC, and a fabric to buy.
    const passwordHash = await bcrypt.hash('Needle2026', 4);
    const mk = async (key: string, role: UserRole) => {
      const u = await ds.getRepository(User).save(ds.getRepository(User).create({ email: `${key}@live.test`, fullName: key, role, emailVerified: true, status: 'active', passwordHash }));
      ids[key] = u.id;
      t[key] = tokenFor(app, u);
      return u;
    };
    await mk('customer', UserRole.CUSTOMER);
    await mk('admin', UserRole.ADMIN);
    const tailor = await mk('tailor', UserRole.TAILOR);
    const merchant = await mk('merchant', UserRole.MERCHANT);
    const bank = { bankName: 'GTB', bankCode: '058', accountNumber: '0123456789', accountName: 'TEST' };
    await ds.getRepository(TailorProfile).save(ds.getRepository(TailorProfile).create({ userId: tailor.id, displayName: 'N', atelierName: 'N', city: 'Lagos', state: 'Lagos', workshopAddress: '3 Way', kycStatus: KycStatus.APPROVED, ...bank }));
    ids.merchantProfile = (await ds.getRepository(MerchantProfile).save(ds.getRepository(MerchantProfile).create({
      userId: merchant.id, businessName: 'Bola', city: 'Lagos', state: 'Lagos', verificationStatus: KycStatus.APPROVED, ...bank, payoutMethod: 'stellar', stellarAddress: payee.publicKey(), stellarMemo: null,
    }))).id;
    ids.fabric = (await ds.getRepository(Fabric).save(ds.getRepository(Fabric).create({
      merchantId: ids.merchantProfile, name: 'Indigo', category: 'Ankara', price: 10000, unit: FabricUnit.YARD, imageUrl: 'https://res.cloudinary.com/x/f.jpg', isPublished: true,
    }))).id;
  }, 240_000);

  afterAll(async () => {
    service?.kill('SIGTERM');
    await app?.close();
    if (process.env.STELLAR_LIVE_LOG === '1') console.log(serviceLog.join(''));
  });

  it('pays an order, pays the merchant, refunds a double payment and flags a memo-less deposit, all on testnet', async () => {
    const { body: methods } = await http.get('/payments/methods').expect(200);
    expect(methods).toMatchObject({ stellar: true, stellarPayouts: true, stellarNetwork: 'testnet' });

    // Checkout
    const { body: order } = await as('customer').post('/orders/fabric-checkout', {
      fabrics: [{ fabricId: ids.fabric, quantity: 2 }], destination: 'customer',
      deliveryAddress: { line1: '7 Bourdillon Road, Ikoyi', city: 'Lagos', state: 'Lagos', phone: '+234 801 234 5678' },
    }).expect(201);
    const { body: intent } = await as('customer').post(`/orders/${order.id}/pay`, { method: 'stellar', payerAddress: payer.publicKey() }).expect(200);
    expect(intent).toMatchObject({ destination: operating.publicKey(), memo: `${order.reference}-S1` });

    // The customer pays on the real network; the service sees it and the webhook pays the order.
    const payment = await submit(payer, [Operation.payment({ destination: operating.publicKey(), asset: USDC, amount: intent.amount })], intent.memo);
    await waitFor('the order to be paid', async () => (await ds.getRepository(Order).findOneBy({ id: order.id }))?.status === 'paid');
    const hold = (await ds.getRepository(EscrowTransaction).findOneByOrFail({ orderId: order.id, type: 'hold' as never }));
    expect(hold).toMatchObject({ provider: 'stellar', amount: order.totalAmount, txHash: payment.hash });
    const { body: polled } = await as('customer').get(`/orders/${order.id}/stellar-intent`).expect(200);
    expect(polled.intent).toMatchObject({ status: 'paid', txHash: payment.hash });

    // Merchant payout: a real USDC transfer from the operating account.
    const before = await usdcBalance(payee.publicKey());
    const escrow = app.get(EscrowService);
    const reserved = await ds.transaction(async (em) =>
      escrow.reserveRelease(em, await em.findOneByOrFail(Order, { id: order.id }), { type: 'merchant', id: ids.merchantProfile }, 15_000),
    );
    await escrow.execute(reserved!);
    const paid = await waitFor('the payout to succeed', async () => {
      const row = await ds.getRepository(EscrowTransaction).findOneBy({ id: reserved!.id });
      return row?.status === 'success' ? row : undefined;
    });
    expect(paid.assetAmount).toBe('10.0000000');
    expect(await usdcBalance(payee.publicKey())).toBeCloseTo(before + 10, 7);

    // The customer accidentally pays again: held and refunded in full, on the network.
    const payerBefore = await usdcBalance(payer.publicKey());
    await submit(payer, [Operation.payment({ destination: operating.publicKey(), asset: USDC, amount: intent.amount })], intent.memo);
    const refund = await waitFor('the double payment to be refunded', async () => {
      const r = await ds.getRepository(EscrowTransaction).findOneBy({ orderId: order.id, type: 'refund' as never });
      return r?.status === 'success' ? r : undefined;
    }, 120_000);
    expect(refund.assetAmount).toBe(intent.amount);
    expect(await usdcBalance(payer.publicKey())).toBeCloseTo(payerBefore, 7);

    // A payment without a memo lands in the admin's unmatched deposits.
    await submit(payer, [Operation.payment({ destination: operating.publicKey(), asset: USDC, amount: '1' })]);
    const deposit = await waitFor('the unmatched deposit', async () => {
      const { body } = await as('admin').get('/admin/stellar/unmatched');
      return (body as { reason: string; amount: string }[]).find((d) => d.reason === 'no_memo' && d.amount === '1.0000000');
    });
    expect(deposit).toBeTruthy();
    const { body: treasury } = await as('admin').get('/admin/stellar/treasury').expect(200);
    expect(treasury).toMatchObject({ configured: true, network: 'testnet', canSign: true, openUnmatched: 1 });
  }, 420_000);
});
