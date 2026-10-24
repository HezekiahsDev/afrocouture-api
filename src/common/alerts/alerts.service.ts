import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import type { Redis } from 'ioredis';
import { MailService } from '../../mail/mail.service.js';
import { REDIS } from '../redis/redis.module.js';

export interface Alert {
  /** One line, e.g. "500 on GET /orders/:id". */
  title: string;
  /** Extra context: error message, stack, ids. Keep secrets and personal data out. */
  details?: string;
  /** Identical signatures are sent at most once per throttle window. Defaults to the title. */
  signature?: string;
}

/**
 * Tells the team something went wrong in production: email to ALERT_EMAIL and/or a
 * POST to ALERT_WEBHOOK_URL (Slack- and Discord-compatible). Never throws and never
 * blocks the caller; with neither configured, alerts are only logged.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly emails: string[];
  private readonly webhookUrl: string | null;
  private readonly throttleSec: number;
  private readonly environment: string;

  constructor(
    config: ConfigService,
    private readonly mail: MailService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    this.emails = (config.get<string>('ALERT_EMAIL') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    this.webhookUrl = config.get<string>('ALERT_WEBHOOK_URL')?.trim() || null;
    const minutes = Number(config.get<string | number>('ALERT_THROTTLE_MINUTES', 15));
    this.throttleSec = Math.max(0, Number.isFinite(minutes) ? minutes : 15) * 60;
    this.environment = config.get<string>('NODE_ENV') ?? 'development';
  }

  get enabled(): boolean {
    return this.emails.length > 0 || this.webhookUrl !== null;
  }

  /** Fire-and-forget. */
  notify(alert: Alert): void {
    void this.send(alert);
  }

  /** Resolves once delivery has been attempted (used by tests and before the process exits). */
  async send(alert: Alert): Promise<'sent' | 'throttled' | 'logged'> {
    try {
      // Callers log the full error themselves; this line marks that an alert was raised.
      this.logger.warn(`Alert: ${alert.title}`);
      if (!this.enabled) return 'logged';
      if (!(await this.firstInWindow(alert.signature ?? alert.title))) return 'throttled';

      const subject = `[AfroCouture ${this.environment}] ${alert.title}`;
      const text = [
        alert.title,
        `Host: ${hostname()} · ${new Date().toISOString()}`,
        alert.details ? `\n${truncate(alert.details, 3000)}` : '',
      ]
        .join('\n')
        .trim();

      await Promise.allSettled([
        ...this.emails.map((to) => this.mail.sendMail({ to, subject, text })),
        this.webhookUrl ? this.postWebhook(this.webhookUrl, `*${subject}*\n${text}`) : Promise.resolve(),
      ]).then((results) => {
        for (const r of results) {
          if (r.status === 'rejected') this.logger.warn(`Alert delivery failed: ${(r.reason as Error)?.message ?? r.reason}`);
        }
      });
      return 'sent';
    } catch (err) {
      this.logger.warn(`Could not send alert "${alert.title}": ${(err as Error).message}`);
      return 'logged';
    }
  }

  /** True the first time a signature is seen in the window. Fails open when Redis is down. */
  private async firstInWindow(signature: string): Promise<boolean> {
    if (this.throttleSec === 0) return true;
    const key = `alert:${createHash('sha1').update(signature).digest('hex')}`;
    try {
      return (await this.redis.set(key, '1', 'EX', this.throttleSec, 'NX')) === 'OK';
    } catch {
      return true;
    }
  }

  private async postWebhook(url: string, text: string): Promise<void> {
    const body = truncate(text, 1900); // Discord caps content at 2000 characters.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Slack reads `text`, Discord reads `content`.
      body: JSON.stringify({ text: body, content: body }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
