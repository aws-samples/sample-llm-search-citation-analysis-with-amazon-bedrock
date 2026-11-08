import {
  describe, expect, it
} from 'vitest';
import {
  clampRows, exportPlan, priceText
} from './paidExport';
import { LABS_EXPORT } from '../api/seoDomains-fixtures';
import { BACKLINKS_EXPORT } from '../api/seoBacklinks-fixtures';

describe('exportPlan', () => {
  it('asks the remainder in the last chunk', () => {
    expect(exportPlan(2500, LABS_EXPORT).chunks).toStrictEqual([
      {
        offset: 0,
        limit: 1000,
      },
      {
        offset: 1000,
        limit: 1000,
      },
      {
        offset: 2000,
        limit: 500,
      },
    ]);
  });

  it('counts one request per started thousand rows', () => {
    expect([exportPlan(1000, LABS_EXPORT).requests, exportPlan(1001, LABS_EXPORT).requests]).toStrictEqual([1, 2]);
  });

  it('prices the requests plus the rows of a Labs export', () => {
    expect(exportPlan(2500, LABS_EXPORT).priceUsd).toBeCloseTo(0.336, 10);
  });

  it('prices the requests plus the rows of a backlinks export', () => {
    expect(exportPlan(1000, BACKLINKS_EXPORT).priceUsd).toBeCloseTo(0.06, 10);
  });
});

describe('priceText', () => {
  it.each([
    [0.132, 'up to $0.14'],
    [0.06, 'up to $0.06'],
    [0.024 + 0.036, 'up to $0.06'],
    [0.336, 'up to $0.34'],
    [0.0004, 'up to $0.01'],
    [0, 'up to $0.00'],
  ])('words %s USD as "%s"', (usd, text) => {
    expect(priceText(usd)).toBe(text);
  });

  it('prices 1000 Labs rows at "up to $0.14"', () => {
    expect(priceText(exportPlan(1000, LABS_EXPORT).priceUsd)).toBe('up to $0.14');
  });

  it('prices 2500 backlinks rows at "up to $0.17"', () => {
    expect(priceText(exportPlan(2500, BACKLINKS_EXPORT).priceUsd)).toBe('up to $0.17');
  });
});

describe('clampRows', () => {
  it.each([
    [500, 500],
    [12_000, 10_000],
    [10_000, 10_000],
    [2.7, 2],
    [1, 1],
  ])('reads %s as %s rows under a 10,000 cap', (input, rows) => {
    expect(clampRows(input, 10_000)).toBe(rows);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (input) => {
    expect(clampRows(input, 10_000)).toBeNull();
  });
});
