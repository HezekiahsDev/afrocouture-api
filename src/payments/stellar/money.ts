/**
 * Exact money math for Stellar amounts. Stellar has 7 decimal places; we keep every
 * amount as bigint stroops (1 unit = 10^7 stroops) and only format to a decimal
 * string at the edges. Never use JS floats for these values.
 */

export const STROOPS_PER_UNIT = 10_000_000n;
const DECIMALS = 7;

/** "12.5" → 125000000n. Rejects negatives, more than 7 decimals and anything that isn't a plain decimal. */
export function toStroops(amount: string): bigint {
  const value = amount.trim();
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value);
  if (!match) throw new Error(`Not a valid Stellar amount: "${amount}"`);
  const [, whole, fraction = ''] = match;
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(fraction.padEnd(DECIMALS, '0'));
}

/** 125000000n → "12.5000000" (the form Horizon uses). */
export function fromStroops(stroops: bigint): string {
  if (stroops < 0n) throw new Error('Negative Stellar amount');
  const whole = stroops / STROOPS_PER_UNIT;
  const fraction = (stroops % STROOPS_PER_UNIT).toString().padStart(DECIMALS, '0');
  return `${whole}.${fraction}`;
}

const divide = (numerator: bigint, denominator: bigint, round: 'up' | 'down') =>
  round === 'up' ? (numerator + denominator - 1n) / denominator : numerator / denominator;

/**
 * USDC (in stroops) worth `naira` at `ngnPerUsdc` (a decimal string, e.g. "1550.25").
 * Round up when charging a customer, down when paying out.
 */
export function nairaToUsdcStroops(naira: number, ngnPerUsdc: string, round: 'up' | 'down'): bigint {
  if (!Number.isInteger(naira) || naira < 0) throw new Error('Naira amounts are whole, non-negative numbers');
  const rate = toStroops(ngnPerUsdc);
  if (rate <= 0n) throw new Error('Exchange rate must be positive');
  // naira / rate, with both scaled by 10^7 so the result is in stroops.
  return divide(BigInt(naira) * STROOPS_PER_UNIT * STROOPS_PER_UNIT, rate, round);
}

/** Whole naira that `usdcStroops` is worth at `ngnPerUsdc`, rounded down. */
export function usdcStroopsToNaira(usdcStroops: bigint, ngnPerUsdc: string): number {
  const rate = toStroops(ngnPerUsdc);
  return Number((usdcStroops * rate) / STROOPS_PER_UNIT / STROOPS_PER_UNIT);
}

/** The `part / whole` share of `total` stroops, rounded down (used for partial refunds). */
export function shareOfStroops(total: bigint, part: number, whole: number): bigint {
  if (whole <= 0 || part <= 0) return 0n;
  if (part >= whole) return total;
  return (total * BigInt(part)) / BigInt(whole);
}

/**
 * Lowers a NGN-per-USDC rate by `bps` basis points, so the customer pays slightly more
 * USDC. The spread covers FX movement between payment and payout.
 */
export function applySpread(ngnPerUsdc: string, bps: number): string {
  const rate = toStroops(ngnPerUsdc);
  const safeBps = BigInt(Math.max(0, Math.min(5_000, Math.round(bps))));
  return fromStroops((rate * (10_000n - safeBps)) / 10_000n);
}

/** `a` is within `bps` basis points below `b` (or above it). */
export function coversWithin(paid: bigint, due: bigint, bps: number): boolean {
  return paid * 10_000n >= due * (10_000n - BigInt(Math.max(0, Math.round(bps))));
}
