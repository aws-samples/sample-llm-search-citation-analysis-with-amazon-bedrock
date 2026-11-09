import {
  describe, expect, it
} from 'vitest';
import {
  describeAnswers, describeEngines, describePersonas, maxAnswers, runTargetsFrom
} from './runTargets';
import {
  READY_ENGINES, TWO_PERSONAS
} from './runTargets-fixtures';

describe('runTargetsFrom', () => {
  it('keeps the enabled answer engines with a key and the enabled personas', () => {
    expect(runTargetsFrom(READY_ENGINES, TWO_PERSONAS)).toStrictEqual({
      chatEngines: ['OpenAI', 'Perplexity'],
      aiOverviews: true,
      personas: ['Family Traveler', 'Business traveler'],
    });
  });
});

describe('maxAnswers', () => {
  const targets = runTargetsFrom(READY_ENGINES, TWO_PERSONAS);

  it('counts each chat engine once per persona and AI Overviews once per keyword', () => {
    // 10 keywords × (2 chat engines × 2 personas + 1 AI Overview)
    expect(maxAnswers(10, targets)).toBe(50);
  });

  it('asks each keyword as written when no persona is enabled', () => {
    expect(maxAnswers(10, {
      ...targets,
      personas: [],
    })).toBe(30);
  });
});

describe('run target wording', () => {
  const targets = runTargetsFrom(READY_ENGINES, TWO_PERSONAS);

  it('lists the engines with AI Overviews last', () => {
    expect(describeEngines(targets)).toBe('3 AI engines: OpenAI, Perplexity, Google AI Overviews');
  });

  it.each([
    [TWO_PERSONAS, '2 personas: Family Traveler, Business traveler'],
    [[], 'No personas: each keyword is asked as written'],
  ])('describes the personas', (prompts, expected) => {
    expect(describePersonas(runTargetsFrom(READY_ENGINES, prompts))).toBe(expected);
  });

  it('states the answers as a maximum, in the singular for one', () => {
    expect(describeAnswers(1, {
      chatEngines: ['OpenAI'],
      aiOverviews: false,
      personas: [],
    })).toBe('Up to 1 answer, each a billed request to an AI engine.');
  });
});
