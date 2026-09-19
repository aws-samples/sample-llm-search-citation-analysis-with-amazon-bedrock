import {
  describe, expect, it
} from 'vitest';
import {
  AGENT_MAX_QUERIES_PER_ROUND,
  briefProblems,
  dimensionLabel,
  estimateAgentCost,
  formatAgentCost,
  orderedDimensionIds,
  runCatalog,
  seedPlaceholder,
  subjectHeading,
  subjectLabel,
} from './agentBrief';
import {
  CAFE_DIMENSIONS, HOTEL_DIMENSIONS, buildAgentJob
} from './agent-fixtures';

const VALID_BRIEF = {
  seed: 'Hotel Gran Marino',
  subject: 'hotel',
  dimensions: ['destination'] as const,
  country: 'es',
  language: 'es',
  targetCount: 60,
  trackingCount: 15,
  systemPrompt: 'You are a hotel SEO researcher for a hotel group.',
};

describe('estimateAgentCost', () => {
  it('bounds web searches by the per-round query cap times the rounds', () => {
    expect(estimateAgentCost(2).webSearches).toBe(AGENT_MAX_QUERIES_PER_ROUND * 2);
  });

  it('counts one plan, one evaluation per round and one selection as model calls', () => {
    expect(estimateAgentCost(3).modelCalls).toBe(5);
  });

  it('counts two Google signal lookups per query', () => {
    expect(estimateAgentCost(1).googleSignalCalls).toBe(AGENT_MAX_QUERIES_PER_ROUND * 2);
  });

  it('clamps the rounds into the allowed range', () => {
    expect(estimateAgentCost(9)).toStrictEqual(estimateAgentCost(3));
    expect(estimateAgentCost(0)).toStrictEqual(estimateAgentCost(1));
  });

  it('formats the estimate as one sentence', () => {
    expect(formatAgentCost(estimateAgentCost(2))).toBe('Up to 16 web searches, 4 model calls and 32 Google signal lookups (when SerpAPI is configured).');
  });
});

describe('dimensionLabel', () => {
  it('returns the catalogue label when the id is in the catalogue', () => {
    expect(dimensionLabel('points_of_interest', HOTEL_DIMENSIONS)).toBe('Points of interest');
  });

  it('labels the same id from a different catalogue with that catalogue\'s wording', () => {
    expect(dimensionLabel('location', CAFE_DIMENSIONS)).toBe('Location');
  });

  it.each([
    ['the other bucket', 'other'],
    ['an id the catalogue does not know', 'weather'],
    ['no dimension', undefined],
  ])('reads as Other when the keyword carries %s', (_case, dimension) => {
    expect(dimensionLabel(dimension, HOTEL_DIMENSIONS)).toBe('Other');
  });

  it('reads as Other when the catalogue is empty', () => {
    expect(dimensionLabel('destination', [])).toBe('Other');
  });
});

describe('runCatalog', () => {
  it('returns the catalogue snapshotted on the run', () => {
    expect(runCatalog(buildAgentJob())).toStrictEqual(HOTEL_DIMENSIONS);
  });

  it('is empty when the run has no brief', () => {
    expect(runCatalog(buildAgentJob({ config: undefined }))).toStrictEqual([]);
  });
});

describe('orderedDimensionIds', () => {
  it('lists the catalogue ids in order and the other bucket last', () => {
    expect(orderedDimensionIds(CAFE_DIMENSIONS)).toStrictEqual(['menu', 'location', 'occasion', 'other']);
  });

  it('is just the other bucket when the catalogue is empty', () => {
    expect(orderedDimensionIds([])).toStrictEqual(['other']);
  });
});

describe('subjectLabel', () => {
  it.each([
    ['café', 'Café'],
    ['hotel', 'Hotel'],
    ['Store', 'Store'],
  ])('capitalises the first letter of %s', (subject, label) => {
    expect(subjectLabel(subject)).toBe(label);
  });
});

describe('subjectHeading', () => {
  it('uses the article a before a consonant', () => {
    expect(subjectHeading('café')).toBe('Research a café');
  });

  it('uses the article an before a vowel', () => {
    expect(subjectHeading('inn')).toBe('Research an inn');
  });
});

describe('seedPlaceholder', () => {
  it.each([
    ['hotel', 'e.g. Hotel Gran Marino'],
    ['restaurant', 'e.g. Casa Lucio'],
    ['café', 'e.g. Café Central'],
    ['store', 'e.g. Zara Gran Vía'],
  ])('suggests an example %s', (subject, placeholder) => {
    expect(seedPlaceholder(subject)).toBe(placeholder);
  });

  it('matches the subject regardless of case and surrounding spaces', () => {
    expect(seedPlaceholder(' Hotel ')).toBe('e.g. Hotel Gran Marino');
  });

  it('falls back to a generic business name for any other subject', () => {
    expect(seedPlaceholder('gym')).toBe('e.g. your business name');
  });
});

describe('briefProblems', () => {
  it('accepts a complete brief', () => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [...VALID_BRIEF.dimensions],
    })).toStrictEqual([]);
  });

  it('requires a name of at least two characters, worded for the template subject', () => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [...VALID_BRIEF.dimensions],
      subject: 'café',
      seed: 'C',
    })).toStrictEqual(['Enter the café name (or a seed keyword).']);
  });

  it('requires at least one dimension', () => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [],
    })).toStrictEqual(['Pick at least one expansion dimension.']);
  });

  it('requires two-letter country and language codes', () => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [...VALID_BRIEF.dimensions],
      country: 'spain',
      language: '1',
    })).toStrictEqual([
      'Country must be a two-letter code (e.g. es).',
      'Language must be a two-letter code (e.g. es).',
    ]);
  });

  it('rejects a tracking count above the proposal target', () => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [...VALID_BRIEF.dimensions],
      targetCount: 10,
      trackingCount: 11,
    })).toStrictEqual(['Tracking keywords cannot exceed target keywords.']);
  });

  it.each([
    {
      trackingCount: 0,
      position: 'below',
    },
    {
      trackingCount: 51,
      position: 'above',
    },
  ])('rejects a tracking count when it is $position the supported range', ({ trackingCount }) => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [...VALID_BRIEF.dimensions],
      trackingCount,
    })).toStrictEqual(['Tracking keywords must be between 1 and 50.']);
  });

  it('rejects instructions that are too short', () => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [...VALID_BRIEF.dimensions],
      systemPrompt: 'short',
    })).toStrictEqual(['The agent instructions are too short.']);
  });
});
