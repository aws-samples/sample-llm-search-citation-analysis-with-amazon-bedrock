import type { ReactElement } from 'react';
import {
  buildBrandTrends, buildLatestBrands, buildSources
} from '../layout/reportPayload-fixtures';
import { BrandTrendChart } from './BrandTrendChart';
import { EngineKpiChart } from './EngineKpiChart';
import { KpiTrendChart } from './KpiTrendChart';
import { SentimentSplitChart } from './SentimentSplitChart';
import { ShareOfVoiceChart } from './ShareOfVoiceChart';
import { TopSourcesChart } from './TopSourcesChart';
import {
  ENGINES, KPI_POINTS, LEADERBOARD, SENTIMENT_ROWS, brandTrendChart, engineKpiChart, kpiTrendChart, sentimentChart, shareOfVoiceChart,
  topSourcesChart
} from './charts-fixtures';

type ChartElement = () => ReactElement;

/** A chart with data: its name, the element, the Chart.js type it draws and its caption. */
export type DrawnChartCase = readonly [string, ChartElement, string, string];

/** Every chart component given the fixture data. */
export const DRAWN_CHARTS: readonly DrawnChartCase[] = [
  [
    'KpiTrendChart',
    () => <KpiTrendChart points={KPI_POINTS} />,
    'line',
    'Mention rate, Share of voice, Visibility score and Citation rate over 2 periods from 2026-09-01 to 2026-09-08, on a 0–100 scale. '
      + 'Latest (2026-09-08): Mention rate 60.0%, Share of voice 25.0%, Visibility score 52.4, Citation rate —.',
  ],
  [
    'ShareOfVoiceChart',
    () => <ShareOfVoiceChart brands={buildLatestBrands()} limit={2} />,
    'doughnut',
    'Share of voice: Nike 25.0%, Adidas 20.8% and Other brands 12.5%.',
  ],
  [
    'EngineKpiChart',
    () => <EngineKpiChart engines={ENGINES.slice(0, 1)} ids={['mention_rate']} />,
    'bar',
    'Mention rate per AI engine, on a 0–100 scale. Google Gemini: Mention rate 70.0%.',
  ],
  [
    'BrandTrendChart',
    () => <BrandTrendChart trends={buildBrandTrends()} metric="share_of_voice" trackedLabel="Nike" />,
    'line',
    'Share of voice of Nike, Adidas and Puma over 2 periods from 2026-09-01 to 2026-09-08, on a 0–100 scale. '
      + 'Latest (2026-09-08): Nike 25.0%, Adidas 20.8%, Puma 12.5%.',
  ],
  [
    'SentimentSplitChart',
    () => <SentimentSplitChart rows={SENTIMENT_ROWS} />,
    'bar',
    'Sentiment of the labelled mentions per row, stacked to 100%. '
      + 'Nike: 41.7% positive, 33.3% neutral, 16.7% mixed, 8.3% negative of 12 labelled mentions. Puma: no labelled mention.',
  ],
  [
    'TopSourcesChart',
    () => <TopSourcesChart sources={buildSources()} limit={2} />,
    'bar',
    'Answers citing each of the 2 most cited domains: runnersworld.com 9 and nike.com 6 (yours).',
  ],
];

/** Every chart component with nothing to draw, and the sentence it shows instead. */
export const EMPTY_CHARTS: ReadonlyArray<readonly [string, ChartElement, string]> = [
  ['KpiTrendChart', () => <KpiTrendChart points={[]} />, 'No KPI history to chart yet.'],
  ['ShareOfVoiceChart', () => <ShareOfVoiceChart brands={[]} />, 'No brand has a share of voice yet.'],
  ['EngineKpiChart', () => <EngineKpiChart engines={[]} />, 'No AI engine answered yet.'],
  [
    'BrandTrendChart',
    () => (
      <BrandTrendChart
        trends={{
          tracked: [],
          competitors: [],
        }}
        metric="mention_rate"
      />
    ),
    'No brand history to chart yet.',
  ],
  ['SentimentSplitChart', () => <SentimentSplitChart rows={[]} />, 'No sentiment to chart yet.'],
  ['TopSourcesChart', () => <TopSourcesChart sources={[]} />, 'No cited domain yet.'],
];


/**
 * A chart rendered with some props, then with others: its name, both elements and a builder of the
 * Chart.js data of the second (called inside the test, where a mutant is active).
 */
export type RedrawnChartCase = readonly [string, ChartElement, ChartElement, () => unknown];

/** Every chart component re-rendered with different data, and the chart data it must redraw. */
export const REDRAWN_CHARTS: readonly RedrawnChartCase[] = [
  [
    'KpiTrendChart',
    () => <KpiTrendChart points={KPI_POINTS} />,
    () => <KpiTrendChart points={KPI_POINTS.slice(0, 1)} />,
    () => kpiTrendChart(KPI_POINTS.slice(0, 1)).data,
  ],
  [
    'ShareOfVoiceChart',
    () => <ShareOfVoiceChart brands={buildLatestBrands()} limit={6} />,
    () => <ShareOfVoiceChart brands={LEADERBOARD} limit={6} />,
    () => shareOfVoiceChart(LEADERBOARD, 6).data,
  ],
  [
    'EngineKpiChart',
    () => <EngineKpiChart engines={ENGINES.slice(0, 1)} />,
    () => <EngineKpiChart engines={ENGINES} />,
    () => engineKpiChart(ENGINES).data,
  ],
  [
    'BrandTrendChart',
    () => <BrandTrendChart trends={buildBrandTrends()} metric="share_of_voice" />,
    () => <BrandTrendChart trends={buildBrandTrends()} metric="mention_rate" />,
    () => brandTrendChart('mention_rate').data,
  ],
  [
    'SentimentSplitChart',
    () => <SentimentSplitChart rows={SENTIMENT_ROWS} />,
    () => <SentimentSplitChart rows={SENTIMENT_ROWS.slice(0, 1)} />,
    () => sentimentChart(SENTIMENT_ROWS.slice(0, 1)).data,
  ],
  [
    'TopSourcesChart',
    () => <TopSourcesChart sources={buildSources()} limit={2} />,
    () => <TopSourcesChart sources={buildSources()} limit={1} />,
    () => topSourcesChart(buildSources(), 1).data,
  ],
];
