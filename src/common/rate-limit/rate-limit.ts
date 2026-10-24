import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

export interface RateLimitRule {
  /** Short name for the limited action, used in the Redis key. */
  name: string;
  limit: number;
  windowSec: number;
  /** What identifies the caller. 'user' falls back to the IP for anonymous requests. */
  by: ('ip' | 'email' | 'user')[];
}

const RATE_LIMIT_KEY = 'rate-limit:rules';

/**
 * Limits how often a route can be called (fixed window, counted in Redis).
 * Applied at method level so it runs after a controller-level JwtAuthGuard and
 * can key on the signed-in user. Pass several rules to enforce them all.
 */
export const RateLimit = (...rules: RateLimitRule[]) =>
  applyDecorators(SetMetadata(RATE_LIMIT_KEY, rules), UseGuards(RateLimitGuard));

export function describeWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export function identity(req: Request, by: RateLimitRule['by']): string {
  return by
    .map((part) => {
      if (part === 'ip') return req.ip ?? 'unknown-ip';
      if (part === 'email') {
        const email = (req.body as { email?: unknown } | undefined)?.email;
        return typeof email === 'string' && email.trim() ? email.toLowerCase().trim() : 'no-email';
      }
      const user = (req as Request & { user?: { id?: string } }).user;
      return user?.id ? `u:${user.id}` : (req.ip ?? 'unknown-ip');
    })
    .join('|');
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private lastFailOpenLog = 0;

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.get<RateLimitRule[] | undefined>(RATE_LIMIT_KEY, context.getHandler());
    if (!rules?.length) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const now = Math.floor(Date.now() / 1000);

    for (const rule of rules) {
      const bucket = Math.floor(now / rule.windowSec);
      const key = `rl:${rule.name}:${identity(req, rule.by)}:${bucket}`;

      let count: number;
      try {
        const result = await this.redis.multi().incr(key).expire(key, rule.windowSec, 'NX').exec();
        count = Number(result?.[0]?.[1] ?? 0);
      } catch (err) {
        // Redis is down: availability beats rate limiting — let the request through.
        if (Date.now() - this.lastFailOpenLog > 60_000) {
          this.lastFailOpenLog = Date.now();
          this.logger.warn(`Rate limiting skipped (Redis unavailable): ${(err as Error).message}`);
        }
        return true;
      }

      if (count > rule.limit) {
        const retryAfter = Math.max(1, (bucket + 1) * rule.windowSec - now);
        res.setHeader('Retry-After', String(retryAfter));
        throw new HttpException(
          { message: `Too many attempts. Try again in ${describeWait(retryAfter)}.`, code: 'RATE_LIMITED', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}
