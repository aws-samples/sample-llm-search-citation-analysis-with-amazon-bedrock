import {
  describe, expect, it
} from 'vitest';
import { isStats } from './statsDecoders';

const EXACT_STATS = {
  total_searches: 40,
  total_citations: 120,
  total_crawled: 90,
  unique_keywords: 10,
};

describe('isStats', () => {
  it('accepts the four totals without the approximation flag', () => {
    expect(isStats(EXACT_STATS)).toBe(true);
  });

  it('accepts totals flagged approximate', () => {
    expect(isStats({
      ...EXACT_STATS,
      counts_approximate: true,
    })).toBe(true);
  });

  it('rejects an approximation flag that is not a boolean', () => {
    expect(isStats({
      ...EXACT_STATS,
      counts_approximate: 'yes',
    })).toBe(false);
  });

  it('rejects a body missing a total', () => {
    expect(isStats({
      total_searches: 40,
      total_citations: 120,
      total_crawled: 90,
    })).toBe(false);
  });

  it('rejects an error body that carries the totals', () => {
    expect(isStats({
      ...EXACT_STATS,
      error: 'Brand config missing',
    })).toBe(false);
  });
});
