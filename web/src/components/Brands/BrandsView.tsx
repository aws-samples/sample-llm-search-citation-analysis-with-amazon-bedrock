import { useState } from 'react';
import { useBrandMentions } from '../../hooks/useBrandMentions';
import { useBrandConfig } from '../../hooks/useBrandConfig';
import { PagedBrandMentionsTable } from './PagedBrandMentionsTable';
import { BrandDetailModal } from './BrandDetailModal';
import { BrandConfigPanel } from './BrandConfigPanel';
import {
  countTrackedBrands, describeIndustry
} from './brandConfigSummary';
import { BrandMentionsSkeleton } from './BrandMentionsSkeleton';
import { ComputingState } from '../ui/ComputingState';
import { ScopeCoverageNote } from '../ui/ScopeCoverageNote';
import type { ComputingResponse } from '../../types/domain/scopeCoverage';
import {
  AnalysisRunContext, BrandReportControls, ClassificationFilter, getFilterCounts, Header, ScopePanel
} from './BrandsPageControls';
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
import type { ListRequest } from '../../api/scopedListPages';

interface BrandsViewProps {keywords: Keyword[];}

const BrandContent = ({
  data, loading, error, computing, noData, request, appearancesRequest, scopeLabel, classificationFilter, selectedTimestamp,
  onFilterChange, onTimestampChange, onBrandClick
}: {
  data: BrandMentionsResponse | null;
  loading: boolean;
  error: string | null;
  /** The view job of a `202` answer (an older run of a large scope, 2.45.0). */
  computing: ComputingResponse | null;
  /** The GET `data` answered: the brand list's next pages repeat it. */
  request: ListRequest | null;
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
  // A view job (an older run of a large scope) replaces the figures of the previous choice.
  if (loading && computing !== null) return <ComputingState subject="brand mentions" />;
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
        selectedTimestamp={selectedTimestamp}
        onTimestampChange={onTimestampChange}
      />
      <AnalysisRunContext data={data} scopeLabel={scopeLabel} selectedTimestamp={selectedTimestamp} />
      <ClassificationFilter
        filter={classificationFilter}
        onFilterChange={onFilterChange}
        counts={counts}
      />
      <ScopeCoverageNote response={data} />
      <PagedBrandMentionsTable data={data} request={request} keyword={data.keyword ?? scopeLabel} onBrandClick={onBrandClick} />
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
    data, loading, error, computing, request, noData
  } = useBrandMentions(activeScope, classificationFilter, selectedPersonaId, selectedTimestamp);
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
        loading={loading}
        error={error}
        computing={computing}
        noData={noData}
        request={request}
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
