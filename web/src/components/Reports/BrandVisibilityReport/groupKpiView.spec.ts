import {
  describe, expect, it
} from 'vitest';
import {
  deltaAccent, formatPercent, formatPointsDelta, formatRank, formatRankDelta, groupRuns, latestGroupRun, modelChanges
} from './groupKpiView';
import {
  buildRun, RUN_1, RUN_2, RUN_3
} from './groupKpiHistory-fixtures';

const PARTIAL = buildRun({
  timestamp: RUN_3,
  is_group_run: false 
});

describe('groupRuns', () => {
  it('keeps only the runs covering at least half of the keywords', () => {
    const runs = [buildRun({ timestamp: RUN_1 }), PARTIAL, buildRun({ timestamp: RUN_2 })];

    expect(groupRuns(runs).map((run) => run.timestamp)).toStrictEqual([RUN_1, RUN_2]);
  });
});

describe('latestGroupRun', () => {
  it('returns the newest group run even when a partial run is newer', () => {
    expect(latestGroupRun([buildRun({ timestamp: RUN_1 }), buildRun({ timestamp: RUN_2 }), PARTIAL])?.timestamp).toBe(RUN_2);
  });

  it('returns null when the window holds only partial runs', () => {
    expect(latestGroupRun([PARTIAL])).toBeNull();
  });
});

describe('modelChanges', () => {
  it('reports a provider that answered with another model than in the previous group run', () => {
    const runs = [
      buildRun({
        timestamp: RUN_1,
        models: { openai: ['gpt-5-mini'] } 
      }),
      buildRun({
        timestamp: RUN_2,
        models: { openai: ['gpt-5.2'] } 
      }),
    ];

    expect(modelChanges(runs)).toStrictEqual([{
      timestamp: RUN_2,
      provider: 'openai',
      from: ['gpt-5-mini'],
      to: ['gpt-5.2'] 
    }]);
  });

  it('ignores partial runs when looking for the previous models', () => {
    const runs = [
      buildRun({
        timestamp: RUN_1,
        models: { openai: ['gpt-5-mini'] } 
      }),
      buildRun({
        timestamp: RUN_2,
        is_group_run: false,
        models: { openai: ['gpt-4.1'] } 
      }),
      buildRun({
        timestamp: RUN_3,
        models: { openai: ['gpt-5-mini'] } 
      }),
    ];

    expect(modelChanges(runs)).toStrictEqual([]);
  });

  it('does not count a provider that is missing from one of the runs', () => {
    const runs = [
      buildRun({
        timestamp: RUN_1,
        models: { openai: ['gpt-5-mini'] } 
      }),
      buildRun({
        timestamp: RUN_2,
        models: { gemini: ['gemini-2.5-pro'] } 
      }),
    ];

    expect(modelChanges(runs)).toStrictEqual([]);
  });

  it.each([
    ['a model dropped from a list', ['a', 'b'], ['a']],
    ['a model added to a list', ['a'], ['a', 'b']],
    ['one of two models replaced', ['a', 'b'], ['a', 'c']],
    ['two models turned into one joined name', ['a', 'b'], ['a\nb']],
    ['the same models in another order', ['a', 'b'], ['b', 'a']],
  ])('counts %s as a model change', (_label, before, after) => {
    const runs = [
      buildRun({
        timestamp: RUN_1,
        models: { openai: before } 
      }),
      buildRun({
        timestamp: RUN_2,
        models: { openai: after } 
      }),
    ];

    expect(modelChanges(runs)).toHaveLength(1);
  });
});

describe('formatting', () => {
  it.each([
    [42.54, '42.5%'],
    [0, '0.0%'],
    [null, '—'],
  ])('writes the percentage %s as %s', (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });

  it.each([
    [1.8, '1.80'],
    [null, '—'],
  ])('writes the mean rank %s as %s', (value, expected) => {
    expect(formatRank(value)).toBe(expected);
  });

  it.each([
    [2.54, '+2.5 pts'],
    [-1, '-1.0 pts'],
    [0, '0.0 pts'],
    [null, '—'],
  ])('writes the change %s as %s', (value, expected) => {
    expect(formatPointsDelta(value)).toBe(expected);
  });

  it.each([
    [0.5, '+0.50'],
    [-0.25, '-0.25'],
    [null, '—'],
  ])('writes the rank change %s as %s', (value, expected) => {
    expect(formatRankDelta(value)).toBe(expected);
  });
});

describe('deltaAccent', () => {
  it.each([
    [5, true, 'positive'],
    [-5, true, 'negative'],
    [0.5, false, 'negative'],
    [-0.5, false, 'positive'],
    [0, true, 'neutral'],
    [0, false, 'neutral'],
    [null, true, 'neutral'],
  ] as const)('colours the change %s (higher is better: %s) %s', (value, higherIsBetter, expected) => {
    expect(deltaAccent(value, higherIsBetter)).toBe(expected);
  });
});
