import {
  PriorityBadge, ReportSection, SectionPlaceholder
} from '../layout';
import {
  gateInsights, type InsightsSectionProps
} from './InsightsTableSection';
import { insightSentence } from './insightWording';

export const INSIGHTS_SUMMARY_TITLE = 'Top insights';

/** What the section says when the scope raises no insight. */
export const INSIGHTS_SUMMARY_EMPTY = 'No insight for this scope yet.';

/** How many insights the section reads out, most severe first. */
export const TOP_INSIGHTS = 6;

/** The scope's most pressing insights in the API order (severity, then the answers or mentions behind each), each with its severity. */
export function InsightsSummarySection(slice: InsightsSectionProps) {
  const gate = gateInsights(INSIGHTS_SUMMARY_TITLE, slice);
  if (!gate.ready) return gate.placeholder;

  const top = gate.value.insights.slice(0, TOP_INSIGHTS);
  return (
    <ReportSection
      title={INSIGHTS_SUMMARY_TITLE}
      subtitle="The most pressing findings of the latest runs, most severe first; the insight blocks show the figures behind each."
    >
      {top.length === 0
        ? <SectionPlaceholder variant="empty" message={INSIGHTS_SUMMARY_EMPTY} />
        : (
          <ul className="space-y-2">
            {top.map((insight) => (
              <li key={insight.id} className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
                <PriorityBadge priority={insight.severity} />
                <span>{insightSentence(insight)}</span>
              </li>
            ))}
          </ul>
        )}
    </ReportSection>
  );
}
