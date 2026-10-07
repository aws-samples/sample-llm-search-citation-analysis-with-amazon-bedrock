import {
  describe, expect, it
} from 'vitest';
import {
  decodeInsightsNarrative, isInsightsNarrative
} from './insightsNarrativeDecoders';
import {
  buildNarrative, buildNarrativeInsight, buildNarrativeRecommendation
} from './insightsNarrative-fixtures';

describe('isInsightsNarrative', () => {
  it('accepts the stored narrative of a run', () => {
    expect(isInsightsNarrative(buildNarrative())).toBe(true);
  });

  it('accepts a narrative whose model and generation time are unknown', () => {
    expect(isInsightsNarrative(buildNarrative({
      model: null,
      generated_at: null,
    }))).toBe(true);
  });

  it('accepts a narrative the validator emptied', () => {
    expect(isInsightsNarrative(buildNarrative({
      insights: [],
      recommendations: [],
      dropped: 9,
    }))).toBe(true);
  });

  it.each([
    ['a missing run timestamp', { run_timestamp: undefined }],
    ['a numeric model', { model: 4 }],
    ['a missing language', { language: undefined }],
    ['a drop count written as text', { dropped: '1' }],
    ['insights that are not a list', { insights: 'none' }],
  ])('rejects a narrative with %s', (_case, override) => {
    expect(isInsightsNarrative({
      ...buildNarrative(),
      ...override,
    })).toBe(false);
  });

  it('rejects an insight whose ids are not text', () => {
    expect(isInsightsNarrative({
      ...buildNarrative(),
      insights: [{
        text: buildNarrativeInsight().text,
        insight_ids: [1],
      }],
    })).toBe(false);
  });

  it('rejects a recommendation without a title', () => {
    const recommendation = buildNarrativeRecommendation();

    expect(isInsightsNarrative({
      ...buildNarrative(),
      recommendations: [{
        text: recommendation.text,
        insight_ids: recommendation.insight_ids,
      }],
    })).toBe(false);
  });
});

describe('decodeInsightsNarrative', () => {
  it('returns the narrative when it is well formed', () => {
    expect(decodeInsightsNarrative(buildNarrative())).toStrictEqual(buildNarrative());
  });

  it.each([null, {}, 'narrative'])('returns null for %j', (value) => {
    expect(decodeInsightsNarrative(value)).toBeNull();
  });
});
