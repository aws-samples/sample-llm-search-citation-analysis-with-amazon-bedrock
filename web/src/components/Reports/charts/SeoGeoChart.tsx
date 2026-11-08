import { useMemo } from 'react';
import type { SeoGeoRow } from '../../../types/api/seo';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from './ChartFigure';
import {
  buildSeoGeoChartConfiguration, describeSeoGeoChart, seoGeoPoints
} from './seoGeoChartConfiguration';

interface Props {readonly rows: readonly SeoGeoRow[];}

/** Organic position against AI mention rate per keyword, the bubble sized by search volume. */
export function SeoGeoChart({ rows }: Props) {
  const points = useMemo(() => seoGeoPoints(rows), [rows]);
  const {
    canvasRef, hasData
  } = useThemedChart(points, buildSeoGeoChartConfiguration);

  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeSeoGeoChart(points)}
      emptyText="No keyword has both a Google result and AI answers yet."
      heightClassName="h-80"
    />
  );
}
