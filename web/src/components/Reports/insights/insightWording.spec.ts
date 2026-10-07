import {
  describe, expect, it
} from 'vitest';
import {
  buildInsight, GEMINI_INSIGHT, UNSTABLE_KEYWORD_INSIGHT, WEAK_SUBBRAND_INSIGHT
} from '../../../types/domain/insights-fixtures';
import {
  formatGap, insightSentence, PLAY_LABELS
} from './insightWording';

describe('insightSentence', () => {
  it('reads an engine play from its top-1 share, citation rate and play', () => {
    expect(insightSentence(buildInsight())).toBe('OpenAI: ranked first in 40.0% of answers, links to a tracked domain in 80.0%. Play: get ranked first.');
  });

  it('names the engine by its display name and the play by its label', () => {
    expect(insightSentence(GEMINI_INSIGHT)).toBe('Google Gemini: ranked first in 60.0% of answers, links to a tracked domain in 20.0%. Play: get cited.');
  });

  it('says the citation rate is not measured when no owned domain is configured', () => {
    const insight = buildInsight({
      evidence: {
        top_1_share: 40,
        citation_rate: null,
        answers: 10,
        play: 'get_ranked_first',
      },
    });

    expect(insightSentence(insight)).toBe('OpenAI: ranked first in 40.0% of answers; citation rate not measured. Play: get ranked first.');
  });

  it('keeps an engine the dashboard does not know by its id, and calls an unknown play unknown', () => {
    const insight = buildInsight({
      subject: 'mistral',
      evidence: {
        top_1_share: 10,
        citation_rate: 5,
        answers: 2,
        play: 'attack',
      },
    });

    expect(insightSentence(insight)).toBe('mistral: ranked first in 10.0% of answers, links to a tracked domain in 5.0%. Play: unknown.');
  });

  it('reads a weak brand from its mentions, position, sentiment and both gaps', () => {
    expect(insightSentence(WEAK_SUBBRAND_INSIGHT)).toBe(
      'Aurora Miles: named in 9 answers at average position 4.78 (2.70 places behind your best brand), net sentiment +55.6 (36.3 points behind your best brand).',
    );
  });

  it('leaves out the gap a brand does not trail on', () => {
    const insight = buildInsight({
      ...WEAK_SUBBRAND_INSIGHT,
      evidence: {
        mentions: 9,
        average_position: 2.08,
        net_sentiment: 55.6,
        position_gap: 0,
        sentiment_gap: 36.3,
      },
    });

    expect(insightSentence(insight)).toBe('Aurora Miles: named in 9 answers at average position 2.08, net sentiment +55.6 (36.3 points behind your best brand).');
  });

  it('writes an unknown position and gap as dashes', () => {
    const insight = buildInsight({
      ...WEAK_SUBBRAND_INSIGHT,
      evidence: {
        mentions: 9,
        average_position: null,
        net_sentiment: 55.6,
        position_gap: null,
        sentiment_gap: 36.3,
      },
    });

    expect(insightSentence(insight)).toBe('Aurora Miles: named in 9 answers at average position —, net sentiment +55.6 (36.3 points behind your best brand).');
  });

  it('reads an unstable keyword from its positions, runs, range and flips', () => {
    expect(insightSentence(UNSTABLE_KEYWORD_INSIGHT)).toBe(
      'cheap flights to Lima: placed between 1.50 and 5.00 over 3 runs, a swing of 3.50 places, with 1 mention flip.',
    );
  });

  it('pluralises the flips of a keyword that flipped more than once', () => {
    const insight = buildInsight({
      ...UNSTABLE_KEYWORD_INSIGHT,
      evidence: {
        ...UNSTABLE_KEYWORD_INSIGHT.evidence,
        flips: 2,
      },
    });

    expect(insightSentence(insight)).toMatch(/with 2 mention flips\.$/u);
  });

  it('writes a missing figure as a dash rather than recomputing it', () => {
    const insight = buildInsight({
      ...UNSTABLE_KEYWORD_INSIGHT,
      evidence: { runs: 2 },
    });

    expect(insightSentence(insight)).toBe('cheap flights to Lima: placed between — and — over 2 runs, a swing of — places, with — mention flips.');
  });
});

describe('PLAY_LABELS', () => {
  it('labels the four plays as the chips show them', () => {
    expect(Object.values(PLAY_LABELS)).toStrictEqual(['Get cited', 'Get ranked first', 'Get mentioned and cited', 'Defend']);
  });
});

describe('formatGap', () => {
  it.each([
    [2.7, 2, '2.70'],
    [36.3, 1, '36.3'],
    [0, 1, '0.0'],
  ])('writes %s with %i decimals as %s', (value, digits, text) => {
    expect(formatGap(value, digits)).toBe(text);
  });

  it('writes an unknown gap as a dash', () => {
    expect(formatGap(null, 2)).toBe('—');
  });
});
