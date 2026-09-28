import {
  describe, expect, it
} from 'vitest';
import {
  groupRuns, latestGroupRun, modelChanges, runTrend, trendAccent
} from './groupKpiView';
import {
  buildChange, buildRun, buildTrends, RUN_1, RUN_2, RUN_3
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

describe('trendAccent', () => {
  it.each([
    ['improving', 'positive'],
    ['declining', 'negative'],
    ['stable', 'neutral'],
    [undefined, 'neutral'],
  ] as const)('colours a %s trend %s', (trend, accent) => {
    expect(trendAccent(trend)).toBe(accent);
  });
});

describe('runTrend', () => {
  const compared = buildRun({
    change: buildChange({
      trends: buildTrends({
        mention_rate: 'declining',
        average_position: 'improving',
      }),
    }),
  });

  it.each([
    ['mention_rate', 'declining'],
    ['average_position', 'improving'],
    ['visibility_score', 'stable'],
  ] as const)('returns the %s trend of the run change: %s', (id, trend) => {
    expect(runTrend(compared, id)).toBe(trend);
  });

  it('returns no trend for a run without a change', () => {
    expect(runTrend(buildRun({ change: null }), 'mention_rate')).toBeUndefined();
  });

  it('returns no trend for a count KPI, which is never trended', () => {
    expect(runTrend(compared, 'mentions')).toBeUndefined();
  });
});
