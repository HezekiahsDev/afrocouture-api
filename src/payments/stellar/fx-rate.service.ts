import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const CACHE_MS = 60_000;
const TIMEOUT_MS = 10_000;

/**
 * Naira per USDC. Two sources, picked with FX_RATE_PROVIDER:
 * - `fixed`: FX_NGN_PER_USDC (development, testnet, or a rate ops set by hand)
 * - `url`: GET FX_RATE_URL and read the number at FX_RATE_JSON_PATH (e.g. "rates.NGN")
 *
 * Every rate must fall inside FX_RATE_MIN..FX_RATE_MAX, so a broken feed can't
 * quote a nonsense price. When no valid rate is available, checkout and Stellar
 * payouts fail closed with a 503 rather than use a stale rate.
 */
@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);
  private readonly provider: 'fixed' | 'url' | null;
  private readonly fixed: number | null;
  private readonly url: string | null;
  private readonly path: string[];
  private readonly min: number;
  private readonly max: number;
  private cache?: { at: number; rate: string };

  constructor(config: ConfigService) {
    const provider = config.get<string>('FX_RATE_PROVIDER');
    this.provider = provider === 'fixed' || provider === 'url' ? provider : null;
    this.fixed = Number(config.get('FX_NGN_PER_USDC')) || null;
    this.url = config.get<string>('FX_RATE_URL') || null;
    this.path = (config.get<string>('FX_RATE_JSON_PATH') || '').split('.').filter(Boolean);
    this.min = Number(config.get('FX_RATE_MIN')) || 100;
    this.max = Number(config.get('FX_RATE_MAX')) || 10_000;
  }

  get isConfigured(): boolean {
    if (this.provider === 'fixed') return this.fixed !== null;
    if (this.provider === 'url') return Boolean(this.url && this.path.length);
    return false;
  }

  /** Mid-market naira per USDC as a decimal string (7 places max). */
  async ngnPerUsdc(): Promise<string> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rate;
    const value = await this.fetch();
    if (!Number.isFinite(value) || value < this.min || value > this.max) {
      this.logger.error(`FX rate ${value} is outside FX_RATE_MIN..FX_RATE_MAX (${this.min}..${this.max}); refusing to use it.`);
      throw this.unavailable();
    }
    const rate = value.toFixed(7);
    this.cache = { at: Date.now(), rate };
    return rate;
  }

  private async fetch(): Promise<number> {
    if (this.provider === 'fixed' && this.fixed !== null) return this.fixed;
    if (this.provider === 'url' && this.url && this.path.length) {
      try {
        const res = await fetch(this.url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let node: unknown = await res.json();
        for (const key of this.path) node = (node as Record<string, unknown> | null)?.[key];
        return Number(node);
      } catch (err) {
        this.logger.error(`Could not fetch the FX rate: ${(err as Error).message}`);
        throw this.unavailable();
      }
    }
    throw this.unavailable();
  }

  private unavailable() {
    return new ServiceUnavailableException('Exchange rates are unavailable right now. Please try again shortly.');
  }
}
