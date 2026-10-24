import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter.js';
import type { User } from '../../src/users/entities/user.entity.js';
import type { Redis } from 'ioredis';
import { REDIS } from '../../src/common/redis/redis.module.js';

/**
 * The e2e suites truncate every table, so they refuse to run unless DB_NAME looks like a
 * throwaway database (contains "test", "e2e" or "_b<digit>") or E2E_ALLOW_TRUNCATE=1.
 */
export function assertDisposableDatabase() {
  const name = process.env.DB_NAME ?? '';
  if (process.env.E2E_ALLOW_TRUNCATE === '1' || /test|e2e|_b\d/i.test(name)) return;
  throw new Error(
    `Refusing to run e2e tests against database "${name || '(unset)'}". ` +
      'Point DB_NAME at a disposable database (e.g. afrocouture_test) — see README "Testing".',
  );
}

/**
 * Boots the whole API in-process with the same global pipe and filter as main.ts.
 * `override` can swap providers (e.g. a fake Paystack) before compiling.
 */
export async function createTestApp(
  options: { override?: (builder: TestingModuleBuilder) => TestingModuleBuilder } = {},
): Promise<INestApplication> {
  assertDisposableDatabase();
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (options.override ? options.override(builder) : builder).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}

/**
 * Empties every table except the migrations ledger, and clears rate-limit counters (rl:*)
 * so repeated runs from 127.0.0.1 don't trip the sign-in / sign-up limits.
 */
export async function resetDatabase(app: INestApplication) {
  await clearRateLimits(app.get<Redis>(REDIS));
  const ds = app.get(DataSource);
  const tables: { tablename: string }[] = await ds.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (tables.length) {
    await ds.query(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
}

/** An access token for a user, signed exactly like a real sign-in. */
export function tokenFor(app: INestApplication, user: Pick<User, 'id' | 'email' | 'role'>) {
  return app.get(JwtService).sign({ sub: user.id, email: user.email, role: user.role });
}

async function clearRateLimits(redis: Redis) {
  try {
    if (redis.status !== 'ready') {
      await Promise.race([new Promise((resolve) => redis.once('ready', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } catch {
    // Redis is optional (rate limits fail open); tests that need it will say so.
  }
}
