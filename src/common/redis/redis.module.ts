import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

const logger = new Logger('Redis');
let lastErrorLog = 0;

/**
 * Shared ioredis client. Connects lazily and keeps retrying in the background;
 * callers must treat Redis as optional (caches, rate limits) and cope with errors.
 */
function createRedis(config: ConfigService): Redis {
  const client = new Redis({
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: Number(config.get<string | number>('REDIS_PORT', 6379)),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    db: Number(config.get<string | number>('REDIS_DB', 0)) || 0,
    lazyConnect: true,
    // Fail commands fast instead of queueing them while disconnected.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
  });
  client.on('error', (err: Error) => {
    // Log at most once a minute so a down Redis doesn't flood the logs.
    if (Date.now() - lastErrorLog > 60_000) {
      lastErrorLog = Date.now();
      logger.warn(`Redis unavailable: ${err.message}`);
    }
  });
  client.connect().catch(() => undefined);
  return client;
}

@Global()
@Module({
  providers: [{ provide: REDIS, inject: [ConfigService], useFactory: createRedis }],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
