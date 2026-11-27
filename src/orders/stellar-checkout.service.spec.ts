import { StellarCheckoutService } from './stellar-checkout.service.js';
import { StellarIntentStatus } from './entities/stellar-payment-intent.entity.js';
import { OrderStatus } from './entities/order.entity.js';
import { UnmatchedReason } from '../payments/stellar/entities/stellar-unmatched-deposit.entity.js';
import type { IncomingPayment } from '../payments/stellar/stellar.service.js';

const OPERATING = 'GOPERATING';
const ISSUER = 'GISSUER';

const intent = (extra: Record<string, unknown> = {}) => ({
  id: 'i1',
  orderId: 'o1',
  reference: 'AC-TEST01-S1',
  nairaAmount: 62_000,
  usdcAmount: '40.0000000',
  fxRate: '1550.0000000',
  expiresAt: new Date('2026-12-01T10:15:00Z'),
  status: StellarIntentStatus.AWAITING,
  payerAddress: null,
  refundAddress: null,
  refundMemo: null,
  txHash: null,
  ...extra,
});

const payment = (extra: Partial<IncomingPayment> = {}): IncomingPayment => ({
  id: '1001',
  pagingToken: '1001',
  txHash: 'abc',
  successful: true,
  from: 'GCUSTOMER',
  to: OPERATING,
  assetCode: 'USDC',
  assetIssuer: ISSUER,
  amount: '40.0000000',
  memo: 'AC-TEST01-S1',
  memoType: 'text',
  createdAt: new Date('2026-12-01T10:05:00Z'),
  ...extra,
});

function setup(opts: { intents?: any[]; midRate?: string } = {}) {
  const intents = opts.intents ?? [intent()];
  const unmatched: any[] = [];
  const applied: any[] = [];
  const order = { id: 'o1', totalAmount: 62_000, status: OrderStatus.QUOTED };
  const intentRepo = {
    findOne: async ({ where }: any) => intents.find((i) => Object.entries(where).every(([k, v]) => i[k] === v)) ?? null,
    save: async (row: any) => row,
  };
  const unmatchedRepo = {
    createQueryBuilder: () => {
      let values: any;
      const qb = {
        insert: () => qb,
        values: (v: any) => ((values = v), qb),
        orIgnore: () => qb,
        execute: async () => {
          if (unmatched.some((u) => u.operationId === values.operationId)) return { raw: [] };
          unmatched.push(values);
          return { raw: [{ id: 'u1' }] };
        },
      };
      return qb;
    },
  };
  const dataSource = {
    getRepository: (entity: { name: string }) => (entity.name === 'StellarPaymentIntent' ? intentRepo : unmatchedRepo),
  };
  const orders = {
    applyPayment: async (input: any) => {
      applied.push({ ...input, covered: input.covers(order), heldIfCovered: input.coveredHoldNaira?.(order) });
      return { order, outcome: input.covers(order) ? 'paid' : 'refunded' };
    },
  };
  const stellar = {
    operatingAddress: OPERATING,
    network: 'testnet',
    spreadBps: 0,
    lateToleranceBps: 100,
    overpayRefundBps: 100,
    isUsdc: (code: string | null, issuer: string | null) => code === 'USDC' && issuer === ISSUER,
    explorerUrl: (h: string) => `https://explorer/${h}`,
  };
  const fx = { ngnPerUsdc: async () => opts.midRate ?? '1550.0000000', isConfigured: true };
  const config = { get: (key: string) => (key === 'STELLAR_TREASURY_PUBLIC' ? undefined : undefined) };
  const alerts = { notify: vi.fn() };
  const svc = new StellarCheckoutService(dataSource as any, orders as any, {} as any, stellar as any, fx as any, config as any, alerts as any);
  return { svc, applied, unmatched, alerts };
}

describe('StellarCheckoutService', () => {
  it('settles an on-time payment of the quoted amount', async () => {
    const { svc, applied } = setup();
    await svc.handleIncoming(payment());
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      orderId: 'o1',
      holdReference: 'AC-TEST01-S1-OP1001',
      covered: true,
      heldIfCovered: 62_000,
      method: 'stellar',
      hold: { provider: 'stellar', assetAmount: '40.0000000', txHash: 'abc', destination: 'GCUSTOMER', destinationMemo: null },
    });
  });

  it('accepts a lowercase memo', async () => {
    const { svc, applied } = setup();
    await svc.handleIncoming(payment({ memo: 'ac-test01-s1' }));
    expect(applied).toHaveLength(1);
  });

  it('refunds a short payment', async () => {
    const { svc, applied } = setup();
    await svc.handleIncoming(payment({ amount: '39.9999999' }));
    expect(applied[0].covered).toBe(false);
    expect(applied[0].paidNaira).toBe(61_999);
  });

  it('holds and refunds the extra when overpaid beyond the tolerance', async () => {
    const { svc, applied } = setup();
    await svc.handleIncoming(payment({ amount: '50.0000000' }));
    expect(applied[0]).toMatchObject({ covered: true, heldIfCovered: 77_500 });
  });

  it('keeps a small overpayment within tolerance as the order total', async () => {
    const { svc, applied } = setup();
    await svc.handleIncoming(payment({ amount: '40.2000000' }));
    expect(applied[0]).toMatchObject({ covered: true, heldIfCovered: 62_000 });
  });

  it('accepts a late payment that still covers the price at today’s rate within tolerance', async () => {
    const { svc, applied } = setup({ midRate: '1560.0000000' });
    // At 1560, 62,000 NGN = 39.7435898 USDC; 40 covers it.
    await svc.handleIncoming(payment({ createdAt: new Date('2026-12-01T11:00:00Z') }));
    expect(applied[0].covered).toBe(true);
  });

  it('refunds a late payment when the naira has moved against it beyond tolerance', async () => {
    const { svc, applied } = setup({ midRate: '1500.0000000' });
    // At 1500, 62,000 NGN = 41.3333334 USDC; 40 is 3.2% short.
    await svc.handleIncoming(payment({ createdAt: new Date('2026-12-01T11:00:00Z') }));
    expect(applied[0].covered).toBe(false);
  });

  it('sends refunds to the refund address the customer gave', async () => {
    const { svc, applied } = setup({ intents: [intent({ refundAddress: 'GEXCHANGE', refundMemo: '998877' })] });
    await svc.handleIncoming(payment());
    expect(applied[0].hold).toMatchObject({ destination: 'GEXCHANGE', destinationMemo: '998877' });
  });

  it('records payments without a usable memo or in the wrong asset as unmatched, once', async () => {
    const { svc, applied, unmatched, alerts } = setup();
    await svc.handleIncoming(payment({ id: '2001', memo: null, memoType: 'none' }));
    await svc.handleIncoming(payment({ id: '2001', memo: null, memoType: 'none' }));
    await svc.handleIncoming(payment({ id: '2002', memo: 'NOPE-123' }));
    await svc.handleIncoming(payment({ id: '2003', assetIssuer: 'GFAKEISSUER' }));
    await svc.handleIncoming(payment({ id: '2004', assetCode: null, assetIssuer: null }));
    expect(applied).toHaveLength(0);
    expect(unmatched.map((u) => u.reason)).toEqual([
      UnmatchedReason.NO_MEMO,
      UnmatchedReason.UNKNOWN_MEMO,
      UnmatchedReason.WRONG_ASSET,
      UnmatchedReason.WRONG_ASSET,
    ]);
    expect(alerts.notify).toHaveBeenCalledTimes(4);
  });

  it('ignores failed transactions, outgoing payments and payments to other accounts', async () => {
    const { svc, applied, unmatched } = setup();
    await svc.handleIncoming(payment({ successful: false }));
    await svc.handleIncoming(payment({ from: OPERATING, to: 'GSOMEONE' }));
    await svc.handleIncoming(payment({ to: 'GSOMEONE' }));
    expect(applied).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
  });
});
