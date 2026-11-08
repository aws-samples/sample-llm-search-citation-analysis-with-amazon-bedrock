import { useMemo } from 'react';
import type {
  RankDevice, RankHistory, RankTrendPoint
} from '../../../types/api/seoRankTracking';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from '../../Reports/charts/ChartFigure';
import {
  buildHistoryChartConfiguration, buildTrendChartConfiguration, describeTrend, type HistorySeries
} from './rankChartConfiguration';

/** One keyword's position over time per device (#1 on top; a miss drawn at the tracker's depth). */
export function RankHistoryChart({ history }: { readonly history: RankHistory }) {
  const series = useMemo<HistorySeries[]>(
    () => (history.points.length > 0 ? [{
      depth: history.depth,
      points: history.points,
    }] : []),
    [history],
  );
  const {
    canvasRef, hasData
  } = useThemedChart(series, buildHistoryChartConfiguration);
  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={`${history.points.length} checks of this keyword.`}
      emptyText="This keyword has not been checked yet."
      heightClassName="h-64"
    />
  );
}

/** Keywords per position bucket on each finished check, for one device. */
export function RankTrendChart({
  points, device
}: {
  readonly points: readonly RankTrendPoint[];
  readonly device: RankDevice 
}) {
  const deviceRuns = useMemo(() => points.filter((point) => point.device === device), [points, device]);
  const {
    canvasRef, hasData
  } = useThemedChart(deviceRuns, buildTrendChartConfiguration);
  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeTrend(deviceRuns)}
      emptyText="The position distribution appears after the first finished check."
      heightClassName="h-56"
    />
  );
}
