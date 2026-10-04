import { useMemo } from 'react';
import type {
  BrandLeaderboardRow, BrandTrends, TrendDataPoint
} from '../../../../types';
import { KPI_DEFINITIONS } from '../../../../constants/kpiDefinitions';
import {
  BrandTrendChart, ChartPanel, KpiTrendChart, ShareOfVoiceChart
} from '../../charts';

/**
 * The chart panels the reports share: the KPI trend of a `/trends` series,
 * the share-of-voice donut of a leaderboard and the share of voice per brand
 * over time. Each complements a table that keeps every figure in print, and
 * says what it draws in a visible subtitle, since tooltips do not print.
 */

export const KPI_TREND_TITLE = 'KPIs over time';
export const KPI_TREND_INFO = 'Mention rate, share of voice, visibility score and citation rate over every answer of each period, '
  + 'on a 0–100 scale. A period without answers is a gap in the line.';
export const SHARE_OF_VOICE_TITLE = 'Share of voice';
export const SHARE_OF_VOICE_TREND_TITLE = 'Share of voice over time';
const SHARE_OF_VOICE_TREND_SUBTITLE = 'Each brand\'s share of voice per period: your brand in the thick emerald line, '
  + 'its leading competitors in thinner lines. A period where no answer names a brand is a gap.';

interface PanelProps {readonly className?: string;}

/** The KPI trend chart of a `/trends` (or `/reports/overview`) series, one point per period labelled by it. */
export function TrendPeriodChart({ points }: { readonly points: readonly TrendDataPoint[] }) {
  const periods = useMemo(() => points.map((point) => ({
    label: point.period,
    kpis: point.kpis,
  })), [points]);
  return <KpiTrendChart points={periods} />;
}

/** The KPI trend chart in a titled panel, for the sections whose table lists the same periods. */
export function KpiTrendPanel({
  points, className
}: PanelProps & { readonly points: readonly TrendDataPoint[] }) {
  return (
    <ChartPanel title={KPI_TREND_TITLE} subtitle={KPI_TREND_INFO} className={className}>
      <TrendPeriodChart points={points} />
    </ChartPanel>
  );
}

/** The share-of-voice donut of a leaderboard in a titled panel. */
export function ShareOfVoicePanel({ brands }: { readonly brands: readonly BrandLeaderboardRow[] }) {
  return (
    <ChartPanel title={SHARE_OF_VOICE_TITLE} subtitle={KPI_DEFINITIONS.share_of_voice.definition}>
      <ShareOfVoiceChart brands={brands} />
    </ChartPanel>
  );
}

/** The share of voice of the tracked brand and its leading competitors per period, in a titled panel. */
export function ShareOfVoiceTrendPanel({ trends }: { readonly trends: BrandTrends }) {
  return (
    <ChartPanel title={SHARE_OF_VOICE_TREND_TITLE} subtitle={SHARE_OF_VOICE_TREND_SUBTITLE}>
      <BrandTrendChart trends={trends} metric="share_of_voice" />
    </ChartPanel>
  );
}
