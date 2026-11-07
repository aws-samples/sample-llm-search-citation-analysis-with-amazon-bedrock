import {
  describe, expect, it
} from 'vitest';
import { buildSeoRecommendation } from '../../api/seoDomains-fixtures';
import { VISIBILITY_GAP_RECOMMENDATION } from './Recommendations-fixtures';
import {
  mergeRecommendations, seoRecommendationsForScope, withSeoPriorities
} from './recommendationSources';

const GEO_LOW = {
  ...VISIBILITY_GAP_RECOMMENDATION,
  priority: 'low',
  title: 'Low GEO item',
} as const;
const SEO_HIGH = buildSeoRecommendation({
  id: 'seo-high',
  priority: 'high',
  title: 'High SEO item',
});
const SEO_MEDIUM = buildSeoRecommendation({
  id: 'seo-medium',
  priority: 'medium',
  title: 'Medium SEO item',
  keywords: ['hotel deals'],
});

describe('mergeRecommendations', () => {
  it('orders both sources by priority when they are merged', () => {
    const merged = mergeRecommendations([GEO_LOW, VISIBILITY_GAP_RECOMMENDATION], [SEO_MEDIUM, SEO_HIGH]);

    expect(merged.map((item) => item.title)).toStrictEqual([
      'Improve visibility', 'High SEO item', 'Medium SEO item', 'Low GEO item',
    ]);
  });

  it('tags each item with the source it came from', () => {
    const merged = mergeRecommendations([VISIBILITY_GAP_RECOMMENDATION], [SEO_MEDIUM]);

    expect(merged.map((item) => item.source)).toStrictEqual(['geo', 'seo']);
  });

  it('returns only the answer-based items when there is no SEO recommendation', () => {
    expect(mergeRecommendations([GEO_LOW], []).map((item) => item.title)).toStrictEqual(['Low GEO item']);
  });
});

describe('seoRecommendationsForScope', () => {
  it('keeps only the recommendations naming the keyword when one keyword is selected', () => {
    const scoped = seoRecommendationsForScope([SEO_HIGH, SEO_MEDIUM], {
      kind: 'keyword',
      keyword: 'hotel deals',
    });

    expect(scoped.map((item) => item.id)).toStrictEqual(['seo-medium']);
  });

  it('keeps every recommendation when every keyword is selected', () => {
    const scoped = seoRecommendationsForScope([SEO_HIGH, SEO_MEDIUM], { kind: 'all' });

    expect(scoped.map((item) => item.id)).toStrictEqual(['seo-high', 'seo-medium']);
  });
});

describe('withSeoPriorities', () => {
  it('adds one per SEO recommendation to the count of its priority', () => {
    const counts = withSeoPriorities({
      high: 1,
      medium: 0,
      low: 2,
    }, [SEO_HIGH, SEO_MEDIUM, SEO_MEDIUM]);

    expect(counts).toStrictEqual({
      high: 2,
      medium: 2,
      low: 2,
    });
  });
});
