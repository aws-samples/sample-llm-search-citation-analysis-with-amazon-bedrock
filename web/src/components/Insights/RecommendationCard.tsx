import {
  useId, type JSX, type ReactNode
} from 'react';
import type { Recommendation } from '../../types';
import {
  EyeIcon, CogIcon
} from '../ui';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  BOLT_PATHS, CHART_BAR_PATHS, CHEVRON_DOWN_PATHS, LIGHTBULB_PATHS, LINK_PATHS, SEARCH_PATHS, SORT_ASCENDING_PATHS, SPARKLES_PATHS
} from '../ui/iconPaths';

/** Done and won't-fix items stay listed but step back visually. */
function isSettled(rec: Recommendation): boolean {
  return rec.status === 'done' || rec.status === 'wontfix';
}

const getPriorityColor = (priority: string): string => {
  const colors: Record<string, string> = {
    high: 'bg-red-500',
    medium: 'bg-yellow-500',
    low: 'bg-green-500',
  };
  return colors[priority] ?? 'bg-green-500';
};

const PRIORITY_LABELS: Record<string, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
};

const RankingIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={SORT_ASCENDING_PATHS} />
);

const ProviderGapIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={LINK_PATHS} />
);

const CompetitiveIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={BOLT_PATHS} />
);

const DataIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={CHART_BAR_PATHS} />
);

const BestPracticeIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={SPARKLES_PATHS} />
);

const SearchResultsIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={SEARCH_PATHS} />
);

const DefaultIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={LIGHTBULB_PATHS} />
);

const getTypeIcon = (type: string): JSX.Element => {
  const icons: Record<string, JSX.Element> = {
    visibility_gap: <EyeIcon />,
    ranking: <RankingIcon />,
    provider_gap: <ProviderGapIcon />,
    competitive: <CompetitiveIcon />,
    configuration: <CogIcon />,
    data: <DataIcon />,
    best_practice: <BestPracticeIcon />,
    aio_missing_you: <SearchResultsIcon />,
    aio_competitor_cited: <SearchResultsIcon />,
    seo_gap: <SearchResultsIcon />,
    ai_gap: <SearchResultsIcon />,
  };
  return icons[type] ?? <DefaultIcon />;
};

const ExpandedContent = ({ rec }: { rec: Recommendation }) => (
  <div className="mt-4 space-y-3 animate-in fade-in duration-200">
    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
      <div className="text-xs text-gray-500 font-medium mb-1">Action</div>
      <div className="text-sm text-gray-700">{rec.action}</div>
    </div>

    <div className="text-xs text-gray-500">
      <span className="font-medium">Impact:</span> {rec.impact}
    </div>

    {rec.keywords && rec.keywords.length > 0 && (
      <div className="flex flex-wrap gap-1">
        {rec.keywords.map(kw => (
          <span key={kw} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-sm text-xs">
            {kw}
          </span>
        ))}
      </div>
    )}
  </div>
);

/** Marks a recommendation drawn from Google organic data rather than from the AI answers. */
const SeoSourceBadge = () => (
  <span className="px-1.5 py-0.5 rounded-sm bg-gray-50 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300 text-xs font-semibold" title="From Google organic (SEO) data">
    SEO
  </span>
);

interface RecommendationCardProps {
  rec: Recommendation;
  isExpanded: boolean;
  onClick: () => void;
  statusControl?: ReactNode;
  /** Shows the "SEO" source badge. */
  fromSeo?: boolean;
}

/**
 * A rule-based or AI recommendation. The title is the keyboard and screen-reader
 * toggle; a mouse click anywhere else on the card toggles it too, while the status
 * control stops its own clicks.
 */
export const RecommendationCard = ({
  rec, isExpanded, onClick, statusControl, fromSeo = false
}: RecommendationCardProps) => {
  const detailsId = useId();
  return (
    <div
      className={`bg-white rounded-lg shadow-sm border border-gray-200 cursor-pointer transition-all hover:shadow-md ${isExpanded ? 'ring-2 ring-gray-300' : ''} ${isSettled(rec) ? 'opacity-60' : ''}`}
      onClick={onClick}
    >
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="text-gray-500 mt-0.5" aria-hidden="true">{getTypeIcon(rec.type)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start gap-3 mb-2">
              <h4 className="font-semibold text-gray-900 flex items-center gap-2 min-w-0 break-words">
                {fromSeo && <SeoSourceBadge />}
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={detailsId}
                  onClick={(event) => { event.stopPropagation(); onClick(); }}
                  className="text-left rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500"
                >
                  {rec.title}
                </button>
              </h4>
              <div className="flex items-center gap-2 shrink-0">
                {statusControl}
                <span title={PRIORITY_LABELS[rec.priority] ?? PRIORITY_LABELS.low} className="inline-flex">
                  <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full ${getPriorityColor(rec.priority)}`} />
                  <span className="sr-only">{PRIORITY_LABELS[rec.priority] ?? PRIORITY_LABELS.low}</span>
                </span>
                <StrokeIcon className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} paths={CHEVRON_DOWN_PATHS} aria-hidden="true" />
              </div>
            </div>

            <p className="text-gray-600 text-sm">{rec.description}</p>

            <div id={detailsId}>
              {isExpanded && <ExpandedContent rec={rec} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
