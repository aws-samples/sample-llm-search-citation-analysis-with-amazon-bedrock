import type { SeoGeoInsightsState } from '../../../../hooks/useSeoGeoInsights';
import type { SeoRecommendation } from '../../../../types/api/seoDomains';
import { RecommendationStatusSelect } from '../../../Insights/RecommendationStatusSelect';
import {
  gateSection, PriorityBadge, ReportSection, ReportSectionPlaceholder
} from '../../layout';
import { SEO_NOT_DEPLOYED_MESSAGE } from './seoGeoGate';

const TITLE = 'SEO recommendations';
const EMPTY_MESSAGE = 'No gap between your Google standing and the AI answers in this scope: nothing to recommend yet.';

interface Props {readonly insights: SeoGeoInsightsState;}

interface CardProps {
  readonly recommendation: SeoRecommendation;
  readonly insights: SeoGeoInsightsState;
}

function RecommendationCard({
  recommendation, insights
}: CardProps) {
  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
      <div className="flex items-start gap-3">
        <PriorityBadge priority={recommendation.priority} />
        <h4 className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{recommendation.title}</h4>
        <RecommendationStatusSelect
          recommendation={recommendation}
          updating={insights.updatingIds.includes(recommendation.id)}
          onChange={(_item, status) => { void insights.updateStatus(recommendation, status); }}
        />
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300">{recommendation.description}</p>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        <span className="font-medium">Action: </span>
        {recommendation.action}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {recommendation.keywords.join(', ')}
        {' · '}
        {recommendation.impact}
      </p>
    </li>
  );
}

/** Where Google standing and AI answers disagree, with the Action Center status of each recommendation. */
export function SeoRecommendationsSection({ insights }: Props) {
  if (insights.notConfigured) {
    return <ReportSectionPlaceholder title={TITLE} variant="empty" message={SEO_NOT_DEPLOYED_MESSAGE} />;
  }
  const gate = gateSection({
    title: TITLE,
    loading: insights.loading,
    error: insights.error,
    loadingMessage: 'Loading the SEO recommendations…',
    value: insights.recommendations.length > 0 ? insights.recommendations : null,
    emptyMessage: EMPTY_MESSAGE,
  });
  if (!gate.ready) return gate.placeholder;
  return (
    <ReportSection title={TITLE} subtitle="Tracked in the Action Center: a status set here shows there too.">
      {insights.statusError !== null && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">{`Status not saved: ${insights.statusError}`}</p>
      )}
      <ul className="space-y-3">
        {gate.value.map((recommendation) => (
          <RecommendationCard key={recommendation.id} recommendation={recommendation} insights={insights} />
        ))}
      </ul>
    </ReportSection>
  );
}
