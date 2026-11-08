import {
  describe, expect, it
} from 'vitest';
import {
  buildSnapshotPoint, buildSnapshots, buildTrackedDomain
} from '../../../api/seoBacklinks-fixtures';
import { getChartTheme } from '../../ui/chartTheme';
import {
  authoritySeries, buildAuthorityChartConfiguration, lastMonths
} from './backlinksChartConfiguration';

describe('lastMonths', () => {
  it('keeps the latest 12 points of a longer history', () => {
    const points = Array.from({ length: 14 }, (_, index) => ({ date: `2025-${String(index + 1).padStart(2, '0')}` }));

    expect(lastMonths(points).map((point) => point.date)).toStrictEqual(points.slice(2).map((point) => point.date));
  });
});

describe('authoritySeries', () => {
  it('draws your domains thicker than competitors and names the competitor', () => {
    const series = authoritySeries(buildSnapshots().domains);

    expect(series.map((entry) => [entry.label, entry.emphasised])).toStrictEqual([
      ['example.com', true],
      ['acme.example.org (Acme)', false],
    ]);
  });

  it('leaves out a tracked domain without snapshots', () => {
    expect(authoritySeries([buildTrackedDomain({ snapshots: [] })])).toStrictEqual([]);
  });
});

describe('buildAuthorityChartConfiguration', () => {
  it('puts every snapshot date in time order with gaps where a domain has no point', () => {
    const series = authoritySeries([
      buildTrackedDomain({ snapshots: [buildSnapshotPoint('2026-10-05T06:00:00Z', 41)] }),
      buildTrackedDomain({
        domain: 'acme.example.org',
        role: 'competitor',
        competitor: 'Acme',
        snapshots: [buildSnapshotPoint('2026-09-28T06:00:00Z', 50), buildSnapshotPoint('2026-10-05T06:00:00Z', 52)],
      }),
    ]);

    const configuration = buildAuthorityChartConfiguration(series, getChartTheme(false), false);

    expect([configuration.data.labels, configuration.data.datasets.map((dataset) => dataset.data)]).toStrictEqual([
      ['2026-09-28', '2026-10-05'],
      [[null, 41], [50, 52]],
    ]);
  });
});
