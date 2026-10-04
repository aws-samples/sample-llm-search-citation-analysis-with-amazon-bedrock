import type { RecommendationsResponse } from '../../../../types';
import {
  PriorityBadge,
  ReportSection,
  ReportSectionNote,
  ReportSectionPlaceholder,
  pendingSectionPlaceholder,
  type SectionFetchState,
} from '../../layout';

interface Props extends SectionFetchState {
  readonly recommendations: RecommendationsResponse | null;
  readonly keyword: string;
}

const TITLE = 'Recommended actions';

const PRIORITY_ORDER = {
  high: 0,
  medium: 1,
  low: 2 
} as const;

/**
 * The Recommendations endpoint generates *global* recommendations across all
 * tracked keywords. We filter client-side to the recommendations whose
 * `keywords` array references the report's current keyword, so this section
 * stays scoped to the page it lives on. Configuration / data-quality
 * recommendations (no `keywords` array) are kept because they apply
 * regardless of which keyword the user is reading about.
 */
export function RecommendationsSection({
  recommendations, keyword, loading, error,
}: Props) {
  const pending = pendingSectionPlaceholder({
    title: TITLE,
    loading,
    loadingMessage: 'Loading recommendations…',
    error,
  });
  if (pending) return pending;

  if (!recommendations || recommendations.recommendations.length === 0) {
    return (
      <ReportSectionPlaceholder
        title={TITLE}
        variant="empty"
        message="No recommendations generated yet. Run an analysis or wait for the next scheduled run."
      />
    );
  }

  const relevant = recommendations.recommendations
    .filter((rec) => {
      // No keywords array => global recommendation, always include.
      if (!rec.keywords || rec.keywords.length === 0) return true;
      // Match against the report's keyword. The Recommendations endpoint
      // sometimes annotates entries with "keyword (rank N)" so we use a
      // substring match on a lowercased copy.
      const lowerKeyword = keyword.toLowerCase();
      return rec.keywords.some((entry) =>
        entry.toLowerCase().includes(lowerKeyword),
      );
    })
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
    );

  if (relevant.length === 0) {
    return (
      <ReportSectionNote
        title={TITLE}
        subtitle="No keyword-specific recommendations from the latest analysis."
      >
        The Action Center has{' '}
        <span className="font-medium">{recommendations.total_count}</span>{' '}
        recommendations across all keywords, but none reference{' '}
        <span className="font-medium">{keyword}</span> specifically.
      </ReportSectionNote>
    );
  }

  return (
    <ReportSection
      title={TITLE}
      subtitle="What to do next, sorted by priority. Pulled from the Action Center; filtered to this keyword."
    >
      <ol className="space-y-3">
        {relevant.map((rec) => (
          <li
            key={`${rec.title}::${rec.action}`}
            className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800"
          >
            <div className="flex items-start gap-3">
              <PriorityBadge priority={rec.priority} />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {rec.title}
                </h3>
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                  {rec.description}
                </p>
                <p className="text-sm text-gray-900 dark:text-white mt-2">
                  <span className="font-medium">Action: </span>
                  {rec.action}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Expected impact: {rec.impact}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </ReportSection>
  );
}
