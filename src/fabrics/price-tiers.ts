import type { PriceTier } from './entities/fabric.entity.js';

export const MAX_PRICE_TIERS = 5;

/**
 * Sorts tiers by quantity and checks they make sense against the base price.
 * Returns the sorted tiers, or a message explaining what to fix.
 */
export function checkPriceTiers(
  tiers: PriceTier[],
  basePrice: number,
): { ok: true; tiers: PriceTier[] } | { ok: false; message: string } {
  if (tiers.length > MAX_PRICE_TIERS) {
    return { ok: false, message: `Add at most ${MAX_PRICE_TIERS} price breaks.` };
  }
  const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
  for (let i = 0; i < sorted.length; i++) {
    const tier = sorted[i];
    const prev = sorted[i - 1];
    if (tier.price >= basePrice) {
      return {
        ok: false,
        message: `The price for ${tier.minQuantity}+ must be lower than the base price of ₦${basePrice.toLocaleString('en-NG')}.`,
      };
    }
    if (prev && tier.minQuantity === prev.minQuantity) {
      return { ok: false, message: `There are two price breaks for ${tier.minQuantity}+. Keep one.` };
    }
    if (prev && tier.price >= prev.price) {
      return {
        ok: false,
        message: `Larger quantities should cost less: ${tier.minQuantity}+ must be cheaper than ${prev.minQuantity}+.`,
      };
    }
  }
  return { ok: true, tiers: sorted };
}
