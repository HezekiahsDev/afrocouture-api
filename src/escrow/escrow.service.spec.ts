import { EscrowService } from './escrow.service.js';
import {
  EscrowTransaction,
  EscrowTransactionStatus as S,
  EscrowTransactionType as T,
} from './entities/escrow-transaction.entity.js';

/** In-memory EntityManager covering the calls EscrowService makes. */
function fakeManager(rows: Partial<EscrowTransaction>[]) {
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) =>
      v && typeof v === 'object' && '_value' in v ? (v._value as unknown[]).includes(row[k]) : row[k] === v,
    );
  return {
    rows,
    find: async (_e: unknown, { where }: any) => rows.filter((r) => matches(r, where)),
    exists: async (_e: unknown, { where }: any) => rows.some((r) => matches(r, where)),
    findOne: async (_e: unknown, { where }: any) => rows.find((r) => matches(r, where)) ?? null,
    create: (_e: unknown, data: any) => ({ ...data }),
    save: async (row: any) => {
      rows.push(row);
      return row;
    },
  };
}

const order = { id: 'o1', reference: 'AC-TEST01', customerId: 'c1' } as any;

describe('EscrowService', () => {
  const service = new EscrowService({ manager: undefined } as any, {} as any, {} as any);

  it('balance = successful holds − committed releases and refunds', async () => {
    const em = fakeManager([
      { orderId: 'o1', type: T.HOLD, status: S.SUCCESS, amount: 100_000 },
      { orderId: 'o1', type: T.HOLD, status: S.FAILED, amount: 999 },
      { orderId: 'o1', type: T.RELEASE_MERCHANT, status: S.SUCCESS, amount: 30_000 },
      { orderId: 'o1', type: T.RELEASE_TAILOR, status: S.PENDING, amount: 40_000 },
      { orderId: 'o1', type: T.RELEASE_TAILOR, status: S.FAILED, amount: 40_000 },
      { orderId: 'o1', type: T.REFUND, status: S.SUCCESS, amount: 5_000 },
    ]);
    expect(await service.summary('o1', em as any)).toEqual({ held: 100_000, released: 70_000, refunded: 5_000, balance: 25_000 });
  });

  it('caps a payout at the remaining balance', async () => {
    const em = fakeManager([{ orderId: 'o1', type: T.HOLD, status: S.SUCCESS, amount: 10_000 }]);
    const tx = await service.reserveRelease(em as any, order, { type: 'tailor', id: 't1' }, 25_000);
    expect(tx).toMatchObject({ amount: 10_000, status: S.PENDING, type: T.RELEASE_TAILOR, partyId: 't1' });
    expect(tx!.reference).toMatch(/^AC-TEST01-P-[0-9A-F]{8}$/);
  });

  it('pays each party at most once', async () => {
    const em = fakeManager([{ orderId: 'o1', type: T.HOLD, status: S.SUCCESS, amount: 50_000 }]);
    expect(await service.reserveRelease(em as any, order, { type: 'merchant', id: 'm1' }, 20_000)).not.toBeNull();
    expect(await service.reserveRelease(em as any, order, { type: 'merchant', id: 'm1' }, 20_000)).toBeNull();
  });

  it('allows a new payout to a party whose previous one failed', async () => {
    const em = fakeManager([
      { orderId: 'o1', type: T.HOLD, status: S.SUCCESS, amount: 50_000 },
      { orderId: 'o1', type: T.RELEASE_TAILOR, status: S.FAILED, amount: 20_000, partyId: 't1' },
    ]);
    expect(await service.reserveRelease(em as any, order, { type: 'tailor', id: 't1' }, 20_000)).toMatchObject({ amount: 20_000 });
  });

  it('reserves nothing when escrow is empty', async () => {
    const em = fakeManager([{ orderId: 'o1', type: T.HOLD, status: S.SUCCESS, amount: 1_000 }, { orderId: 'o1', type: T.REFUND, status: S.PENDING, amount: 1_000 }]);
    expect(await service.reserveRelease(em as any, order, { type: 'tailor', id: 't1' }, 500)).toBeNull();
    expect(await service.reserveRefund(em as any, order, 500)).toBeNull();
  });
});
