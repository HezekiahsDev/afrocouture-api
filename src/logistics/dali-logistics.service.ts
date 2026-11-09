import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

const TIMEOUT_MS = 15_000;
const PARTNER_PATH = '/api/v1/partner/v1';
const SIGNATURE_TOLERANCE_SEC = 300;

/** A failed Dali call. `message` is Dali's own explanation where it gave one. */
export class DaliError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DaliError';
  }
}

export interface DaliCoordinates {
  lat: number;
  lng: number;
}

export interface DaliStop extends DaliCoordinates {
  label?: string;
  address: string;
  contact_name: string;
  contact_phone: string;
}

export interface DaliQuote {
  fee: number;
  currency: string;
  distance_m: number;
  zone_id: string | null;
  zone_name: string | null;
  expires_at: string;
}

export interface DaliRunner {
  name: string;
  phone: string;
  vehicle: string;
  rating?: number | null;
}

export interface DaliDelivery {
  id: string;
  external_reference: string;
  status: string;
  livemode: boolean;
  fee: number;
  currency: string;
  distance_m: number | null;
  delivery_pin: string | null;
  runner: DaliRunner | null;
  pickup?: DaliStop;
  dropoff?: DaliStop;
  timestamps?: Record<string, string | null>;
}

export interface DaliAccount {
  id: string;
  name: string;
  slug: string;
  status: string;
  billing_mode: string;
  webhook_url: string | null;
  daily_job_cap: number;
  environment: string;
  scopes: string[];
  balance: number;
  currency: string;
  jobs_last_24h: number;
}

export interface DaliWebhookEvent {
  id: string;
  type: string;
  created_at?: string;
  livemode?: boolean;
  data?: {
    job_id?: string;
    external_reference?: string;
    status?: string;
    fee?: number;
    currency?: string;
    runner?: DaliRunner | null;
    timestamps?: Record<string, string | null>;
    [key: string]: unknown;
  };
}

/**
 * Thin typed wrapper over the Dali Logistics partner API.
 * The key is server-side only; the base URL may be the origin or already include the
 * partner path (both are accepted).
 */
@Injectable()
export class DaliLogisticsService {
  private readonly logger = new Logger(DaliLogisticsService.name);
  private readonly apiKey?: string;
  private readonly webhookSecret?: string;
  private readonly apiBase: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('DALI_LOGISTICS_API_KEY') || undefined;
    this.webhookSecret = config.get<string>('DALI_LOGISTICS_WEBHOOK_SECRET') || undefined;
    const base = (config.get<string>('DALI_LOGISTICS_BASE_URL') || 'https://dali-api.alcance.ng').replace(/\/+$/, '');
    this.apiBase = base.endsWith(PARTNER_PATH) ? base : `${base}${PARTNER_PATH}`;
    if (!this.apiKey) this.logger.warn('DALI_LOGISTICS_API_KEY is not set; rider delivery is disabled.');
    if (!this.webhookSecret) this.logger.warn('DALI_LOGISTICS_WEBHOOK_SECRET is not set; Dali webhooks will be rejected.');
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  get hasWebhookSecret(): boolean {
    return Boolean(this.webhookSecret);
  }

  /** Throws the user-facing 503 when Dali is not configured. */
  assertConfigured(): void {
    if (!this.apiKey) throw new ServiceUnavailableException('Rider delivery is not available right now.');
  }

  account(): Promise<DaliAccount> {
    return this.request<DaliAccount>('GET', '/me');
  }

  quote(pickup: DaliCoordinates, dropoff: DaliCoordinates): Promise<DaliQuote> {
    return this.request<DaliQuote>('POST', '/quotes', { pickup, dropoff });
  }

  createDelivery(input: {
    externalReference: string;
    pickup: DaliStop;
    dropoff: DaliStop;
    packageCount: number;
    notes?: string;
    metadata?: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<DaliDelivery> {
    return this.request<DaliDelivery>(
      'POST',
      '/deliveries',
      {
        external_reference: input.externalReference,
        pickup: input.pickup,
        dropoff: input.dropoff,
        package_count: input.packageCount,
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  cancelDelivery(id: string, reason?: string): Promise<DaliDelivery> {
    return this.request<DaliDelivery>('POST', `/deliveries/${encodeURIComponent(id)}/cancel`, reason ? { reason } : {});
  }

  /** Test keys only. Exposed to admins so staging can move a job forward. */
  simulate(id: string, status: string): Promise<DaliDelivery> {
    return this.request<DaliDelivery>('POST', `/deliveries/${encodeURIComponent(id)}/simulate`, { status });
  }

  testWebhook(): Promise<{ delivered?: boolean } | null> {
    return this.request<{ delivered?: boolean } | null>('POST', '/webhooks/test');
  }

  /**
   * Verifies `X-Dali-Signature: t=<unix>,v1=<hex>`, where v1 is the HMAC-SHA256 of
   * `${t}.` plus the exact raw request bytes, keyed with the whsec_ secret.
   */
  verifyWebhookSignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
    if (!this.webhookSecret || !rawBody || !header) return false;
    const parts = Object.fromEntries(
      header
        .split(',')
        .map((part) => part.split('='))
        .filter((pair): pair is [string, string] => pair.length === 2)
        .map(([key, value]) => [key.trim(), value.trim()]),
    );
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SEC) return false;
    const provided = parts.v1;
    if (!provided || !/^[a-f0-9]{64}$/i.test(provided)) return false;
    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided.toLowerCase(), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options: { idempotencyKey?: string } = {},
  ): Promise<T> {
    this.assertConfigured();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey.slice(0, 120);

    let response: Response;
    try {
      response = await fetch(`${this.apiBase}${path}`, {
        method,
        headers,
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(`Dali ${method} ${path} failed to connect`, err as Error);
      throw new DaliError('Could not reach Dali Logistics.');
    }

    let json: { success?: boolean; data?: T; code?: string; message?: string | string[] } | undefined;
    try {
      json = (await response.json()) as typeof json;
    } catch {
      json = undefined;
    }

    if (!response.ok || json?.success === false) {
      const raw = json?.message;
      const message = (Array.isArray(raw) ? raw[0] : raw) || `Dali Logistics responded with ${response.status}`;
      this.logger.warn(`Dali ${method} ${path} → ${response.status} ${json?.code ?? ''}: ${message}`);
      throw new DaliError(message, response.status, json?.code);
    }
    return json?.data as T;
  }
}
