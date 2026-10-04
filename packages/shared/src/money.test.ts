import { describe, expect, it } from 'vitest';

import {
  addMoney,
  formatMoney,
  fromMinorUnits,
  multiplyMoney,
  normalizeMoney,
  subtractMoney,
  toMinorUnits,
  unitProfit,
} from './money.js';

describe('normalizeMoney', () => {
  it('canonicalises to two decimal places', () => {
    expect(normalizeMoney(699)).toBe('699.00');
    expect(normalizeMoney('699')).toBe('699.00');
    expect(normalizeMoney('699.5')).toBe('699.50');
    expect(normalizeMoney('699.05')).toBe('699.05');
    expect(normalizeMoney('  12.34  ')).toBe('12.34');
  });

  it('rejects values that would silently lose precision', () => {
    expect(() => normalizeMoney('1.005')).toThrow(RangeError);
    expect(() => normalizeMoney('-5')).toThrow(RangeError);
    expect(() => normalizeMoney('abc')).toThrow(RangeError);
  });
});

describe('minor unit conversion', () => {
  it('round-trips without loss', () => {
    expect(toMinorUnits('1234.56')).toBe(123_456);
    expect(fromMinorUnits(123_456)).toBe('1234.56');
  });

  it('handles negatives', () => {
    expect(fromMinorUnits(-5)).toBe('-0.05');
    expect(fromMinorUnits(-123_456)).toBe('-1234.56');
  });
});

describe('money arithmetic', () => {
  it('survives repeated addition where float accumulation drifts', () => {
    let floatTotal = 0;
    let exactTotal = '0.00';

    for (let i = 0; i < 10; i += 1) {
      floatTotal += 0.1;
      exactTotal = addMoney(exactTotal, '0.10');
    }

    expect(floatTotal).not.toBe(1);
    expect(exactTotal).toBe('1.00');
  });

  it('subtracts and multiplies exactly', () => {
    expect(subtractMoney('749.00', '400.00')).toBe('349.00');
    expect(multiplyMoney('349.00', 3)).toBe('1047.00');
  });

  it('reports negative profit when selling below cost', () => {
    expect(unitProfit('699.00', '749.00')).toBe('-50.00');
  });

  it('is exact at the price scale used by the shop', () => {
    expect(multiplyMoney('0.07', 3)).toBe('0.21');
    expect(addMoney('19.99', '0.01')).toBe('20.00');
  });
});

describe('formatMoney', () => {
  it('formats to a rupee amount', () => {
    expect(formatMoney('749')).toMatch(/749/);
    expect(formatMoney('749')).toMatch(/₹/);
  });
});
