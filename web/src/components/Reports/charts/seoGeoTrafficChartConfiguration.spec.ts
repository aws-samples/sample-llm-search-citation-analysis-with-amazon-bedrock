import {
  describe, expect, it
} from 'vitest';
import {
  buildTrafficShareChartConfiguration, describeTrafficShares, shareTooltipLabel, trafficShareSeries
} from './seoGeoTrafficChartConfiguration';
import { getChartTheme } from '../../ui/chartTheme';
import { TRAFFIC_COMPARISON } from '../../../hooks/useSeoGeo-fixtures';

const SERIES = trafficShareSeries(TRAFFIC_COMPARISON);

describe('trafficShareSeries', () => {
  it('sets the traffic share beside the AI share of voice', () => {
    expect(SERIES.map((series) => series.label)).toStrictEqual(['Share of estimated search traffic', 'Share of AI mentions']);
  });

  it('groups the bars per brand, you first', () => {
    expect(SERIES[0]?.points).toStrictEqual([
      {
        label: 'You',
        value: 40,
      },
      {
        label: 'Acme',
        value: 60,
      },
    ]);
  });

  it('draws nothing when no brand has a traffic share', () => {
    expect(trafficShareSeries([{
      ...TRAFFIC_COMPARISON[0],
      estimated_traffic: null,
      traffic_share: null,
    }])).toStrictEqual([]);
  });
});

describe('buildTrafficShareChartConfiguration', () => {
  it('draws two bar datasets on the 0–100 axis', () => {
    const configuration = buildTrafficShareChartConfiguration(SERIES, getChartTheme(false), false);

    expect([configuration.type, configuration.data.datasets.length]).toStrictEqual(['bar', 2]);
  });
});

describe('describeTrafficShares', () => {
  it('reads both shares of each brand', () => {
    expect(describeTrafficShares(SERIES)).toBe(
      'Share of estimated search traffic against share of AI mentions. You: 40.0% and 50.0%. Acme: 60.0% and 25.0%.',
    );
  });

  it('is empty without series', () => {
    expect(describeTrafficShares([])).toBe('');
  });
});

describe('shareTooltipLabel', () => {
  it('names the share in percent', () => {
    expect(shareTooltipLabel({
      dataset: {
        label: 'Share of AI mentions',
        data: [] 
      },
      raw: 25,
    })).toBe('Share of AI mentions: 25.0%');
  });
});
