import { useMemo } from 'react';
import type { TrendDataPoint } from '../../../types';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from '../charts/ChartFigure';
import {
  buildNetSentimentChartConfiguration, describeNetSentimentTrend, netSentimentSeries
} from './netSentimentChartConfiguration';

interface Props {
  /** The periods of a `/trends` series, oldest first. */
  readonly points: readonly TrendDataPoint[];
}

/** Your brand's net sentiment per period, from −100 (all negative) to +100 (all positive). */
export function NetSentimentTrendChart({ points }: Props) {
  const series = useMemo(() => netSentimentSeries(points), [points]);
  const {
    canvasRef, hasData
  } = useThemedChart(series, buildNetSentimentChartConfiguration);

  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeNetSentimentTrend(series)}
      emptyText="No net sentiment history to chart yet."
    />
  );
}
