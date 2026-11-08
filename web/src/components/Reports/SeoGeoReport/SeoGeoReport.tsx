import {
  useNavigate, useSearchParams
} from 'react-router-dom';
import { useSeoGeo } from '../../../hooks/useSeoGeo';
import {
  useSeoGeoInsights, type SeoGeoInsightsState
} from '../../../hooks/useSeoGeoInsights';
import { useKeywordGroups } from '../../../hooks/useKeywordGroups';
import { usePrintMode } from '../../../hooks/usePrintMode';
import type { ReportScope } from '../../../types';
import { SEO_GEO_DEFINITIONS } from '../../../constants/seoGeoDefinitions';
import {
  MARKET_SEARCH_PARAM, marketName
} from '../../Markets/marketSelection';
import { useMarketSelection } from '../../Markets/marketSelectionContext';
import { describeReportScope } from '../../ui/reportScope';
import {
  KpiDefinitionsSection, ReportLayout, ReportSectionPlaceholder
} from '../layout';
import { GroupScopeSelector } from '../layout/GroupScopeSelector';
import {
  reportPathWithQuery, scopeFromSearch
} from '../scopeReport/scopeReportRoute';
import { SeoGeoChartSection } from './sections/SeoGeoChartSection';
import { SeoGeoQuadrantSection } from './sections/SeoGeoQuadrantSection';
import { SeoGeoTableSection } from './sections/SeoGeoTableSection';
import { SeoGeoTrafficSection } from './sections/SeoGeoTrafficSection';
import { SeoRecommendationsSection } from './sections/SeoRecommendationsSection';
import {
  SEO_NOT_DEPLOYED_MESSAGE, type SeoGeoSectionProps
} from './sections/seoGeoGate';

const SEO_GEO_PATH = '/reports/seo-geo';

/**
 * Which keywords the comparison covers: Google results are per country, so it reads one market at a time. With
 * every market combined that is the keywords without a market, and the header names the market to pick for the
 * others.
 */
export function seoGeoMarketNote(marketLabel: string | null): string {
  return marketLabel === null
    ? 'Keywords without a market; pick a market in the header for its keywords (Google results are per country).'
    : `Keywords of ${marketLabel}.`;
}

/** `/reports/seo-geo`, `?group=<id>` for a keyword group, the market a shared link names kept. */
function seoGeoReportPath(scope: ReportScope, market: string | null): string {
  const search = new URLSearchParams();
  if (scope.kind === 'group') search.set('group', scope.groupId);
  return reportPathWithQuery(SEO_GEO_PATH, search, market);
}

interface SeoGeoSectionsProps extends SeoGeoSectionProps {readonly insights: SeoGeoInsightsState;}

/** The sections in order; one notice in their place when the SEO stack is not deployed. */
function SeoGeoSections({
  state, insights, exportScope
}: SeoGeoSectionsProps) {
  if (state.notConfigured) {
    return <ReportSectionPlaceholder title="SEO vs GEO" variant="empty" message={SEO_NOT_DEPLOYED_MESSAGE} />;
  }
  return (
    <>
      <SeoGeoQuadrantSection state={state} />
      <SeoGeoChartSection state={state} />
      <SeoGeoTrafficSection state={state} exportScope={exportScope} />
      <SeoRecommendationsSection insights={insights} />
      <SeoGeoTableSection state={state} exportScope={exportScope} />
    </>
  );
}

/**
 * SEO vs GEO (`/reports/seo-geo`): per keyword of the header market (and of
 * one keyword group, `?group=<id>`), the organic Google position from the
 * Google AI Overviews results page against the AI mention rate, as quadrant
 * counts, a scatter, the share of estimated search traffic against the share
 * of AI mentions, the SEO recommendations and the full table. Reads
 * `GET /api/seo/seo-geo` and `GET /api/seo/insights`, which make no
 * DataForSEO call. Printing waits until both settled.
 */
export function SeoGeoReport() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // The comparison has no per-keyword form, so only `?group=` narrows it.
  const scope = scopeFromSearch(searchParams, null);
  const groupId = scope.kind === 'group' ? scope.groupId : null;
  const state = useSeoGeo(groupId);
  const insights = useSeoGeoInsights(groupId);
  const { groups } = useKeywordGroups();
  const market = searchParams.get(MARKET_SEARCH_PARAM);
  const scopeLabel = describeReportScope(scope, groups);
  const {
    selectedMarketId, catalog
  } = useMarketSelection();
  const marketLabel = selectedMarketId === null ? null : marketName(selectedMarketId, catalog.markets);

  usePrintMode({ ready: state.ready && !insights.loading });

  return (
    <ReportLayout
      title="SEO vs GEO"
      subtitle={`Google organic position against AI answer visibility for "${scopeLabel}": where search standing and AI mentions agree, and where they do not. ${seoGeoMarketNote(marketLabel)}`}
      actions={<GroupScopeSelector groups={groups} value={scope} onChange={(next) => navigate(seoGeoReportPath(next, market))} />}
    >
      <SeoGeoSections state={state} insights={insights} exportScope={{
        ...(selectedMarketId === null ? {} : { market_id: selectedMarketId }),
        ...(groupId === null ? {} : { group_id: groupId }),
      }} />
      <KpiDefinitionsSection definitions={SEO_GEO_DEFINITIONS} />
    </ReportLayout>
  );
}
