import type { ReactNode } from 'react';
import type {
  HistoricalTrendsResponse, VisibilityResponse
} from '../../../types';
import { ReportSection } from '../layout/ReportSection';
import { ReportSectionPlaceholder } from '../layout/ReportSectionPlaceholder';
import { ReportStatGrid } from '../layout/ReportStatGrid';
import { latestRunsSubtitle } from './KpiChangeCard';
import {
  gateLatestRuns, gateTrend
} from './scopeSectionGate';
import type { ScopeReportData } from './useScopeReportData';

interface LatestRunSectionProps {
  readonly report: ScopeReportData;
  readonly title: string;
  readonly subtitle: string;
  /** Why the section has nothing to show although the scope has runs (no brand named, no source cited); `null` when it has. */
  readonly emptyMessage?: (visibility: VisibilityResponse) => string | null;
  readonly children: (visibility: VisibilityResponse) => ReactNode;
}

/**
 * A section drawn from the latest runs (`/visibility`): its loading, error
 * and empty placeholders, then its heading around `children`.
 */
export function LatestRunSection({
  report, title, subtitle, emptyMessage, children
}: LatestRunSectionProps) {
  const gate = gateLatestRuns(report, title);
  if (!gate.ready) return gate.placeholder;

  const empty = emptyMessage?.(gate.value) ?? null;
  if (empty !== null) return <ReportSectionPlaceholder title={title} variant="empty" message={empty} />;
  return (
    <ReportSection title={title} subtitle={subtitle}>
      {children(gate.value)}
    </ReportSection>
  );
}

interface TrendSectionProps {
  readonly report: ScopeReportData;
  readonly title: string;
  readonly subtitle: string;
  readonly children: (trends: HistoricalTrendsResponse) => ReactNode;
}

/** A section drawn from the trend (`/trends`): its loading, error and empty placeholders, then its heading around `children`. */
export function TrendSection({
  report, title, subtitle, children
}: TrendSectionProps) {
  const gate = gateTrend(report, title);
  if (!gate.ready) return gate.placeholder;

  return (
    <ReportSection title={title} subtitle={subtitle}>
      {children(gate.value)}
    </ReportSection>
  );
}

interface HeadlineProps {
  readonly report: ScopeReportData;
  /** The four headline cards, left to right. */
  readonly cards: (visibility: VisibilityResponse) => ReactNode;
  /** Shown under the cards. */
  readonly children?: ReactNode;
}

/** The "Headline" section of a scope report: four cards over the latest runs, saying which runs they cover. */
export function LatestRunHeadline({
  report, cards, children
}: HeadlineProps) {
  const gate = gateLatestRuns(report, 'Headline');
  if (!gate.ready) return gate.placeholder;

  return (
    <ReportSection title="Headline" subtitle={latestRunsSubtitle(gate.value)}>
      <ReportStatGrid columns={4}>{cards(gate.value)}</ReportStatGrid>
      {children}
    </ReportSection>
  );
}
