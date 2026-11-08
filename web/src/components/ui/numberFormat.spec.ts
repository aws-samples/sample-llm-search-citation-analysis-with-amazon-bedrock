import {
  describe, expect, it
} from 'vitest';
import {
  UNKNOWN_VALUE, compactText, compactUsdText, decimalText, integerText, usdText
} from './numberFormat';

describe('integerText', () => {
  it('groups thousands and drops decimals', () => {
    expect(integerText(1234567.4)).toBe('1,234,567');
  });

  it('shows a dash, not zero, for an unknown value', () => {
    expect([integerText(null), integerText(undefined), integerText(Number.NaN)]).toStrictEqual([UNKNOWN_VALUE, UNKNOWN_VALUE, UNKNOWN_VALUE]);
  });

  it('keeps zero as zero', () => {
    expect(integerText(0)).toBe('0');
  });
});

describe('compactText', () => {
  it('keeps every digit below 10,000', () => {
    expect(compactText(9876)).toBe('9,876');
  });

  it('abbreviates from 10,000', () => {
    expect([compactText(10_000), compactText(1_234_567), compactText(2_500_000_000)]).toStrictEqual(['10K', '1.2M', '2.5B']);
  });

  it('abbreviates large negative values', () => {
    expect(compactText(-45_600)).toBe('-45.6K');
  });

  it('shows a dash for Infinity', () => {
    expect(compactText(Number.POSITIVE_INFINITY)).toBe(UNKNOWN_VALUE);
  });
});

describe('usd formats', () => {
  it('writes dollars with cents and separators', () => {
    expect(usdText(12034.57)).toBe('$12,034.57');
  });

  it('abbreviates amounts from $10,000', () => {
    expect(compactUsdText(12_345_678)).toBe('$12.3M');
  });

  it('keeps small amounts exact', () => {
    expect(compactUsdText(1.25)).toBe('$1.25');
  });
});

describe('decimalText', () => {
  it('groups thousands with a fixed number of decimals', () => {
    expect(decimalText(12345.678)).toBe('12,345.7');
  });

  it('pads to the requested decimals', () => {
    expect(decimalText(0.42, 3)).toBe('0.420');
  });
});
