import {
  ReportSection,
  ReportStatCard,
  ReportStatGrid,
  pendingSectionPlaceholder,
} from '../../layout';
import type { ContentPlanSectionProps } from './ContentPlanSectionProps';

/**
 * Top-of-report summary: how many gaps the strategist needs to plan against,
 * how many briefs are already ready, and the coverage ratio. Sized so a
 * skimmer can lift the operational state in one glance — "we have 18 gaps
 * and 3 ready briefs, that's the headline".
 */
export function HeadlineSection({
  gaps,
  ideas,
  history,
  loading,
  error,
}: ContentPlanSectionProps) {
  const pending = pendingSectionPlaceholder({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading content plan…',
    error,
  });
  if (pending) return pending;

  const totalGaps = gaps?.total_gaps ?? gaps?.summary?.gap_count ?? 0;
  const highPriority = gaps?.total_high_priority
    ?? gaps?.summary?.high_priority_gaps
    ?? 0;
  const generatedBriefs = history.filter((h) => h.status === 'generated').length;
  const pendingIdeas = ideas.length;

  return (
    <ReportSection title="Headline">
      <ReportStatGrid columns={4}>
        <ReportStatCard
          label="Citation gaps"
          value={totalGaps}
          footnote="Sources citing competitors but not us"
        />
        <ReportStatCard
          label="High priority"
          value={highPriority}
          accent="negative"
          footnote="Cited by ≥2 providers, no first-party"
        />
        <ReportStatCard
          label="Briefs ready"
          value={generatedBriefs}
          accent="positive"
          footnote="Generated content awaiting publish"
        />
        <ReportStatCard
          label="Suggested topics"
          value={pendingIdeas}
          footnote="Open ideas from Content Studio"
        />
      </ReportStatGrid>
    </ReportSection>
  );
}
