import { useMemo } from 'react';
import type { EngineKpis } from '../../../types/domain/visibility';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from './ChartFigure';
import {
  buildEngineKpiChartConfiguration, DEFAULT_ENGINE_KPI_IDS, describeEngineKpis, engineKpiSeries
} from './engineKpiChartConfiguration';

interface Props {readonly engines: readonly EngineKpis[];}

/** The tracked brand's KPIs per AI engine, grouped bars on a 0–100 axis. */
export function EngineKpiChart({ engines }: Props) {
  const series = useMemo(() => engineKpiSeries(engines, DEFAULT_ENGINE_KPI_IDS), [engines]);
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
