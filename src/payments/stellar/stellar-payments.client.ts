import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TIMEOUT_MS = 15_000;
const CONFIG_TTL_MS = 60_000;

/** A failed call to stellar-payment-service. `status` is the service's HTTP status (0 = unreachable). */
export class StellarServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'StellarServiceError';
  }

  /** 4xx: the service understood and refused (bad address, refund cap…). Retrying the same call won't help. */
  get isRejection() {
    return this.status >= 400 && this.status < 500;
  }
}

export interface ServiceConfig {
  network: 'testnet' | 'public';
  checkoutEnabled: boolean;
  payoutsEnabled: boolean;
  asset: { code: 'USDC'; issuer: string } | null;
  operatingAddress: string | null;
  quoteTtlMinutes: number;
}

export interface ServiceIntent {
  id: string;
  clientReference: string;
  reference: string;
  status: 'awaiting' | 'received' | 'expired';
  network: 'testnet' | 'public';
  destination: string;
  memo: string;
  memoType: 'text';
  asset: { code: 'USDC'; issuer: string | null };
  amount: string;
  nairaAmount: number;
  fxRate: string;
  expiresAt: string;
  payerAddress: string | null;
  refundAddress: string | null;
  refundMemo: string | null;
  metadata: Record<string, unknown> | null;
  sep7Uri: string | null;
  createdAt: string;
}

export interface ServicePayment {
  id: string;
  intentId: string;
  txHash: string;
  fromAddress: string;
  amount: string;
  onTime: boolean;
  coversQuote: boolean;
  overpaid: boolean;
  nairaValue: number;
  fxRate: string;
  refundDestination: string;
  receivedAt: string;
}

export interface ServiceTransfer {
  id: string;
  clientReference: string;
  kind: 'payout' | 'refund' | 'deposit_refund';
  status: 'pending' | 'success' | 'failed';
  destination: string;
  memo: string | null;
  nairaAmount: number | null;
  amount: string;
  fxRate: string | null;
  paymentId: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  failureReason: string | null;
  attempts: number;
}

export interface ServiceDeposit {
  id: string;
  operationId: string;
  txHash: string;
  fromAddress: string;
  amount: string;
  assetCode: string | null;
  assetIssuer: string | null;
  memo: string | null;
  reason: 'no_memo' | 'unknown_memo' | 'wrong_asset';
  status: 'open' | 'attached' | 'refunded' | 'dismissed';
  paymentId: string | null;
  transferId: string | null;
  note: string | null;
  receivedAt: string;
  updatedAt: string;
}

export type AddressCheck =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'not_found' | 'no_trustline' | 'not_authorized' | 'unavailable'; message: string };

/**
 * HTTP client for stellar-payment-service, which owns everything Stellar: quotes, watching
 * payments, exactly-once payouts/refunds, FX, unmatched deposits and the treasury. This API
 * keeps orders and the naira escrow ledger and never holds Stellar keys.
 * Env: STELLAR_SERVICE_URL, STELLAR_SERVICE_API_KEY, STELLAR_SERVICE_ADMIN_KEY (admin console only).
 */
@Injectable()
export class StellarPaymentsClient {
  private readonly logger = new Logger(StellarPaymentsClient.name);
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private readonly adminKey: string | null;
  private configCache?: { at: number; value: ServiceConfig | null };

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('STELLAR_SERVICE_URL')?.trim().replace(/\/$/, '') || null;
    this.apiKey = config.get<string>('STELLAR_SERVICE_API_KEY')?.trim() || null;
    this.adminKey = config.get<string>('STELLAR_SERVICE_ADMIN_KEY')?.trim() || null;
    if (!this.isConfigured) this.logger.warn('STELLAR_SERVICE_URL/STELLAR_SERVICE_API_KEY not set: Stellar payments are off.');
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /** The service's switches, cached for a minute. Null when unreachable or unconfigured. */
  async serviceConfig(): Promise<ServiceConfig | null> {
    if (!this.isConfigured) return null;
    if (this.configCache && Date.now() - this.configCache.at < CONFIG_TTL_MS) return this.configCache.value;
    let value: ServiceConfig | null = null;
    try {
      value = await this.request<ServiceConfig>('GET', '/v1/config');
    } catch (err) {
      this.logger.warn(`stellar-payment-service config unavailable: ${(err as Error).message}`);
    }
    this.configCache = { at: Date.now(), value };
    return value;
  }

  async checkoutEnabled() {
    return Boolean((await this.serviceConfig())?.checkoutEnabled);
  }

  async payoutsEnabled() {
    return Boolean((await this.serviceConfig())?.payoutsEnabled);
  }

  explorerUrl(hash: string, network: 'testnet' | 'public' = this.configCache?.value?.network ?? 'testnet') {
    return `https://stellar.expert/explorer/${network}/tx/${hash}`;
  }

  // ── Checkout ──

  createIntent(body: {
    clientReference: string;
    nairaAmount: number;
    payerAddress?: string;
    refundAddress?: string;
    refundMemo?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request<ServiceIntent>('POST', '/v1/intents', body);
  }

  getIntent(id: string) {
    return this.request<ServiceIntent & { payments: ServicePayment[] }>('GET', `/v1/intents/${encodeURIComponent(id)}`);
  }

  listIntents(clientReference: string) {
    return this.request<ServiceIntent[]>('GET', `/v1/intents?clientReference=${encodeURIComponent(clientReference)}`);
  }

  // ── Transfers (idempotent on clientReference) ──

  createPayout(body: { clientReference: string; destination: string; nairaAmount: number; memo?: string }) {
    return this.request<ServiceTransfer>('POST', '/v1/transfers', { kind: 'payout', ...body });
  }

  createRefund(body: { clientReference: string; paymentId: string; share: { part: number; whole: number } }) {
    return this.request<ServiceTransfer>('POST', '/v1/transfers', { kind: 'refund', ...body });
  }

  retryTransfer(id: string) {
    return this.request<ServiceTransfer>('POST', `/v1/transfers/${encodeURIComponent(id)}/retry`);
  }

  checkAddress(address: string) {
    return this.request<AddressCheck>('GET', `/v1/addresses/${encodeURIComponent(address)}`);
  }

  // ── Admin (needs STELLAR_SERVICE_ADMIN_KEY) ──

  treasury() {
    return this.request<Record<string, unknown>>('GET', '/v1/admin/treasury', undefined, true);
  }

  listDeposits(status: string) {
    return this.request<ServiceDeposit[]>('GET', `/v1/admin/deposits?status=${encodeURIComponent(status)}`, undefined, true);
  }

  attachDeposit(id: string, intentReference: string) {
    return this.request<{ deposit: ServiceDeposit; payment: ServicePayment }>('POST', `/v1/admin/deposits/${id}/attach`, { intentReference }, true);
  }

  refundDeposit(id: string, body: { clientReference: string; destination: string; memo?: string }) {
    return this.request<{ deposit: ServiceDeposit; transfer: ServiceTransfer }>('POST', `/v1/admin/deposits/${id}/refund`, body, true);
  }

  dismissDeposit(id: string, note: string) {
    return this.request<ServiceDeposit>('POST', `/v1/admin/deposits/${id}/dismiss`, { note }, true);
  }

  // ── Internals ──

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, admin = false): Promise<T> {
    if (!this.isConfigured) throw new StellarServiceError('Stellar payments are not configured.', 0);
    const key = admin ? this.adminKey : this.apiKey;
    if (!key) throw new StellarServiceError('STELLAR_SERVICE_ADMIN_KEY is not set.', 0);
    let res: Response;
    try {
      const headers: Record<string, string> = { authorization: `Bearer ${key}` };
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
      if (method === 'POST') {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body ?? {});
      }
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new StellarServiceError(`stellar-payment-service unreachable: ${(err as Error).message}`, 0);
    }
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // keep the raw text
    }
    if (!res.ok) {
      const message = (data as { message?: string | string[] } | null)?.message;
      throw new StellarServiceError(Array.isArray(message) ? message.join('; ') : message || `HTTP ${res.status}`, res.status, data);
    }
    return data as T;
  }
}

/** Turns a service error into the HTTP error this API should return to its own caller. */
export function toHttpError(err: unknown, unavailable = 'Stellar payments are not available right now.'): never {
  if (err instanceof StellarServiceError) {
    if (err.isRejection && err.status !== HttpStatus.UNAUTHORIZED && err.status !== HttpStatus.FORBIDDEN) {
      throw new HttpException(err.message, err.status);
    }
    throw new ServiceUnavailableException(err.status === HttpStatus.SERVICE_UNAVAILABLE ? err.message : unavailable);
  }
  throw err;
}
