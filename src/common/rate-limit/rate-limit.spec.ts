import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard, RateLimitRule, describeWait, identity } from './rate-limit.js';

/** Tiny in-memory stand-in for the ioredis MULTI(INCR, EXPIRE) the guard uses. */
function fakeRedis({ down = false } = {}) {
  const counts = new Map<string, number>();
  return {
    counts,
    multi() {
      let key = '';
      const chain = {
        incr(k: string) {
          key = k;
          return chain;
        },
        expire() {
          return chain;
        },
        async exec() {
          if (down) throw new Error('connect ECONNREFUSED');
          const next = (counts.get(key) ?? 0) + 1;
          counts.set(key, next);
          return [[null, next], [null, 1]];
        },
      };
      return chain;
    },
  };
}

function context(req: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) };
  return {
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

function guardWith(rules: RateLimitRule[], redis = fakeRedis()) {
  const reflector = { get: () => rules } as unknown as Reflector;
  return { guard: new RateLimitGuard(reflector, redis as any), redis };
}

describe('RateLimitGuard', () => {
  const login: RateLimitRule = { name: 'login', limit: 3, windowSec: 900, by: ['ip', 'email'] };

  it('allows requests up to the limit, then answers 429 with Retry-After', async () => {
    const { guard } = guardWith([login]);
    const req = { ip: '1.1.1.1', body: { email: 'A@Example.com ' } };
    for (let i = 0; i < 3; i++) await expect(guard.canActivate(context(req))).resolves.toBe(true);

    const headers: Record<string, string> = {};
    const err = await guard.canActivate(context(req, headers)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).getResponse()).toMatchObject({ message: expect.stringMatching(/^Too many attempts\. Try again in \d+ (minute|second)s?\.$/) });
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('counts each email separately and normalises case/whitespace', async () => {
    const { guard } = guardWith([login]);
    for (let i = 0; i < 3; i++) await guard.canActivate(context({ ip: '1.1.1.1', body: { email: 'a@example.com' } }));
    await expect(guard.canActivate(context({ ip: '1.1.1.1', body: { email: ' A@EXAMPLE.COM' } }))).rejects.toThrow();
    await expect(guard.canActivate(context({ ip: '1.1.1.1', body: { email: 'b@example.com' } }))).resolves.toBe(true);
  });

  it('keys user limits on the signed-in user, falling back to IP', () => {
    expect(identity({ ip: '9.9.9.9', user: { id: 'u1' } } as any, ['user'])).toBe('u:u1');
    expect(identity({ ip: '9.9.9.9' } as any, ['user'])).toBe('9.9.9.9');
  });

  it('fails open when Redis is unavailable', async () => {
    const { guard } = guardWith([login], fakeRedis({ down: true }));
    for (let i = 0; i < 10; i++) {
      await expect(guard.canActivate(context({ ip: '1.1.1.1', body: {} }))).resolves.toBe(true);
    }
  });

  it('enforces every rule on a route', async () => {
    const perIp: RateLimitRule = { name: 'login-ip', limit: 2, windowSec: 900, by: ['ip'] };
    const { guard } = guardWith([login, perIp]);
    await guard.canActivate(context({ ip: '2.2.2.2', body: { email: 'x@example.com' } }));
    await guard.canActivate(context({ ip: '2.2.2.2', body: { email: 'y@example.com' } }));
    await expect(guard.canActivate(context({ ip: '2.2.2.2', body: { email: 'z@example.com' } }))).rejects.toThrow();
  });
});

describe('describeWait', () => {
  it('uses seconds under a minute and rounds minutes up', () => {
    expect(describeWait(1)).toBe('1 second');
    expect(describeWait(45)).toBe('45 seconds');
    expect(describeWait(60)).toBe('1 minute');
    expect(describeWait(61)).toBe('2 minutes');
  });
});
