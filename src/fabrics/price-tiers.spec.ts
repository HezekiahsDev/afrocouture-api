import { checkPriceTiers } from './price-tiers.js';

describe('checkPriceTiers', () => {
  it('accepts valid tiers and sorts them by quantity', () => {
    const result = checkPriceTiers(
      [
        { minQuantity: 12, price: 7500 },
        { minQuantity: 6, price: 8000 },
      ],
      8500,
    );
    expect(result).toEqual({
      ok: true,
      tiers: [
        { minQuantity: 6, price: 8000 },
        { minQuantity: 12, price: 7500 },
      ],
    });
  });

  it('accepts no tiers', () => {
    expect(checkPriceTiers([], 8500)).toEqual({ ok: true, tiers: [] });
  });

  it('rejects a tier that is not cheaper than the base price', () => {
    const result = checkPriceTiers([{ minQuantity: 5, price: 8500 }], 8500);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('lower than the base price') });
  });

  it('rejects larger quantities that do not get cheaper', () => {
    const result = checkPriceTiers(
      [
        { minQuantity: 5, price: 8000 },
        { minQuantity: 10, price: 8000 },
      ],
      8500,
    );
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('should cost less') });
  });

  it('rejects duplicate quantities', () => {
    const result = checkPriceTiers(
      [
        { minQuantity: 5, price: 8000 },
        { minQuantity: 5, price: 7000 },
      ],
      8500,
    );
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('two price breaks for 5+') });
  });

  it('rejects more than five tiers', () => {
    const tiers = [2, 3, 4, 5, 6, 7].map((q, i) => ({ minQuantity: q, price: 8000 - i * 100 }));
    expect(checkPriceTiers(tiers, 8500)).toMatchObject({ ok: false, message: 'Add at most 5 price breaks.' });
  });
});
