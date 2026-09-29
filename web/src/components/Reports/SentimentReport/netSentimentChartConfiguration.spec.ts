import {
  describe, it, expect
} from 'vitest';
import {
  buildNetSentimentChartConfiguration, describeNetSentimentTrend, NET_SENTIMENT_RANGE, netSentimentSeries
} from './netSentimentChartConfiguration';
import {
  buildTrendPoint, LATEST_PERIOD, PREVIOUS_PERIOD
} from '../layout/reportPayload-fixtures';
import { buildKpis } from '../BrandVisibilityReport/groupKpiHistory-fixtures';
import { LIGHT_THEME } from '../charts/charts-fixtures';
import { EMERALD } from '../charts/chartPalette';

const POINTS = [
  buildTrendPoint(PREVIOUS_PERIOD, { kpis: buildKpis({ net_sentiment: -20 }) }),
  buildTrendPoint(LATEST_PERIOD, { kpis: buildKpis({ net_sentiment: null }) }),
];

describe('netSentimentSeries', () => {
  it('has no series without a period', () => {
    expect(netSentimentSeries([])).toStrictEqual([]);
  });

  it('draws the net sentiment as one emphasised emerald line, unknown periods as gaps', () => {
    expect(netSentimentSeries(POINTS)).toStrictEqual([{
      key: 'net_sentiment',
      label: 'Net sentiment',
      colour: EMERALD,
      emphasised: true,
      points: [
        {
          label: PREVIOUS_PERIOD,
          value: -20,
        },
        {
          label: LATEST_PERIOD,
          value: null,
        },
      ],
    }]);
  });
});

describe('buildNetSentimentChartConfiguration', () => {
  it('draws one line of the net sentiment per period', () => {
    const configuration = buildNetSentimentChartConfiguration(netSentimentSeries(POINTS), LIGHT_THEME, false);

    expect([configuration.type, configuration.data.labels, configuration.data.datasets[0].data]).toStrictEqual([
      'line',
      [PREVIOUS_PERIOD, LATEST_PERIOD],
      [-20, null],
    ]);
  });

  it('scales the axis from −100 to +100', () => {
    const configuration = buildNetSentimentChartConfiguration(netSentimentSeries(POINTS), LIGHT_THEME, false);

    expect([configuration.options?.scales?.y?.min, configuration.options?.scales?.y?.max]).toStrictEqual([
      NET_SENTIMENT_RANGE.min,
      NET_SENTIMENT_RANGE.max,
    ]);
  });
});

describe('describeNetSentimentTrend', () => {
  it('is empty without a period', () => {
    expect(describeNetSentimentTrend([])).toBe('');
  });

  it('states the latest net sentiment of a single period', () => {
    expect(describeNetSentimentTrend(netSentimentSeries(POINTS.slice(0, 1)))).toBe(
      `Net sentiment over 1 period (${PREVIOUS_PERIOD}), from −100 (all negative) to +100 (all positive). Latest (${PREVIOUS_PERIOD}): -20.0.`,
    );
  });
});
