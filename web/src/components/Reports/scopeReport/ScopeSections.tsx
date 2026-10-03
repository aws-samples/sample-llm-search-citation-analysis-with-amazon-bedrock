import type { ReactNode } from 'react';
import type {
  HistoricalTrendsResponse, VisibilityResponse
} from '../../../types';
import { ReportSection } from '../layout/ReportSection';
import { ReportSectionPlaceholder } from '../layout/ReportSectionPlaceholder';
import { ReportStatGrid } from '../layout/ReportStatGrid';
import type { SectionGate } from '../layout/sectionGate';
import { latestRunsSubtitle } from './KpiChangeCard';
import {
  gateLatestRuns, gateTrend
} from './scopeSectionGate';
import type { ScopeReportData } from './useScopeReportData';

interface SectionFrameProps<T> {
  readonly title: string;
  readonly subtitle: string;
  /** Why the section has nothing to show although its payload arrived; `null` when it has. */
  readonly emptyMessage?: (value: T) => string | null;
  readonly children: (value: T) => ReactNode;
}

/** A gated section: its placeholder until the payload arrives, its empty state, then its heading around `children`. */
function GatedSection<T>({
  gate, title, subtitle, emptyMessage, children
}: SectionFrameProps<T> & { readonly gate: SectionGate<T> }) {
  if (!gate.ready) return gate.placeholder;

  const empty = emptyMessage?.(gate.value) ?? null;
  if (empty !== null) return <ReportSectionPlaceholder title={title} variant="empty" message={empty} />;
  return (
    <ReportSection title={title} subtitle={subtitle}>
      {children(gate.value)}
    </ReportSection>
  );
}

interface ScopeSectionFrameProps<T> extends SectionFrameProps<T> {readonly report: ScopeReportData;}

/**
 * A section drawn from the latest runs (`/visibility`): its loading, error
 * and empty placeholders (no brand named, no source cited), then its heading
 * around `children`.
 */
export function LatestRunSection({
  report, ...frame
}: ScopeSectionFrameProps<VisibilityResponse>) {
  return <GatedSection gate={gateLatestRuns(report, frame.title)} {...frame} />;
}

/** A section drawn from the trend (`/trends`): its loading, error and empty placeholders, then its heading around `children`. */
export function TrendSection({
  report, ...frame
}: Omit<ScopeSectionFrameProps<HistoricalTrendsResponse>, 'emptyMessage'>) {
  return <GatedSection gate={gateTrend(report, frame.title)} {...frame} />;
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
