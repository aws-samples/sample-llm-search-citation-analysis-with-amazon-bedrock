import {
  describe, expect, it
} from 'vitest';
import { keywordResearchUsd } from './seoPrices';

// docs/seo.md › Prices: $0.012 + $0.00012 per row per Labs call, two calls of half the limit in auto mode.
describe('keywordResearchUsd', () => {
  it('prices auto mode as two Labs calls of half the limit', () => {
    expect(keywordResearchUsd({
      mode: 'auto',
      limit: 150,
      clickstream: false,
    })).toBeCloseTo(0.042, 6);
  });

  it('rounds an odd half limit up to a whole row', () => {
    expect(keywordResearchUsd({
      mode: 'auto',
      limit: 301,
      clickstream: false,
    })).toBeCloseTo(2 * (0.012 + 151 * 0.00012), 6);
  });

  it('prices a single mode as one Labs call of the whole limit', () => {
    expect(keywordResearchUsd({
      mode: 'related',
      limit: 500,
      clickstream: false,
    })).toBeCloseTo(0.072, 6);
  });

  it('doubles the price with clickstream data', () => {
    expect(keywordResearchUsd({
      mode: 'suggestions',
      limit: 300,
      clickstream: true,
    })).toBeCloseTo(0.096, 6);
  });
});
