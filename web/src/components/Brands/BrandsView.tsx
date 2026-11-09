import { useState } from 'react';
import { useBrandMentions } from '../../hooks/useBrandMentions';
import { useBrandConfig } from '../../hooks/useBrandConfig';
import type { ContinuedPages } from '../../hooks/useContinuedPages';
import { BrandMentionsTable } from './BrandMentionsTable';
import { BrandDetailModal } from './BrandDetailModal';
import { BrandConfigPanel } from './BrandConfigPanel';
import {
  countTrackedBrands, describeIndustry
} from './brandConfigSummary';
import { BrandMentionsSkeleton } from './BrandMentionsSkeleton';
import {
  AnalysisRunContext, BrandReportControls, ClassificationFilter, getFilterCounts, Header, ScopePanel
} from './BrandsPageControls';
import { useBrandSummaryPages } from './useBrandSummaryPages';
import { LoadOnScrollFooter } from '../ui/LoadOnScrollFooter';
import {
  ALL_SCOPE, describeReportScope
} from '../ui/reportScope';
import { useKeywordScopeOptions } from '../ui/useKeywordScopeOptions';
import type {
  Keyword, AggregatedBrand, BrandMentionsResponse, BrandConfig, ReportScope
} from '../../types';
import { NoDataYet } from '../ui/NoDataYet';
import { useSelectedMarketId } from '../Markets/marketSelectionContext';
import type { BrandAppearancesRequest } from '../../api/brandMentions';

interface BrandsViewProps {keywords: Keyword[];}

/** The end-of-list line; an API build without brand pages stops at its first 100 brands, and the line says so. */
function brandsDoneLabel(shown: number, matching: number): string {
  if (shown < matching) return `Showing the top ${shown.toLocaleString()} of ${matching.toLocaleString()} brands; the Excel export has every mention.`;
  return matching === 1 ? 'The only brand is shown.' : `All ${matching.toLocaleString()} brands are shown.`;
}

/** The end of the brands table: the next 100 brands load as the reader nears it. */
const BrandsFooter = ({
  pages, matching
}: {
  pages: ContinuedPages<AggregatedBrand>;
  matching: number;
}) => (
  <LoadOnScrollFooter
    onLoadMore={pages.loadMore}
    hasMore={pages.hasMore}
    loading={pages.loadingMore}
    failed={pages.failed}
    watch={pages.items.length}
    doneLabel={brandsDoneLabel(pages.items.length, matching)}
  />
);

const BrandContent = ({
  data, pages, loading, error, noData, appearancesRequest, scopeLabel, classificationFilter, selectedTimestamp,
  onFilterChange, onTimestampChange, onBrandClick
}: {
  data: BrandMentionsResponse | null;
  /** The summary's brands with every later page loaded so far. */
  pages: ContinuedPages<AggregatedBrand>;
  loading: boolean;
  error: string | null;
  noData: boolean;
  appearancesRequest: BrandAppearancesRequest | null;
  scopeLabel: string;
  classificationFilter: string | null;
  selectedTimestamp: string | null;
  onFilterChange: (filter: string | null) => void;
  onTimestampChange: (timestamp: string | null) => void;
  onBrandClick: (brand: AggregatedBrand) => void;
}) => {
  // The first answer gets a placeholder; a refetch (filter, run, persona)
  // keeps the previous results on screen, dimmed, so nothing collapses.
  if (loading && !data) return <BrandMentionsSkeleton />;
  // A keyword with no analysis run yet: what to do next, not a red error.
  if (noData) return <NoDataYet keyword={scopeLabel} />;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4"><p className="text-sm text-red-700">{error}</p></div>;
  // No keywords: the scope panel already says what to do.
  if (appearancesRequest === null) return null;
  if (!data) return null;

  const counts = getFilterCounts(data);

  return (
    <div aria-busy={loading} className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <BrandReportControls
        data={data}
        exportRequest={appearancesRequest}
        scopeLabel={scopeLabel}
        selectedTimestamp={selectedTimestamp}
        onTimestampChange={onTimestampChange}
      />
      <AnalysisRunContext data={data} scopeLabel={scopeLabel} selectedTimestamp={selectedTimestamp} />
      <ClassificationFilter
        filter={classificationFilter}
        onFilterChange={onFilterChange}
        counts={counts}
      />
      <BrandMentionsTable
        brands={pages.items}
        totalBrands={data.aggregated.matching_brands}
        moreToLoad={pages.hasMore}
        keyword={data.keyword ?? scopeLabel}
        singleKeyword={data.keyword !== null}
        onBrandClick={onBrandClick}
        footer={pages.items.length > 0 && !loading && <BrandsFooter pages={pages} matching={data.aggregated.matching_brands} />}
      />
    </div>
  );
};

const renderModals = (props: {
  selectedBrand: AggregatedBrand | null;
  data: BrandMentionsResponse | null;
  setSelectedBrand: (brand: AggregatedBrand | null) => void;
  showConfig: boolean;
  config: BrandConfig | null;
  presets: ReturnType<typeof useBrandConfig>['presets'];
  configLoading: boolean;
  saveConfig: ReturnType<typeof useBrandConfig>['saveConfig'];
  setShowConfig: (show: boolean) => void;
  expandAllBrands: ReturnType<typeof useBrandConfig>['expandAllBrands'];
  findCompetitors: ReturnType<typeof useBrandConfig>['findCompetitors'];
  selectedPersonaId: string | null;
  scopeLabel: string;
  appearancesRequest: BrandAppearancesRequest | null;
}) => (
  <>
    {props.selectedBrand && props.data && (
      <BrandDetailModal
        brand={props.selectedBrand}
        appearancesRequest={props.appearancesRequest}
        providerData={props.data.by_provider}
        keyword={props.data.keyword ?? props.scopeLabel}
        singleKeyword={props.data.keyword !== null}
        queryPromptId={props.selectedPersonaId}
        onClose={() => props.setSelectedBrand(null)}
      />
    )}
    {props.showConfig && (
      <BrandConfigPanel
        config={props.config}
        presets={props.presets}
        loading={props.configLoading}
        onSave={props.saveConfig}
        onClose={() => props.setShowConfig(false)}
        onExpandAllBrands={props.expandAllBrands}
        onFindCompetitors={props.findCompetitors}
      />
    )}
  </>
);

export const BrandsView = ({ keywords }: BrandsViewProps) => {
  const [scope, setScope] = useState<ReportScope>(ALL_SCOPE);
  const [selectedBrand, setSelectedBrand] = useState<AggregatedBrand | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [classificationFilter, setClassificationFilter] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState<string | null>(null);
  const {
    activeKeywords, groups
  } = useKeywordScopeOptions(keywords);
  // "All keywords" is the default, so the page shows totals on arrival; with
  // no keywords there is nothing to ask for.
  const activeScope = activeKeywords.length > 0 ? scope : null;
  const scopeLabel = describeReportScope(scope, groups);
  const marketId = useSelectedMarketId();
  const appearancesRequest: BrandAppearancesRequest | null = activeScope === null ? null : {
    scope: activeScope,
    marketId,
    filters: {
      classification: classificationFilter,
      query_prompt_id: selectedPersonaId,
      timestamp: selectedTimestamp,
    },
  };

  const {
    data, loading, error, noData
  } = useBrandMentions(activeScope, classificationFilter, selectedPersonaId, selectedTimestamp);
  const pages = useBrandSummaryPages(data, appearancesRequest, loading);
  const {
    config, presets, loading: configLoading, saveConfig, expandAllBrands, findCompetitors
  } = useBrandConfig();

  const handleScopeChange = (nextScope: ReportScope) => {
    setScope(nextScope);
    setSelectedTimestamp(null);
  };

  const handlePersonaChange = (personaId: string | null) => {
    setSelectedPersonaId(personaId);
    setSelectedTimestamp(null);
  };

  return (
    <div className="space-y-6">
      <Header
        industryName={describeIndustry(config, presets)}
        firstPartyCount={countTrackedBrands(config, 'first_party')}
        competitorCount={countTrackedBrands(config, 'competitors')}
        onConfigClick={() => setShowConfig(true)}
      />
      <ScopePanel
        keywords={activeKeywords}
        groups={groups}
        scope={scope}
        onChange={handleScopeChange}
        selectedPersonaId={selectedPersonaId}
        onPersonaChange={handlePersonaChange}
      />
      <BrandContent
        data={data}
        pages={pages}
        loading={loading}
        error={error}
        noData={noData}
        appearancesRequest={appearancesRequest}
        scopeLabel={scopeLabel}
        classificationFilter={classificationFilter}
        selectedTimestamp={selectedTimestamp}
        onFilterChange={setClassificationFilter}
        onTimestampChange={setSelectedTimestamp}
        onBrandClick={setSelectedBrand}
      />
      {renderModals({
        selectedBrand,
        data,
        setSelectedBrand,
        showConfig,
        config,
        presets,
        configLoading,
        saveConfig,
        setShowConfig,
        expandAllBrands,
        findCompetitors,
        selectedPersonaId,
        scopeLabel,
        appearancesRequest
      })}
    </div>
  );
};
