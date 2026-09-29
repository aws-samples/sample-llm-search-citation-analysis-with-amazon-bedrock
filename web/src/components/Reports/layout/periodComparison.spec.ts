import {
  describe, expect, it
} from 'vitest';
import {
  periodComparison, runComparison
} from './periodComparison';
import { buildPeriodChange } from './reportPayload-fixtures';
import {
  GROUP_DELTAS, GROUP_TRENDS
} from '../BrandVisibilityReport/groupKpiHistory-fixtures';

describe('periodComparison', () => {
  it('has nothing to compare before a second period', () => {
    expect(periodComparison(null, 'day')).toBeNull();
  });

  it('carries every delta and trend of the change', () => {
    expect(periodComparison(buildPeriodChange(), 'day')).toStrictEqual({
      deltas: GROUP_DELTAS,
      trends: GROUP_TRENDS,
      label: 'vs previous day (3 keywords)',
    });
  });

  it.each([
    [1, 'day', 'vs previous day (1 keyword)'],
    [2, 'week', 'vs previous week (2 keywords)'],
    [12, 'month', 'vs previous month (12 keywords)'],
  ] as const)('labels %s compared keyword(s) per %s as "%s"', (keywords, period, label) => {
    expect(periodComparison(buildPeriodChange({ keywords_compared: keywords }), period)?.label).toBe(label);
  });
});

describe('runComparison', () => {
  it('has nothing to compare before a keyword has two runs', () => {
    expect(runComparison(null)).toBeNull();
  });

  it.each([
    [1, 'vs previous run (1 keyword)'],
    [4, 'vs previous run (4 keywords)'],
  ])('compares %s keyword(s) with their previous run as "%s"', (keywords, label) => {
    expect(runComparison(buildPeriodChange({ keywords_compared: keywords }))).toStrictEqual({
      deltas: GROUP_DELTAS,
      trends: GROUP_TRENDS,
      label,
    });
  });
});
