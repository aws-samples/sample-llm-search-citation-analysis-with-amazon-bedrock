import { useMemo } from 'react';
import type { BrandKpis } from '../../../types/domain/groupKpiHistory';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import type { ChartKpiId } from './chartKpis';
import { ChartFigure } from './ChartFigure';
import {
  buildKpiTrendChartConfiguration, DEFAULT_KPI_TREND_IDS, describeKpiTrend, kpiTrendSeries
} from './kpiTrendChartConfiguration';

interface Props {
  /** The periods (or runs), oldest first, each labelled as the x axis should read. */
  readonly points: ReadonlyArray<{
    readonly label: string;
    readonly kpis: BrandKpis;
  }>;
  /** The KPIs to draw, percentages and scores only; pass a stable array (a new one redraws the chart). */
  readonly ids?: readonly ChartKpiId[];
}

/** The tracked brand's KPIs over time, one line per KPI on a 0–100 axis. */
export function KpiTrendChart({
  points, ids = DEFAULT_KPI_TREND_IDS
}: Props) {
  const series = useMemo(() => kpiTrendSeries(points, ids), [points, ids]);
  const {
    canvasRef, hasData
  } = useThemedChart(series, buildKpiTrendChartConfiguration);

  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeKpiTrend(series)}
      emptyText="No KPI history to chart yet."
    />
  );
}
