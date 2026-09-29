import { useMemo } from 'react';
import type { BrandTrends } from '../../../types/domain/visibility';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from './ChartFigure';
import {
  brandTrendSeries, buildBrandTrendChartConfiguration, DEFAULT_TRACKED_LABEL, describeBrandTrend, type BrandTrendMetric
} from './brandTrendChartConfiguration';

interface Props {
  readonly trends: BrandTrends;
  readonly metric: BrandTrendMetric;
  /** The tracked brand's legend label. */
  readonly trackedLabel?: string;
}

/** The tracked brand against its leading competitors over time, one line per brand on a 0–100 axis. */
export function BrandTrendChart({
  trends, metric, trackedLabel = DEFAULT_TRACKED_LABEL
}: Props) {
  const series = useMemo(() => brandTrendSeries(trends, {
    metric,
    trackedLabel,
  }), [trends, metric, trackedLabel]);
  const {
    canvasRef, hasData
  } = useThemedChart(series, buildBrandTrendChartConfiguration);

  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeBrandTrend(series, metric)}
      emptyText="No brand history to chart yet."
    />
  );
}
