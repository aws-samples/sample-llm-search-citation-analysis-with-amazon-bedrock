import { Link } from 'react-router-dom';
import { useReportInsights } from '../../hooks/useReportInsights';
import type { ReportScope } from '../../types';
import type {
  Insight, ReportInsightsResponse
} from '../../types/domain/insights';
import { NEW_CUSTOM_REPORT_PATH } from '../Reports/customReport/customReportRoute';
import { insightSentence } from '../Reports/insights/insightWording';
import { PriorityBadge } from '../Reports/layout';
import { OverviewPanel } from './OverviewPanel';

export const INSIGHTS_TITLE = 'Insights';
const INSIGHTS_INFO = 'The three most pressing findings about this scope: an AI engine that rarely ranks you first or rarely cites you, '
  + 'competitors\' sites cited more than yours, documents cited more than your pages, a competitor the answers criticise, '
  + 'a keyword every engine loses, one of your brands trailing the others, or a keyword whose position swings between runs. '
  + 'The custom reports show the detail behind each.';

/** What the panel says when the scope yields no insight. */
export const NO_INSIGHTS = 'No insights yet for this scope.';

/** How many insights the panel reads out. */
const TOP_INSIGHTS = 3;

interface Props {
  readonly scope: ReportScope;
  /** The window the run stability is measured over, in days. */
  readonly days: number;
}

function InsightItem({ insight }: { readonly insight: Insight }) {
  return (
    <li className="flex items-start gap-2 text-sm text-gray-700">
      <PriorityBadge priority={insight.severity} />
      <span>{insightSentence(insight)}</span>
    </li>
  );
}

interface BodyProps {
  readonly insights: ReportInsightsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

function SummaryBody({
  insights, loading, error
}: BodyProps) {
  if (loading) return <p className="text-sm text-gray-500">Loading insights…</p>;
  if (error !== null) return <p className="text-sm text-amber-800">{`Insights unavailable: ${error}`}</p>;
  if (insights === null || insights.insights.length === 0) return <p className="text-sm text-gray-500">{NO_INSIGHTS}</p>;
  return (
    <ul className="space-y-2">
      {insights.insights.slice(0, TOP_INSIGHTS).map((insight) => <InsightItem key={insight.id} insight={insight} />)}
    </ul>
  );
}

/**
 * The top three insights of the scope, most severe first, each with its
 * severity, and the way to the custom reports that show the detail behind
 * them.
 */
export function InsightsSummary({
  scope, days
}: Props) {
  const {
    data, loading, error
  } = useReportInsights(scope, days);
  return (
    <OverviewPanel
      title={INSIGHTS_TITLE}
      info={INSIGHTS_INFO}
      actions={(
        <Link to={NEW_CUSTOM_REPORT_PATH} className="text-sm font-medium text-gray-700 underline hover:text-gray-900">
          Open in reports
        </Link>
      )}
    >
      <SummaryBody insights={data} loading={loading} error={error} />
    </OverviewPanel>
  );
}
