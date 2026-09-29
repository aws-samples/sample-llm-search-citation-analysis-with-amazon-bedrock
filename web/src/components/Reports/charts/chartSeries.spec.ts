import {
  describe, expect, it
} from 'vitest';
import {
  listInWords, periodsInWords, seriesLabels, valuesAt
} from './chartSeries';
import { buildSeries } from './charts-fixtures';

describe('seriesLabels', () => {
  it('lists every point label once, in order of first appearance', () => {
    const series = [buildSeries('a', [['Mon', 1], ['Wed', 2]]), buildSeries('b', [['Mon', 3], ['Tue', 4], ['Wed', 5]])];

    expect(seriesLabels(series)).toStrictEqual(['Mon', 'Wed', 'Tue']);
  });

  it('returns no label without a series', () => {
    expect(seriesLabels([])).toStrictEqual([]);
  });
});

describe('valuesAt', () => {
  it('returns the value of each label, keeping zero and unknown values', () => {
    expect(valuesAt(buildSeries('a', [['Mon', 0], ['Tue', null]]), ['Mon', 'Tue'])).toStrictEqual([0, null]);
  });

  it('returns a gap for a label the series has no point for', () => {
    expect(valuesAt(buildSeries('a', [['Tue', 4]]), ['Mon', 'Tue'])).toStrictEqual([null, 4]);
  });
});

describe('listInWords', () => {
  it.each([
    ['no item', [], ''],
    ['one item', ['A'], 'A'],
    ['two items', ['A', 'B'], 'A and B'],
    ['three items', ['A', 'B', 'C'], 'A, B and C'],
  ])('lists %s in words', (_case, items, expected) => {
    expect(listInWords(items)).toBe(expected);
  });
});

describe('periodsInWords', () => {
  it('names the only period', () => {
    expect(periodsInWords(['2026-09-08'])).toBe('1 period (2026-09-08)');
  });

  it('counts the periods from the first to the last', () => {
    expect(periodsInWords(['2026-09-01', '2026-09-04', '2026-09-08'])).toBe('3 periods from 2026-09-01 to 2026-09-08');
  });
});
