import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { readFileSync } from 'node:fs';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import { REDIS } from './common/redis/redis.module.js';

type Check = 'up' | 'down';

export interface Health {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSec: number;
  db: Check;
  redis: Check;
  timestamp: string;
}

/** Read once at startup: src/ and dist/ both sit one level below package.json. */
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

/** Resolves to false if the check fails or takes longer than `ms`. */
async function within(ms: number, check: () => Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      check().then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class AppService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  /** For uptime monitors: "degraded" (served as 503) when Postgres or Redis is unreachable. */
  async getHealth(): Promise<Health> {
    const [db, redis] = await Promise.all([
      within(2000, () => this.dataSource.query('SELECT 1')),
      within(1000, () => this.redis.ping()),
    ]);
    return {
      status: db && redis ? 'ok' : 'degraded',
      service: 'afrocouture-api',
      version: VERSION,
      uptimeSec: Math.round(process.uptime()),
      db: db ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }
}
