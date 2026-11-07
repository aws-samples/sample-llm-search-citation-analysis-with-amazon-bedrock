import {
  describe, expect, it
} from 'vitest';
import { buildTrendPoint } from '../../../api/seoRankTracking-fixtures';
import type { RankHistoryPoint } from '../../../types/api/seoRankTracking';
import { getChartTheme } from '../../ui/chartTheme';
import {
  buildHistoryChartConfiguration, buildTrendChartConfiguration, describeTrend, deviceValues
} from './rankChartConfiguration';

const THEME = getChartTheme(false);
const POINTS: RankHistoryPoint[] = [
  {
    device: 'desktop',
    checked_at: '2026-10-01T08:00:00.000000Z',
    position: 5,
    status: 'found',
    url: null 
  },
  {
    device: 'desktop',
    checked_at: '2026-10-02T08:00:00.000000Z',
    position: null,
    status: 'not_found',
    url: null 
  },
  {
    device: 'mobile',
    checked_at: '2026-10-03T08:00:00.000000Z',
    position: 2,
    status: 'found',
    url: null 
  },
];
const LABELS = ['2026-10-01', '2026-10-02', '2026-10-03'];

describe('deviceValues', () => {
  it('plots a miss at the depth and an unchecked day as a gap', () => {
    expect(deviceValues({
      depth: 30,
      points: POINTS 
    }, 'desktop', LABELS)).toStrictEqual([5, 30, null]);
  });
});

describe('buildHistoryChartConfiguration', () => {
  const series = [{
    depth: 30,
    points: POINTS,
  }];
  const configuration = buildHistoryChartConfiguration(series, THEME, false);

  it('draws one line per device that was checked', () => {
    expect(configuration.data.datasets.map((dataset) => dataset.label)).toStrictEqual(['Desktop', 'Mobile']);
  });

  it('reverses the position axis from one to the depth', () => {
    expect(configuration.options?.scales?.y).toMatchObject({
      reverse: true,
      min: 1,
      max: 30,
    });
  });
});

describe('buildTrendChartConfiguration', () => {
  it('stacks the five position buckets of each run', () => {
    const configuration = buildTrendChartConfiguration([buildTrendPoint()], THEME, false);

    expect(configuration.data.datasets.map((dataset) => dataset.data)).toStrictEqual([[0], [1], [1], [0], [0]]);
  });
});

describe('describeTrend', () => {
  it.each([
    [[buildTrendPoint()], 'Latest check 2026-10-05: Top 3 0, 4–10 1, 11–20 1, Not in top 20 0, Not checked 0.'],
    [[], 'No finished rank check yet.'],
  ])('reads out the newest run or that none finished (%#)', (points, text) => {
    expect(describeTrend(points)).toBe(text);
  });
});
