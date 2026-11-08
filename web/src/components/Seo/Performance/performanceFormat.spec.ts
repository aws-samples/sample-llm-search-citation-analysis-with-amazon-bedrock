import {
  describe, expect, it
} from 'vitest';
import {
  METRICS, descriptionParts, formatMetric, metricRating, savingsText, scoreRating
} from './performanceFormat';

const [lcp, cls] = METRICS;

describe('scoreRating', () => {
  it.each([[90, 'good'], [89, 'needs-improvement'], [50, 'needs-improvement'], [49, 'poor'], [0, 'poor']])(
    'rates a score of %i as %s', (score, rating) => {
      expect(scoreRating(score)).toBe(rating);
    }
  );
});

describe('metricRating', () => {
  it.each([[2500, 'good'], [2501, 'needs-improvement'], [4000, 'needs-improvement'], [4001, 'poor']])(
    'rates an LCP of %i ms as %s', (value, rating) => {
      expect(metricRating(value, lcp)).toBe(rating);
    }
  );

  it('rates a layout shift just above 0.1 as needing improvement', () => {
    expect(metricRating(0.11, cls)).toBe('needs-improvement');
  });
});

describe('formatMetric', () => {
  it.each([[420.4, 'ms', '420 ms'], [2100, 'ms', '2.1 s'], [0.054, 'unitless', '0.05'], [null, 'ms', '–']] as const)(
    'formats %s %s as %s', (value, unit, text) => {
      expect(formatMetric(value, unit)).toBe(text);
    }
  );
});

describe('savingsText', () => {
  it('is empty when the report estimates no saving', () => {
    expect(savingsText(null, 0)).toBe('');
  });

  it('joins the time and size saved', () => {
    expect(savingsText(1200, 51_200)).toBe('saves ~1.2 s · 50 KB');
  });
});

describe('descriptionParts', () => {
  it('splits a Markdown link out of the text around it', () => {
    expect(descriptionParts('Redirects delay. [Learn more](https://developer.chrome.com/x). Done')).toStrictEqual([
      { text: 'Redirects delay. ' },
      {
        text: 'Learn more',
        href: 'https://developer.chrome.com/x',
      },
      { text: '. Done' },
    ]);
  });

  it('keeps a description without links as one text part', () => {
    expect(descriptionParts('Plain text')).toStrictEqual([{ text: 'Plain text' }]);
  });

  it('returns no part for an empty description', () => {
    expect(descriptionParts('')).toStrictEqual([]);
  });

  it('keeps brackets that are not a link as text', () => {
    expect(descriptionParts('Use [x] then (y)')).toStrictEqual([{ text: 'Use [x] then (y)' }]);
  });
});
