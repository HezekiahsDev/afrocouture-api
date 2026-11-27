import {
  applySpread,
  coversWithin,
  fromStroops,
  nairaToUsdcStroops,
  shareOfStroops,
  toStroops,
  usdcStroopsToNaira,
} from './money.js';

describe('Stellar money', () => {
  it('converts decimal strings to stroops and back exactly', () => {
    expect(toStroops('12.5')).toBe(125_000_000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(toStroops('38.1520000')).toBe(381_520_000n);
    expect(fromStroops(125_000_000n)).toBe('12.5000000');
    expect(fromStroops(1n)).toBe('0.0000001');
    expect(fromStroops(toStroops('922337203685.4775807'))).toBe('922337203685.4775807');
  });

  it('rejects malformed amounts', () => {
    for (const bad of ['-1', '1.12345678', 'abc', '', '1e5', '.5']) expect(() => toStroops(bad)).toThrow();
  });

  it('rounds customer charges up and payouts down', () => {
    // 1000 / 3 = 333.3333333…
    expect(nairaToUsdcStroops(1000, '3', 'up')).toBe(3_333_333_334n);
    expect(nairaToUsdcStroops(1000, '3', 'down')).toBe(3_333_333_333n);
    expect(nairaToUsdcStroops(62_000, '1550', 'up')).toBe(toStroops('40'));
  });

  it('only accepts whole naira', () => {
    expect(() => nairaToUsdcStroops(10.5, '1500', 'up')).toThrow();
    expect(() => nairaToUsdcStroops(100, '0', 'up')).toThrow();
  });

  it('values USDC in whole naira, rounded down', () => {
    expect(usdcStroopsToNaira(toStroops('40'), '1550')).toBe(62_000);
    expect(usdcStroopsToNaira(toStroops('0.0006'), '1550')).toBe(0);
  });

  it('splits refunds proportionally without going over the total', () => {
    expect(shareOfStroops(toStroops('40'), 31_000, 62_000)).toBe(toStroops('20'));
    expect(shareOfStroops(toStroops('40'), 62_000, 62_000)).toBe(toStroops('40'));
    expect(shareOfStroops(toStroops('40'), 99_000, 62_000)).toBe(toStroops('40'));
    expect(shareOfStroops(10n, 1, 3)).toBe(3n);
    expect(shareOfStroops(10n, 0, 3)).toBe(0n);
  });

  it('applies the spread by lowering the rate', () => {
    expect(applySpread('1500', 150)).toBe('1477.5000000');
    expect(applySpread('1500', 0)).toBe('1500.0000000');
  });

  it('checks a payment covers the amount due within a tolerance', () => {
    expect(coversWithin(toStroops('99'), toStroops('100'), 100)).toBe(true);
    expect(coversWithin(toStroops('98.99'), toStroops('100'), 100)).toBe(false);
    expect(coversWithin(toStroops('100'), toStroops('100'), 0)).toBe(true);
  });
});
