import {
  describe, expect, it
} from 'vitest';
import {
  DEFAULT_KPI_TREND_IDS, describeKpiTrend, kpiTrendSeries
} from './kpiTrendChartConfiguration';
import { KPI_COLOURS } from './chartKpis';
import { LINE_WEIGHTS } from './lineChartConfiguration';
import {
  KPI_POINTS, kpiTrendChart
} from './charts-fixtures';

describe('buildKpiTrendChartConfiguration', () => {
  it('draws the mention rate, share of voice, visibility score and citation rate by default', () => {
    expect(DEFAULT_KPI_TREND_IDS).toStrictEqual(['mention_rate', 'share_of_voice', 'visibility_score', 'citation_rate']);
  });

  it('is a line chart', () => {
    expect(kpiTrendChart().type).toBe('line');
  });

  it('labels every line with its KPI definition label', () => {
    expect(kpiTrendChart().data.datasets.map((dataset) => dataset.label))
      .toStrictEqual(['Mention rate', 'Share of voice', 'Visibility score', 'Citation rate']);
  });

  it('plots each KPI per point, oldest first, with an unknown value as a gap', () => {
    expect(kpiTrendChart().data.datasets.map((dataset) => dataset.data)).toStrictEqual([[70, 60], [20, 25], [58.1, 52.4], [29, null]]);
  });

  it('labels the x axis with the point labels', () => {
    expect(kpiTrendChart().data.labels).toStrictEqual(['2026-09-01', '2026-09-08']);
  });

  it('never bridges a gap', () => {
    expect(kpiTrendChart().data.datasets.map((dataset) => dataset.spanGaps)).toStrictEqual([false, false, false, false]);
  });

  it.each([
    ['light', false],
    ['dark', true],
  ] as const)('draws every KPI in its fixed %s colour', (variant, isDark) => {
    expect(kpiTrendChart(KPI_POINTS, isDark).data.datasets.map((dataset) => dataset.borderColor))
      .toStrictEqual(DEFAULT_KPI_TREND_IDS.map((id) => KPI_COLOURS[id][variant]));
  });

  it('draws every KPI line at the regular weight', () => {
    expect(kpiTrendChart().data.datasets.map((dataset) => dataset.borderWidth)).toStrictEqual(Array.from({ length: 4 }, () => LINE_WEIGHTS.regular.borderWidth));
  });

  it('draws nothing without a point', () => {
    expect(kpiTrendChart([]).data).toStrictEqual({
      labels: [],
      datasets: [],
    });
  });
});

describe('kpiTrendSeries', () => {
  it('draws only the requested KPIs, in the requested order', () => {
    expect(kpiTrendSeries(KPI_POINTS, ['top_1_share', 'mention_rate']).map((line) => line.key)).toStrictEqual(['top_1_share', 'mention_rate']);
  });
});

describe('describeKpiTrend', () => {
  it('summarises the KPIs, the periods and the latest values in words', () => {
    expect(describeKpiTrend(kpiTrendSeries(KPI_POINTS, ['mention_rate', 'citation_rate']))).toBe(
      'Mention rate and Citation rate over 2 periods from 2026-09-01 to 2026-09-08, on a 0–100 scale. '
      + 'Latest (2026-09-08): Mention rate 60.0%, Citation rate —.',
    );
  });

  it('names the only period of a single-point trend', () => {
    expect(describeKpiTrend(kpiTrendSeries(KPI_POINTS.slice(0, 1), ['share_of_voice']))).toBe(
      'Share of voice over 1 period (2026-09-01), on a 0–100 scale. Latest (2026-09-01): Share of voice 20.0%.',
    );
  });

  it('says nothing without a series', () => {
    expect(describeKpiTrend([])).toBe('');
  });
});
