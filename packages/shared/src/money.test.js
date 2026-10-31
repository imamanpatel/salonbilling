import { describe, expect, it } from 'vitest';
import { formatINR, paiseToRupees, percentOf, rupeesToPaise } from './money.js';

describe('rupeesToPaise', () => {
  it.each([
    ['499', 49900],
    ['499.5', 49950],
    ['499.05', 49905],
    ['1,234.50', 123450],
    [' 10 ', 1000],
    [0.1 + 0.2, 30],
    [1234.5, 123450],
    ['-12.30', -1230],
    ['0', 0],
  ])('%j -> %i', (input, expected) => {
    expect(rupeesToPaise(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '1.234', '12.', '.5', null, undefined])('rejects %j', (input) => {
    expect(rupeesToPaise(input)).toBeNull();
  });
});

describe('paiseToRupees', () => {
  it('round-trips with rupeesToPaise', () => {
    for (const paise of [0, 5, 99, 100, 49950, 123456789, -1230]) {
      expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise);
    }
  });

  it('returns an empty string for missing values', () => {
    expect(paiseToRupees(null)).toBe('');
  });
});

describe('formatINR', () => {
  it('uses Indian digit grouping', () => {
    expect(formatINR(12345678)).toBe('₹1,23,456.78');
  });
});

describe('percentOf', () => {
  it('computes GST without float drift', () => {
    expect(percentOf(10000, 18)).toBe(1800);
    expect(percentOf(333, 18)).toBe(60); // 59.94 -> 60
    expect(percentOf(1999, '2.5')).toBe(50); // 49.975 -> 50
  });

  it('rounds half away from zero', () => {
    expect(percentOf(25, 2)).toBe(1); // 0.5 -> 1
    expect(percentOf(-25, 2)).toBe(-1);
  });
});
