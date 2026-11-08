import { useMemo } from 'react';
import type { TrafficShareEntry } from '../../../types/api/seo';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from './ChartFigure';
import {
  buildTrafficShareChartConfiguration, describeTrafficShares, trafficShareSeries
} from './seoGeoTrafficChartConfiguration';

interface Props {readonly entries: readonly TrafficShareEntry[];}

/** Share of estimated search traffic (indigo) against share of AI mentions (amber), per brand. */
export function SeoGeoTrafficChart({ entries }: Props) {
  const series = useMemo(() => trafficShareSeries(entries), [entries]);
  const {
    canvasRef, hasData
  } = useThemedChart(series, buildTrafficShareChartConfiguration);

  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeTrafficShares(series)}
      emptyText="No estimated traffic snapshot of your or your competitors' domains in this market yet."
    />
  );
}
