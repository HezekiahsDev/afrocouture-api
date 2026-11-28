// Copied from stellar-payment-service (src/webhooks/signature.ts). Keep the two in sync.
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signing. Header: `x-stellar-signature: t=<unix seconds>,v1=<hex>` where
 * v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Clients should reject a timestamp older
 * than a few minutes to stop replays. `verifySignature` is the reference implementation.
 */
export function sign(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

export function verifySignature(
  secret: string,
  rawBody: string,
  header: string | undefined,
  { toleranceSec = 300, now = Date.now() }: { toleranceSec?: number; now?: number } = {},
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
