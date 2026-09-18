import type { ReportsOverviewResponse } from '../../../../api/reports';
import type { Recommendation } from '../../../../types';
import {
  PriorityBadge,
  ReportSection,
  ReportSectionPlaceholder,
  pendingSectionPlaceholder,
} from '../../layout';

interface Props {
  readonly data: ReportsOverviewResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The "what to do next" panel — the report's call to action. Top three
 * rule-based recommendations from the aggregator, with priority,
 * description, expected action, and impact in a card layout that
 * survives print pagination thanks to `avoid-break-inside`.
 */
export function NextActionsSection({
  data, loading, error 
}: Props) {
  const pending = pendingSectionPlaceholder({
    title: 'Next actions',
    loading,
    loadingMessage: 'Loading recommendations…',
    error,
  });
  if (pending) return pending;

  if (!data || data.top_recommendations.length === 0) {
    return (
      <ReportSectionPlaceholder
        title="Next actions"
        variant="empty"
        message="No outstanding recommendations. The visibility plan is on track."
      />
    );
  }

  return (
    <ReportSection
      title="Next actions"
      subtitle="Top three recommendations from the analysis engine, ordered by priority."
      startNewPage
    >
      <ol className="space-y-3 list-decimal list-inside">
        {data.top_recommendations.map((rec) => (
          <RecommendationCard key={`${rec.title}::${rec.action}`} rec={rec} />
        ))}
      </ol>
    </ReportSection>
  );
}

function RecommendationCard({ rec }: { readonly rec: Recommendation }) {
  return (
    <li className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 avoid-break-inside">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {rec.title}
        </h3>
        <PriorityBadge priority={rec.priority} />
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300">{rec.description}</p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <p className="font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Action
          </p>
          <p className="text-gray-700 dark:text-gray-300 mt-1">{rec.action}</p>
        </div>
        <div>
          <p className="font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Expected impact
          </p>
          <p className="text-gray-700 dark:text-gray-300 mt-1">{rec.impact}</p>
        </div>
      </div>
    </li>
  );
}
