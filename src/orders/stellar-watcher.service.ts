import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS } from '../common/redis/redis.module.js';
import { AlertsService } from '../common/alerts/alerts.service.js';
import { StellarService } from '../payments/stellar/stellar.service.js';
import { StellarCursor } from '../payments/stellar/entities/stellar-cursor.entity.js';
import { EscrowService } from '../escrow/escrow.service.js';
import { StellarCheckoutService } from './stellar-checkout.service.js';

const CURSOR_KEY = 'operating-payments';
const LEADER_KEY = 'stellar:watcher';
const LEADER_TTL_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_TICK = 5;
const TREASURY_CHECK_MS = 10 * 60 * 1000;
const STALL_ALERT_MS = 5 * 60 * 1000;

/**
 * Polls Horizon for payments into the operating account and settles them, then runs the
 * Stellar reconcilers. Polling (not streaming) keeps it simple and restart-safe: the cursor
 * is saved in Postgres only after a payment is handled, and handling is idempotent.
 * One API instance leads at a time (Redis lock); without Redis every instance polls, which
 * is still safe, just redundant.
 */
@Injectable()
export class StellarWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StellarWatcherService.name);
  private readonly instanceId = randomUUID();
  private readonly intervalMs: number;
  private running = false;
  private lastTreasuryCheck = 0;
  private lastSuccess = Date.now();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stellar: StellarService,
    private readonly checkout: StellarCheckoutService,
    private readonly escrow: EscrowService,
    private readonly scheduler: SchedulerRegistry,
    config: ConfigService,
    @Optional() @Inject(REDIS) private readonly redis?: Redis,
    @Optional() private readonly alerts?: AlertsService,
  ) {
    this.intervalMs = Math.max(2_000, Number(config.get('STELLAR_POLL_MS') ?? 5_000) || 5_000);
  }

  onModuleInit() {
    if (!this.stellar.isConfigured || process.env.NODE_ENV === 'test') return;
    const timer = setInterval(() => void this.tick(), this.intervalMs);
    timer.unref?.();
    this.scheduler.addInterval('stellar-watcher', timer);
    this.logger.log(`Watching ${this.stellar.network} payments to ${this.stellar.operatingAddress} every ${this.intervalMs} ms`);
  }

  async onModuleDestroy() {
    try {
      await this.redis?.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        LEADER_KEY,
        this.instanceId,
      );
    } catch {
      // expires on its own
    }
  }

  /** One pass: new payments, expiries, reconcilers, and (every 10 min) treasury alerts. */
  async tick(): Promise<void> {
    if (this.running || !(await this.isLeader())) return;
    this.running = true;
    try {
      await this.pollPayments();
      await this.checkout.expireIntents();
      await this.escrow.reconcileStellar();
      await this.checkout.reconcileUnmatchedRefunds();
      if (Date.now() - this.lastTreasuryCheck > TREASURY_CHECK_MS) {
        this.lastTreasuryCheck = Date.now();
        await this.checkTreasury();
      }
      this.lastSuccess = Date.now();
    } catch (err) {
      this.logger.warn(`Stellar watcher tick failed: ${(err as Error).message}`);
      if (Date.now() - this.lastSuccess > STALL_ALERT_MS) {
        this.alerts?.notify({
          title: 'Stellar payment watcher is stuck',
          details: `No successful pass for over 5 minutes. Last error: ${(err as Error).message}\nCustomer USDC payments are not being confirmed until this is fixed.`,
          signature: 'stellar-watcher-stuck',
        });
      }
    } finally {
      this.running = false;
    }
  }

  /** Reads payments after the saved cursor and handles them in order. Stops at the first failure so nothing is skipped. */
  async pollPayments(): Promise<number> {
    const cursors = this.dataSource.getRepository(StellarCursor);
    let cursor = (await cursors.findOne({ where: { key: CURSOR_KEY } }))?.pagingToken ?? null;
    let handled = 0;
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const { payments, lastToken, count } = await this.stellar.incomingPayments(cursor, PAGE_SIZE);
      for (const payment of payments) {
        await this.checkout.handleIncoming(payment);
        cursor = payment.pagingToken;
        await cursors.save({ key: CURSOR_KEY, pagingToken: cursor });
        handled++;
      }
      // Skip past non-payment records (account creation, merges) too.
      if (lastToken && lastToken !== cursor) {
        cursor = lastToken;
        await cursors.save({ key: CURSOR_KEY, pagingToken: cursor });
      }
      if (count < PAGE_SIZE) break;
    }
    return handled;
  }

  private async checkTreasury() {
    const t = await this.checkout.treasury();
    if (!t.configured || !t.warnings.length) return;
    this.alerts?.notify({
      title: `Stellar treasury needs attention (${t.network})`,
      details: t.warnings.join('\n'),
      signature: `stellar-treasury:${t.warnings.join('|')}`,
    });
  }

  private async isLeader(): Promise<boolean> {
    if (!this.redis) return true;
    try {
      const current = await this.redis.get(LEADER_KEY);
      if (current === this.instanceId) {
        await this.redis.pexpire(LEADER_KEY, LEADER_TTL_MS);
        return true;
      }
      return (await this.redis.set(LEADER_KEY, this.instanceId, 'PX', LEADER_TTL_MS, 'NX')) === 'OK';
    } catch {
      return true; // Redis down: poll anyway (idempotent)
    }
  }
}
