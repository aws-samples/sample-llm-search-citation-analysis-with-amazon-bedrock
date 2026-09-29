import { useMemo } from 'react';
import type { EngineKpis } from '../../../types/domain/visibility';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import type { ChartKpiId } from './chartKpis';
import { ChartFigure } from './ChartFigure';
import {
  buildEngineKpiChartConfiguration, DEFAULT_ENGINE_KPI_IDS, describeEngineKpis, engineKpiSeries
} from './engineKpiChartConfiguration';

interface Props {
  readonly engines: readonly EngineKpis[];
  /** The KPIs to compare, percentages and scores only; pass a stable array (a new one redraws the chart). */
  readonly ids?: readonly ChartKpiId[];
}

/** The tracked brand's KPIs per AI engine, grouped bars on a 0–100 axis. */
export function EngineKpiChart({
  engines, ids = DEFAULT_ENGINE_KPI_IDS
}: Props) {
  const series = useMemo(() => engineKpiSeries(engines, ids), [engines, ids]);
  const {
    canvasRef, hasData
  } = useThemedChart(series, buildEngineKpiChartConfiguration);

  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeEngineKpis(series)}
      emptyText="No AI engine answered yet."
    />
  );
}
