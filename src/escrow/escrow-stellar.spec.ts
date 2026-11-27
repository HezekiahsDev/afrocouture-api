import { EscrowService } from './escrow.service.js';
import {
  EscrowTransaction,
  EscrowTransactionStatus as S,
  EscrowTransactionType as T,
  PaymentProvider as P,
} from './entities/escrow-transaction.entity.js';
import { toStroops } from '../payments/stellar/money.js';

/** In-memory repository: plain equality plus TypeORM's IsNull / In / Not operators. */
function fakeRepo(rows: any[]) {
  const test = (value: any, cond: any): boolean => {
    if (cond && typeof cond === 'object' && '_type' in cond) {
      if (cond._type === 'isNull') return value === null || value === undefined;
      if (cond._type === 'in') return (cond._value as unknown[]).includes(value);
      if (cond._type === 'not') return !test(value, cond._value);
    }
    return value === cond;
  };
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => test(row[k], v));
  return {
    rows,
    find: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)),
    findOne: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    update: async (where: any, patch: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, patch, { updatedAt: new Date() }));
      return { affected: hit.length };
    },
    save: async (row: any) => {
      const existing = rows.find((r) => r.id === row.id);
      if (existing) Object.assign(existing, row);
      else rows.push(row);
      return row;
    },
  };
}

function fakeStellar(overrides: Partial<Record<string, any>> = {}) {
  const calls = { signed: [] as any[], submitted: [] as string[] };
  let n = 0;
  return {
    calls,
    isConfigured: true,
    canSign: true,
    payoutsEnabled: true,
    withSubmitLock: async (fn: () => Promise<unknown>) => fn(),
    signPayment: async (input: any) => {
      calls.signed.push(input);
      n++;
      return { hash: `hash${n}`, xdr: `xdr${n}`, maxTime: new Date('2026-12-01T10:01:00Z') };
    },
    submit: async (xdr: string) => {
      calls.submitted.push(xdr);
      return { status: 'success' };
    },
    transactionStatus: async () => 'not_found',
    latestLedgerCloseTime: async () => new Date('2026-12-01T10:00:30Z'),
    ...overrides,
  };
}

const hold = (extra: Partial<EscrowTransaction> = {}) => ({
  id: 'h1',
  orderId: 'o1',
  type: T.HOLD,
  status: S.SUCCESS,
  amount: 62_000,
  reference: 'AC-TEST01-S1-OP123',
  provider: P.STELLAR,
  assetAmount: '40.0000000',
  fxRate: '1550.0000000',
  destination: 'GCUSTOMER',
  destinationMemo: null,
  ...extra,
});

const pendingRefund = (extra: Partial<EscrowTransaction> = {}) => ({
  id: 'r1',
  orderId: 'o1',
  type: T.REFUND,
  status: S.PENDING,
  amount: 31_000,
  partyType: 'customer',
  partyId: 'c1',
  reference: 'AC-TEST01-R-AAAA1111',
  provider: P.STELLAR,
  holdReference: 'AC-TEST01-S1-OP123',
  txHash: null,
  submittedUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra,
});

function service(rows: any[], stellar: any, fx: any = { ngnPerUsdc: async () => '1600.0000000' }, profiles: any = {}) {
  const repo = fakeRepo(rows);
  const dataSource = {
    manager: undefined,
    getRepository: () => ({ findOne: async ({ where }: any) => profiles[where.id] ?? null }),
  };
  const alerts = { notify: vi.fn() };
  return { svc: new EscrowService(dataSource as any, repo as any, {} as any, alerts as any, stellar, fx), repo, alerts };
}

describe('EscrowService — Stellar', () => {
  it('refunds the same share of the USDC the customer paid, to the hold destination', async () => {
    const stellar = fakeStellar();
    const rows = [hold(), pendingRefund()];
    const { svc } = service(rows, stellar);
    const tx = await svc.execute(rows[1] as any);
    expect(stellar.calls.signed[0]).toEqual({ to: 'GCUSTOMER', stroops: toStroops('20'), memo: null });
    expect(tx).toMatchObject({ status: S.SUCCESS, txHash: 'hash1', assetAmount: '20.0000000', destination: 'GCUSTOMER' });
  });

  it('pays a payee in USDC at the payout-day rate, rounded down, with their memo', async () => {
    const stellar = fakeStellar();
    const payout = { ...pendingRefund(), id: 'p1', type: T.RELEASE_TAILOR, partyType: 'tailor', partyId: 't1', amount: 16_000, holdReference: null, reference: 'AC-TEST01-P-BBBB2222' };
    const { svc } = service([hold(), payout], stellar, undefined, { t1: { stellarAddress: 'GTAILOR', stellarMemo: '12345' } });
    const tx = await svc.execute(payout as any);
    expect(stellar.calls.signed[0]).toEqual({ to: 'GTAILOR', stroops: toStroops('10'), memo: '12345' });
    expect(tx).toMatchObject({ status: S.SUCCESS, fxRate: '1600.0000000' });
  });

  it('never signs twice: a row that already has a hash is left to the reconciler', async () => {
    const stellar = fakeStellar();
    const rows = [hold(), pendingRefund({ txHash: 'hash-existing' })];
    const { svc } = service(rows, stellar);
    await svc.execute(rows[1] as any);
    await svc.execute(rows[1] as any);
    expect(stellar.calls.signed).toHaveLength(0);
  });

  it('only one of two concurrent executions claims the row', async () => {
    const stellar = fakeStellar();
    const rows = [hold(), pendingRefund()];
    const { svc } = service(rows, stellar);
    // Two workers holding stale copies of the same pending row.
    const a = { ...rows[1] };
    const b = { ...rows[1] };
    await Promise.all([svc.execute(a as any), svc.execute(b as any)]);
    expect(stellar.calls.signed).toHaveLength(1);
  });

  it('marks a network rejection failed and alerts', async () => {
    const stellar = fakeStellar({ submit: async () => ({ status: 'failed', code: 'op_no_trust', reason: 'no trustline' }) });
    const rows = [hold(), pendingRefund()];
    const { svc, alerts } = service(rows, stellar);
    const tx = await svc.execute(rows[1] as any);
    expect(tx).toMatchObject({ status: S.FAILED, failureReason: 'no trustline' });
    expect(alerts.notify).toHaveBeenCalled();
  });

  it('leaves an unconfirmed submission pending with its hash recorded', async () => {
    const stellar = fakeStellar({ submit: async () => ({ status: 'unknown', reason: 'timeout' }) });
    const rows = [hold(), pendingRefund()];
    const { svc } = service(rows, stellar);
    const tx = await svc.execute(rows[1] as any);
    expect(tx).toMatchObject({ status: S.PENDING, txHash: 'hash1' });
    expect(rows[1].submittedUntil).toEqual(new Date('2026-12-01T10:01:00Z'));
  });

  it('reconciler confirms a landed transaction', async () => {
    const stellar = fakeStellar({ transactionStatus: async () => 'success' });
    const rows = [hold(), pendingRefund({ txHash: 'hash1', submittedUntil: new Date('2026-12-01T10:01:00Z') })];
    const { svc } = service(rows, stellar);
    await svc.reconcileStellar();
    expect(rows[1].status).toBe(S.SUCCESS);
  });

  it('reconciler keeps a missing transaction pending until its time bound has passed, then fails it', async () => {
    let ledger = new Date('2026-12-01T10:00:30Z');
    const stellar = fakeStellar({ latestLedgerCloseTime: async () => ledger });
    const rows = [hold(), pendingRefund({ txHash: 'hash1', submittedUntil: new Date('2026-12-01T10:01:00Z') })];
    const { svc } = service(rows, stellar);
    await svc.reconcileStellar();
    expect(rows[1].status).toBe(S.PENDING);
    ledger = new Date('2026-12-01T10:01:05Z');
    await svc.reconcileStellar();
    expect(rows[1].status).toBe(S.FAILED);
  });

  it('reconciler releases a stale claim (nothing was signed) and sends rows a restart left unsent', async () => {
    const stellar = fakeStellar();
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const rows = [
      hold(),
      pendingRefund({ id: 'r1', txHash: 'claim:abc', updatedAt: old }),
      pendingRefund({ id: 'r2', reference: 'AC-TEST01-R-CCCC3333', createdAt: old }),
    ];
    const { svc } = service(rows, stellar);
    await svc.reconcileStellar();
    expect(rows[1].txHash).toBeNull();
    expect(rows[2]).toMatchObject({ status: S.SUCCESS, txHash: 'hash1' });
  });

  it('fails clearly when the payee has no Stellar address', async () => {
    const stellar = fakeStellar();
    const payout = { ...pendingRefund(), id: 'p1', type: T.RELEASE_MERCHANT, partyType: 'merchant', partyId: 'm1', holdReference: null };
    const { svc } = service([hold(), payout], stellar, undefined, { m1: { stellarAddress: null } });
    const tx = await svc.execute(payout as any);
    expect(tx.status).toBe(S.FAILED);
    expect(tx.failureReason).toMatch(/no Stellar address/);
    expect(stellar.calls.signed).toHaveLength(0);
  });
});
