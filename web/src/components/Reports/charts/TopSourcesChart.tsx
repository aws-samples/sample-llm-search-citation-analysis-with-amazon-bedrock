import { useMemo } from 'react';
import type { SourceRow } from '../../../types/domain/visibility';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from './ChartFigure';
import {
  buildTopSourcesChartConfiguration, DEFAULT_TOP_SOURCES_LIMIT, describeTopSources, topSources
} from './topSourcesChartConfiguration';

interface Props {readonly sources: readonly SourceRow[];}

/** The most cited domains by answers citing them, your owned domains in emerald. */
export function TopSourcesChart({ sources }: Props) {
  const bars = useMemo(() => topSources(sources, DEFAULT_TOP_SOURCES_LIMIT), [sources]);
  const {
    canvasRef, hasData
  } = useThemedChart(bars, buildTopSourcesChartConfiguration);

  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeTopSources(bars)}
      emptyText="No cited domain yet."
      heightClassName="h-80"
    />
  );
}
