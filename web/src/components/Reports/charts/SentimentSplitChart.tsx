import { useMemo } from 'react';
import { useThemedChart } from '../../Dashboard/useThemedChart';
import { ChartFigure } from './ChartFigure';
import {
  buildSentimentSplitChartConfiguration, describeSentimentSplit, sentimentSeries, type SentimentRow
} from './sentimentSplitChartConfiguration';

interface Props {
  /** One bar per row, top to bottom; labels must be distinct. */
  readonly rows: readonly SentimentRow[];
}

/** How the labelled mentions of each row split into positive, neutral, mixed and negative, stacked to 100%. */
export function SentimentSplitChart({ rows }: Props) {
  const series = useMemo(() => sentimentSeries(rows), [rows]);
  const {
    canvasRef, hasData
  } = useThemedChart(series, buildSentimentSplitChartConfiguration);

  return (
    <ChartFigure
      canvasRef={canvasRef}
      hasData={hasData}
      caption={describeSentimentSplit(rows)}
      emptyText="No sentiment to chart yet."
      heightClassName="h-64"
    />
  );
}
