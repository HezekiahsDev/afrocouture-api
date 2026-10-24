import { unitPriceFor } from './pricing.js';

describe('unitPriceFor', () => {
  const fabric = {
    price: 10000,
    priceTiers: [
      { minQuantity: 5, price: 9000 },
      { minQuantity: 20, price: 8000 },
    ],
  };

  it('uses the base price below the first tier', () => {
    expect(unitPriceFor(fabric, 4)).toBe(10000);
  });

  it('uses the highest tier reached', () => {
    expect(unitPriceFor(fabric, 5)).toBe(9000);
    expect(unitPriceFor(fabric, 19)).toBe(9000);
    expect(unitPriceFor(fabric, 20)).toBe(8000);
    expect(unitPriceFor(fabric, 200)).toBe(8000);
  });

  it('handles fabrics without tiers', () => {
    expect(unitPriceFor({ price: 7500, priceTiers: [] }, 50)).toBe(7500);
    expect(unitPriceFor({ price: 7500 }, 50)).toBe(7500);
  });
});
