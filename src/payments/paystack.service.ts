import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

const TIMEOUT_MS = 15_000;
const BANKS_TTL_MS = 24 * 60 * 60 * 1000;

/** A failed Paystack call. `message` is Paystack's own explanation where it gave one. */
export class PaystackError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

export interface PaystackTransaction {
  status: string;
  reference: string;
  /** kobo */
  amount: number;
  currency: string;
  metadata?: { orderId?: string } | string | null;
}

export interface PaystackBank {
  name: string;
  code: string;
}

/** Thin typed wrapper over the Paystack REST API. Amounts are in kobo at this boundary. */
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly secretKey?: string;
  private readonly baseUrl: string;
  private banksCache?: { at: number; banks: PaystackBank[] };

  constructor(config: ConfigService) {
    this.secretKey = config.get<string>('PAYSTACK_SECRET_KEY') || undefined;
    this.baseUrl = (config.get<string>('PAYSTACK_BASE_URL') || 'https://api.paystack.co').replace(/\/$/, '');
    if (!this.secretKey) {
      this.logger.warn('PAYSTACK_SECRET_KEY is not set; payments and payouts are disabled.');
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.secretKey);
  }

  /** Throws the user-facing 503 when payments are not configured. */
  assertConfigured(): void {
    if (!this.secretKey) throw new ServiceUnavailableException('Payments are not available right now.');
  }

  async initialize(input: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, unknown>;
  }): Promise<{ authorizationUrl: string; reference: string }> {
    const data = await this.request<{ authorization_url: string; reference: string }>('POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amountKobo,
      reference: input.reference,
      callback_url: input.callbackUrl,
      currency: 'NGN',
      metadata: input.metadata,
    });
    return { authorizationUrl: data.authorization_url, reference: data.reference };
  }

  verify(reference: string): Promise<PaystackTransaction> {
    return this.request<PaystackTransaction>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  async listBanks(): Promise<PaystackBank[]> {
    if (this.banksCache && Date.now() - this.banksCache.at < BANKS_TTL_MS) return this.banksCache.banks;
    const data = await this.request<{ name: string; code: string; active?: boolean; is_deleted?: boolean }[]>(
      'GET',
      '/bank?country=nigeria&currency=NGN&perPage=200',
    );
    const banks = data
      .filter((b) => b.active !== false && !b.is_deleted)
      .map((b) => ({ name: b.name, code: b.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.banksCache = { at: Date.now(), banks };
    return banks;
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<string> {
    const data = await this.request<{ account_name: string }>(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    return data.account_name;
  }

  async createRecipient(input: { name: string; accountNumber: string; bankCode: string }): Promise<string> {
    const data = await this.request<{ recipient_code: string }>('POST', '/transferrecipient', {
      type: 'nuban',
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: 'NGN',
    });
    return data.recipient_code;
  }

  async transfer(input: {
    amountKobo: number;
    recipient: string;
    reference: string;
    reason: string;
  }): Promise<{ status: string; transferCode: string | null }> {
    const data = await this.request<{ status: string; transfer_code?: string }>('POST', '/transfer', {
      source: 'balance',
      amount: input.amountKobo,
      recipient: input.recipient,
      reference: input.reference,
      reason: input.reason,
    });
    return { status: data.status, transferCode: data.transfer_code ?? null };
  }

  async refund(input: { transactionReference: string; amountKobo: number }): Promise<{ id: string; status: string }> {
    const data = await this.request<{ id: number | string; status: string }>('POST', '/refund', {
      transaction: input.transactionReference,
      amount: input.amountKobo,
    });
    return { id: String(data.id), status: data.status };
  }

  /** True when `signature` is the HMAC-SHA512 of the raw request body under our secret key. */
  verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!this.secretKey || !rawBody || !signature) return false;
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    this.assertConfigured();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(`Paystack ${method} ${path} failed to connect`, err as Error);
      throw new PaystackError('Could not reach Paystack.');
    }

    let json: { status?: boolean; message?: string; data?: T } | undefined;
    try {
      json = (await response.json()) as typeof json;
    } catch {
      json = undefined;
    }
    if (!response.ok || !json?.status) {
      const message = json?.message || `Paystack responded with ${response.status}`;
      this.logger.warn(`Paystack ${method} ${path} → ${response.status}: ${message}`);
      throw new PaystackError(message, response.status);
    }
    return json.data as T;
  }
}
