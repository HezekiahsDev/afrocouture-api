import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  AccountRequiresMemoError,
  Asset,
  BadResponseError,
  Horizon,
  Keypair,
  Memo,
  NetworkError,
  Networks,
  NotFoundError,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { REDIS } from '../../common/redis/redis.module.js';
import { fromStroops, toStroops } from './money.js';

/** A failed Stellar call. `code` is Horizon's result code where there was one. */
export class StellarError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'StellarError';
  }
}

export interface IncomingPayment {
  /** Horizon operation id. */
  id: string;
  pagingToken: string;
  txHash: string;
  successful: boolean;
  from: string;
  to: string;
  /** null for XLM. */
  assetCode: string | null;
  assetIssuer: string | null;
  /** Decimal string with 7 places. */
  amount: string;
  memo: string | null;
  memoType: string | null;
  createdAt: Date;
}

export type AddressCheck =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'not_found' | 'no_trustline' | 'not_authorized' | 'unavailable'; message: string };

export type SubmitResult =
  | { status: 'success' }
  /** Definitely not applied: safe to mark failed and retry with a new transaction. */
  | { status: 'failed'; code: string; reason: string }
  /** Might still land (timeout, 5xx): leave pending for the reconciler. */
  | { status: 'unknown'; reason: string };

export interface SignedPayment {
  hash: string;
  xdr: string;
  /** The transaction can't be included in a ledger that closes after this. */
  maxTime: Date;
}

/** Text memos are at most 28 bytes. */
export const MAX_TEXT_MEMO_BYTES = 28;
const MAX_FEE_STROOPS = '10000';
const TX_TIMEOUT_SEC = 60;
const LOCK_KEY = 'stellar:operating:submit';
const LOCK_TTL_MS = 30_000;

const PAYMENT_TYPES = new Set(['payment', 'path_payment_strict_receive', 'path_payment_strict_send']);

/** Plain-language reasons for Horizon result codes an admin may see on a failed payout. */
const RESULT_REASONS: Record<string, string> = {
  op_no_trust: "The payee's Stellar account doesn't accept USDC (no USDC trustline).",
  op_not_authorized: "The USDC issuer hasn't authorized the payee's account.",
  op_no_destination: "The payee's Stellar account doesn't exist.",
  op_line_full: "The payee's USDC trustline limit is full.",
  op_underfunded: "The operating account doesn't have enough USDC. Top it up from Treasury.",
  op_src_no_trust: "The operating account has no USDC trustline.",
  tx_insufficient_balance: "The operating account doesn't have enough XLM for fees and reserves.",
  tx_insufficient_fee: 'The network fee was too low (network surge). Retry later.',
  tx_bad_seq: 'Another transaction used the same sequence number. Retry.',
  tx_too_late: 'The transaction expired before it was included. Retry.',
  tx_bad_auth: 'The operating key is wrong or no longer a signer on the account.',
  memo_required: 'This address requires a memo (it belongs to an exchange). Add the memo to the payout details.',
};

/**
 * Wrapper over Horizon for USDC on Stellar: checking payee addresses, reading
 * payments into the operating account, and signing/submitting payouts.
 * Amounts are decimal strings at this boundary; callers work in stroops.
 */
@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  readonly checkoutEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly network: 'testnet' | 'public';
  readonly operatingAddress: string | null;
  readonly usdc: Asset | null;
  readonly quoteTtlMinutes: number;
  readonly spreadBps: number;
  readonly lateToleranceBps: number;
  readonly overpayRefundBps: number;
  readonly floatMaxUsdc: bigint | null;
  readonly minXlm: bigint;
  private readonly passphrase: string;
  private readonly server: Horizon.Server | null;
  private readonly keypair: Keypair | null;
  /** In-process queue so this instance never signs two transactions on the same sequence number. */
  private submitChain: Promise<unknown> = Promise.resolve();

  constructor(
    config: ConfigService,
    @Optional() @Inject(REDIS) private readonly redis?: Redis,
  ) {
    const flag = (key: string) => String(config.get(key) ?? '').toLowerCase() === 'true';
    const num = (key: string, fallback: number) => {
      const value = Number(config.get(key));
      return Number.isFinite(value) && config.get(key) !== undefined && config.get(key) !== '' ? value : fallback;
    };

    this.network = config.get<string>('STELLAR_NETWORK') === 'public' ? 'public' : 'testnet';
    this.passphrase = this.network === 'public' ? Networks.PUBLIC : Networks.TESTNET;
    const horizonUrl =
      config.get<string>('STELLAR_HORIZON_URL') ||
      (this.network === 'public' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');

    const operating = config.get<string>('STELLAR_OPERATING_PUBLIC')?.trim() || null;
    const secret = config.get<string>('STELLAR_OPERATING_SECRET')?.trim() || null;
    const issuer = config.get<string>('STELLAR_USDC_ISSUER')?.trim() || null;

    this.operatingAddress = operating && StrKey.isValidEd25519PublicKey(operating) ? operating : null;
    this.usdc = issuer && StrKey.isValidEd25519PublicKey(issuer) ? new Asset('USDC', issuer) : null;
    this.keypair = null;
    if (secret) {
      try {
        const keypair = Keypair.fromSecret(secret);
        if (keypair.publicKey() === this.operatingAddress) this.keypair = keypair;
        else this.logger.error('STELLAR_OPERATING_SECRET does not belong to STELLAR_OPERATING_PUBLIC; signing is disabled.');
      } catch {
        this.logger.error('STELLAR_OPERATING_SECRET is not a valid Stellar secret key; signing is disabled.');
      }
    }

    const configured = Boolean(this.operatingAddress && this.usdc);
    this.server = configured ? new Horizon.Server(horizonUrl, { allowHttp: horizonUrl.startsWith('http://') }) : null;
    this.checkoutEnabled = flag('STELLAR_ENABLED') && configured;
    this.payoutsEnabled = flag('STELLAR_PAYOUTS_ENABLED') && configured && Boolean(this.keypair);

    this.quoteTtlMinutes = Math.max(1, num('STELLAR_QUOTE_TTL_MIN', 15));
    this.spreadBps = Math.max(0, num('STELLAR_FX_SPREAD_BPS', 150));
    this.lateToleranceBps = Math.max(0, num('STELLAR_LATE_TOLERANCE_BPS', 100));
    this.overpayRefundBps = Math.max(0, num('STELLAR_OVERPAY_REFUND_BPS', 100));
    const floatMax = config.get<string>('STELLAR_FLOAT_MAX_USDC');
    this.floatMaxUsdc = floatMax ? toStroops(String(floatMax)) : null;
    this.minXlm = toStroops(String(config.get('STELLAR_MIN_XLM') ?? '20'));

    if (flag('STELLAR_ENABLED') && !configured) {
      this.logger.error('STELLAR_ENABLED is true but STELLAR_OPERATING_PUBLIC or STELLAR_USDC_ISSUER is missing or invalid.');
    }
    if (this.checkoutEnabled && !this.keypair) {
      this.logger.warn('Stellar checkout is on without STELLAR_OPERATING_SECRET: refunds of Stellar payments will fail until it is set.');
    }
    if (flag('STELLAR_PAYOUTS_ENABLED') && !this.payoutsEnabled) {
      this.logger.error('STELLAR_PAYOUTS_ENABLED is true but the operating account or its secret is missing; Stellar payouts are off.');
    }
  }

  /** Watching for payments needs only the public side; signing needs the secret. */
  get isConfigured(): boolean {
    return this.server !== null;
  }

  get canSign(): boolean {
    return this.keypair !== null && this.server !== null;
  }

  assertCheckoutEnabled(): void {
    if (!this.checkoutEnabled) throw new ServiceUnavailableException('Stellar payments are not available right now.');
  }

  explorerUrl(hash: string): string {
    return `https://stellar.expert/explorer/${this.network}/tx/${hash}`;
  }

  /** SEP-7 link wallets open to pre-fill the payment. */
  payUri(input: { amount: string; memo: string }): string {
    const params = new URLSearchParams({
      destination: this.operatingAddress!,
      amount: input.amount,
      asset_code: this.usdc!.getCode(),
      asset_issuer: this.usdc!.getIssuer() ?? '',
      memo: input.memo,
      memo_type: 'MEMO_TEXT',
    });
    return `web+stellar:pay?${params.toString()}`;
  }

  isUsdc(code: string | null, issuer: string | null): boolean {
    return Boolean(this.usdc && code === this.usdc.getCode() && issuer === this.usdc.getIssuer());
  }

  // ── Reads ──

  /** Whether USDC can be sent to `address` right now. */
  async checkAddress(address: string): Promise<AddressCheck> {
    const value = address.trim();
    if (!StrKey.isValidEd25519PublicKey(value)) {
      return { ok: false, reason: 'invalid', message: 'That is not a valid Stellar address (it should start with G and be 56 characters).' };
    }
    try {
      const account = await this.horizon().loadAccount(value);
      const line = account.balances.find(
        (b) => 'asset_code' in b && b.asset_code === this.usdc!.getCode() && 'asset_issuer' in b && b.asset_issuer === this.usdc!.getIssuer(),
      ) as { is_authorized?: boolean } | undefined;
      if (!line) {
        return { ok: false, reason: 'no_trustline', message: 'This account does not accept USDC yet. Add USDC (Circle) in your wallet, then try again.' };
      }
      if (line.is_authorized === false) {
        return { ok: false, reason: 'not_authorized', message: 'USDC is not authorized on this account.' };
      }
      return { ok: true };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return { ok: false, reason: 'not_found', message: 'This Stellar account does not exist yet. Fund it with a little XLM first.' };
      }
      this.logger.warn(`Address check failed: ${(err as Error).message}`);
      return { ok: false, reason: 'unavailable', message: 'We could not reach the Stellar network. Please try again.' };
    }
  }

  /**
   * Payment operations on the operating account after `cursor`, oldest first, with each
   * transaction's memo. `lastToken` is the last record read (payment or not), `count` how many.
   */
  async incomingPayments(cursor: string | null, limit = 100): Promise<{ payments: IncomingPayment[]; lastToken: string | null; count: number }> {
    let builder = this.horizon().payments().forAccount(this.operatingAddress!).order('asc').limit(limit).join('transactions');
    if (cursor) builder = builder.cursor(cursor);
    const page = await builder.call();
    const records = page.records as unknown as { paging_token: string }[];
    const payments = page.records
      .filter((r) => PAYMENT_TYPES.has(r.type))
      .map((r) => {
        const op = r as unknown as {
          id: string;
          paging_token: string;
          transaction_hash: string;
          transaction_successful: boolean;
          from: string;
          to: string;
          asset_type: string;
          asset_code?: string;
          asset_issuer?: string;
          amount: string;
          created_at: string;
          transaction_attr?: { memo?: string; memo_type?: string; successful?: boolean };
        };
        return {
          id: op.id,
          pagingToken: op.paging_token,
          txHash: op.transaction_hash,
          successful: op.transaction_attr?.successful ?? op.transaction_successful,
          from: op.from,
          to: op.to,
          assetCode: op.asset_type === 'native' ? null : (op.asset_code ?? null),
          assetIssuer: op.asset_type === 'native' ? null : (op.asset_issuer ?? null),
          amount: op.amount,
          memo: op.transaction_attr?.memo ?? null,
          memoType: op.transaction_attr?.memo_type ?? null,
          createdAt: new Date(op.created_at),
        };
      });
    return { payments, lastToken: records.at(-1)?.paging_token ?? null, count: records.length };
  }

  /** USDC and XLM held by the operating account, in stroops. */
  async operatingBalances(): Promise<{ usdc: bigint; xlm: bigint }> {
    const account = await this.horizon().loadAccount(this.operatingAddress!);
    let usdc = 0n;
    let xlm = 0n;
    for (const b of account.balances) {
      if (b.asset_type === 'native') xlm = toStroops(b.balance);
      else if ('asset_code' in b && this.isUsdc(b.asset_code, b.asset_issuer)) usdc = toStroops(b.balance);
    }
    return { usdc, xlm };
  }

  /** Outcome of a transaction we signed earlier. */
  async transactionStatus(hash: string): Promise<'success' | 'failed' | 'not_found'> {
    try {
      const tx = await this.horizon().transactions().transaction(hash).call();
      return tx.successful ? 'success' : 'failed';
    } catch (err) {
      if (err instanceof NotFoundError) return 'not_found';
      throw new StellarError(`Could not look up transaction ${hash}: ${(err as Error).message}`);
    }
  }

  /** Close time of the newest ledger: once it passes a transaction's maxTime, that transaction can never land. */
  async latestLedgerCloseTime(): Promise<Date> {
    const page = await this.horizon().ledgers().order('desc').limit(1).call();
    const closedAt = page.records[0]?.closed_at;
    if (!closedAt) throw new StellarError('Horizon returned no ledgers');
    return new Date(closedAt);
  }

  // ── Writes ──

  /**
   * Runs `fn` while holding the submit lock, so one transaction at a time is built and
   * sent from the operating account (each one consumes the next sequence number).
   */
  async withSubmitLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const token = randomUUID();
      const locked = await this.acquireRedisLock(token);
      try {
        return await fn();
      } finally {
        if (locked) await this.releaseRedisLock(token);
      }
    };
    const result = this.submitChain.then(run, run);
    this.submitChain = result.catch(() => undefined);
    return result;
  }

  /** Builds and signs a USDC payment from the operating account. Call inside `withSubmitLock`. */
  async signPayment(input: { to: string; stroops: bigint; memo: string | null }): Promise<SignedPayment> {
    if (!this.keypair) throw new StellarError('The operating account secret is not configured.');
    if (input.stroops <= 0n) throw new StellarError('Payment amount must be positive.');
    let source;
    try {
      source = await this.horizon().loadAccount(this.operatingAddress!);
    } catch (err) {
      throw new StellarError(`Could not load the operating account: ${(err as Error).message}`);
    }
    const tx = new TransactionBuilder(source, { fee: MAX_FEE_STROOPS, networkPassphrase: this.passphrase })
      .addOperation(Operation.payment({ destination: input.to, asset: this.usdc!, amount: fromStroops(input.stroops) }))
      .addMemo(toMemo(input.memo))
      .setTimeout(TX_TIMEOUT_SEC)
      .build();
    tx.sign(this.keypair);
    const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
    return { hash: Buffer.from(tx.hash()).toString('hex'), xdr: tx.toXDR(), maxTime: new Date(maxTime * 1000) };
  }

  async submit(xdr: string): Promise<SubmitResult> {
    const tx = TransactionBuilder.fromXDR(xdr, this.passphrase);
    try {
      const res = await this.horizon().submitTransaction(tx);
      return res.successful ? { status: 'success' } : { status: 'failed', code: 'tx_failed', reason: 'The transaction failed on the network.' };
    } catch (err) {
      if (err instanceof AccountRequiresMemoError) {
        return { status: 'failed', code: 'memo_required', reason: RESULT_REASONS.memo_required };
      }
      if (err instanceof BadResponseError || err instanceof NetworkError) {
        const status = err.response?.status;
        const codes = (err.response?.data as { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } | undefined)
          ?.extras?.result_codes;
        // 400 with result codes: the network rejected it, so it was not (and will not be) applied.
        if (status === 400 && codes?.transaction) {
          const code = codes.operations?.find((c) => c !== 'op_success') ?? codes.transaction;
          return { status: 'failed', code, reason: RESULT_REASONS[code] ?? `Rejected by the network (${code}).` };
        }
        return { status: 'unknown', reason: `Horizon did not confirm the transaction (${status ?? 'no response'}).` };
      }
      return { status: 'unknown', reason: `Could not reach Horizon: ${(err as Error).message}` };
    }
  }

  // ── Internals ──

  private horizon(): Horizon.Server {
    if (!this.server) throw new StellarError('Stellar is not configured.');
    return this.server;
  }

  /** Cross-instance lock; Redis is optional, so failures fall back to the in-process queue. */
  private async acquireRedisLock(token: string): Promise<boolean> {
    if (!this.redis) return false;
    const deadline = Date.now() + LOCK_TTL_MS;
    try {
      while (Date.now() < deadline) {
        if ((await this.redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK') return true;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      this.logger.warn('Timed out waiting for the Stellar submit lock; continuing (a sequence clash fails safely).');
    } catch (err) {
      this.logger.warn(`Stellar submit lock unavailable: ${(err as Error).message}`);
    }
    return false;
  }

  private async releaseRedisLock(token: string): Promise<void> {
    try {
      await this.redis!.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        LOCK_KEY,
        token,
      );
    } catch {
      // The lock expires on its own.
    }
  }
}

/** Numeric memos (what most exchanges hand out) go as MEMO_ID; anything else as MEMO_TEXT. */
export function toMemo(memo: string | null): Memo {
  if (!memo) return Memo.none();
  if (/^\d{1,20}$/.test(memo) && BigInt(memo) <= 18_446_744_073_709_551_615n) return Memo.id(memo);
  return Memo.text(memo);
}

/** Whether `memo` can be sent (a valid id or a text memo of at most 28 bytes). */
export function isValidMemo(memo: string): boolean {
  if (/^\d{1,20}$/.test(memo) && BigInt(memo) <= 18_446_744_073_709_551_615n) return true;
  return Buffer.byteLength(memo, 'utf8') <= MAX_TEXT_MEMO_BYTES;
}
