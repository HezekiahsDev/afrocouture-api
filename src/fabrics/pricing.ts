import type { PriceTier } from './entities/fabric.entity.js';

/**
 * Naira per unit for a quantity: the tier with the largest `minQuantity` that the
 * quantity reaches, otherwise the base price. Tiers are assumed validated
 * (ascending quantities, descending prices, all below the base price).
 */
export function unitPriceFor(fabric: { price: number; priceTiers?: PriceTier[] | null }, quantity: number): number {
  let unit = fabric.price;
  for (const tier of fabric.priceTiers ?? []) {
    if (quantity >= tier.minQuantity && tier.price < unit) unit = tier.price;
  }
  return unit;
}
