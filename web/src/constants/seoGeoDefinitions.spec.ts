import {
  describe, expect, it
} from 'vitest';
import {
  quadrantDefinition, SEO_GEO_DEFINITIONS, SEO_GEO_QUADRANTS
} from './seoGeoDefinitions';

describe('SEO vs GEO definitions', () => {
  it('lists the quadrants in the order of seo_geo.QUADRANTS', () => {
    expect(SEO_GEO_QUADRANTS.map((quadrant) => quadrant.id)).toStrictEqual(['both_strong', 'ai_gap', 'seo_gap', 'both_weak', 'no_data']);
  });

  it('defines the AI gap by the top-10 and 50% thresholds', () => {
    expect(quadrantDefinition('ai_gap')?.definition).toBe(
      'In Google\'s top 10 but named in fewer than 50% of AI answers: the AI engines do not reflect your search standing.',
    );
  });

  it('gives every definition a distinct label', () => {
    const labels = SEO_GEO_DEFINITIONS.map((definition) => definition.label);

    expect(new Set(labels).size).toBe(labels.length);
  });
});
