import {
  describe, expect, it
} from 'vitest';
import {
  buildBrandTrendPoint, buildBrandTrends, LATEST_PERIOD, PREVIOUS_PERIOD
} from '../layout/reportPayload-fixtures';
import {
  brandTrendSeries, describeBrandTrend, TRACKED_SERIES_KEY
} from './brandTrendChartConfiguration';
import {
  COMPETITOR_LINE_COLOURS, EMERALD
} from './chartPalette';
import { LINE_WEIGHTS } from './lineChartConfiguration';
import { brandTrendChart } from './charts-fixtures';

/** Only the tracked brand's latest period, and a competitor measured in the period before only, with an unknown share. */
const STAGGERED_TRENDS = buildBrandTrends({
  tracked: [buildBrandTrendPoint(LATEST_PERIOD)],
  competitors: [{
    name: 'Adidas',
    points: [buildBrandTrendPoint(PREVIOUS_PERIOD, { share_of_voice: null })],
  }],
});

/** Six competitors, one more than the competitor palette. */
const SIX_COMPETITORS = buildBrandTrends({
  competitors: ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({
    name,
    points: [buildBrandTrendPoint(LATEST_PERIOD)],
  })),
});

describe('buildBrandTrendChartConfiguration', () => {
  it('is a line chart over the periods, oldest first', () => {
    const chart = brandTrendChart();

    expect([chart.type, chart.data.labels]).toStrictEqual(['line', [PREVIOUS_PERIOD, LATEST_PERIOD]]);
  });

  it('draws the tracked brand first, then each competitor by name', () => {
    expect(brandTrendChart().data.datasets.map((dataset) => dataset.label)).toStrictEqual(['Your brand', 'Adidas', 'Puma']);
  });

  it.each([
    ['share_of_voice', [[25, 25], [22, 20.8], [10, 12.5]]],
    ['mention_rate', [[60, 60], [55, 50], [25, 30]]],
    ['visibility_score', [[52.4, 52.4], [45, 41.3], [18.2, 22.7]]],
  ] as const)('plots every brand\'s %s per period', (metric, expected) => {
    expect(brandTrendChart(metric).data.datasets.map((dataset) => dataset.data)).toStrictEqual(expected);
  });

  it('draws the tracked brand in emerald and the competitors in the competitor palette', () => {
    expect(brandTrendChart().data.datasets.map((dataset) => dataset.borderColor))
      .toStrictEqual([EMERALD.light, COMPETITOR_LINE_COLOURS[0].light, COMPETITOR_LINE_COLOURS[1].light]);
  });

  it('draws the tracked brand thicker than the competitors', () => {
    expect(brandTrendChart().data.datasets.map((dataset) => dataset.borderWidth))
      .toStrictEqual([LINE_WEIGHTS.emphasised.borderWidth, LINE_WEIGHTS.regular.borderWidth, LINE_WEIGHTS.regular.borderWidth]);
  });

  it('starts the competitor palette over after its last colour', () => {
    expect(brandTrendChart('share_of_voice', SIX_COMPETITORS).data.datasets[6].borderColor).toBe(COMPETITOR_LINE_COLOURS[0].light);
  });

  it('spans the periods of every brand and leaves a gap where a brand has no value', () => {
    const chart = brandTrendChart('share_of_voice', STAGGERED_TRENDS);

    expect([chart.data.labels, chart.data.datasets.map((dataset) => dataset.data)])
      .toStrictEqual([[PREVIOUS_PERIOD, LATEST_PERIOD], [[null, 25], [null, null]]]);
  });

  it('draws nothing without a period', () => {
    expect(brandTrendChart('mention_rate', {
      tracked: [],
      competitors: [],
    }).data).toStrictEqual({
      labels: [],
      datasets: [],
    });
  });
});

describe('brandTrendSeries', () => {
  it('names the tracked brand with the given label and keys it apart from the competitors', () => {
    const [tracked] = brandTrendSeries(buildBrandTrends(), {
      metric: 'mention_rate',
      trackedLabel: 'Nike',
    });

    expect([tracked.key, tracked.label, tracked.emphasised]).toStrictEqual([TRACKED_SERIES_KEY, 'Nike', true]);
  });
});

describe('describeBrandTrend', () => {
  it('summarises the brands, the periods and the latest values in words', () => {
    const series = brandTrendSeries(buildBrandTrends(), {
      metric: 'visibility_score',
      trackedLabel: 'Nike',
    });

    expect(describeBrandTrend(series, 'visibility_score')).toBe(
      'Visibility score of Nike, Adidas and Puma over 2 periods from 2026-09-01 to 2026-09-08, on a 0–100 scale. '
      + 'Latest (2026-09-08): Nike 52.4, Adidas 41.3, Puma 22.7.',
    );
  });

  it('says nothing without a series', () => {
    expect(describeBrandTrend([], 'share_of_voice')).toBe('');
  });
});
