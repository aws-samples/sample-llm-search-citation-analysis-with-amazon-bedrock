import {
  describe, expect, it
} from 'vitest';
import {
  AGENT_MAX_QUERIES_PER_ROUND,
  briefProblems,
  dimensionLabel,
  estimateAgentCost,
  formatAgentCost,
} from './agentBrief';

const VALID_BRIEF = {
  seed: 'Hotel Gran Marino',
  dimensions: ['destination'] as const,
  country: 'es',
  language: 'es',
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
  it('returns the form label for a known dimension', () => {
    expect(dimensionLabel('points_of_interest')).toBe('Points of interest');
  });

  it('reads unknown ids and the other bucket as Other', () => {
    expect(dimensionLabel('other')).toBe('Other');
    expect(dimensionLabel(undefined)).toBe('Other');
  });
});

describe('briefProblems', () => {
  it('accepts a complete brief', () => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [...VALID_BRIEF.dimensions],
    })).toStrictEqual([]);
  });

  it('requires a hotel name of at least two characters', () => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [...VALID_BRIEF.dimensions],
      seed: 'H',
    })).toStrictEqual(['Enter the hotel name (or a seed keyword).']);
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

  it('rejects instructions that are too short', () => {
    expect(briefProblems({
      ...VALID_BRIEF,
      dimensions: [...VALID_BRIEF.dimensions],
      systemPrompt: 'short',
    })).toStrictEqual(['The agent instructions are too short.']);
  });
});
