import type { ReactNode } from 'react';
import { PersonaSelector } from '../Personas/PersonaSelector';
import { KeywordScopeSelector } from '../ui/KeywordScopeSelector';
import { ExportAllButton } from '../ui/ExportAllButton';
import type {
  Keyword, KeywordGroup, BrandMentionsResponse, ReportScope
} from '../../types';
import { PageHeaderCard } from '../ui/PageHeaderCard';
import {
  brandMentionsExportParams, brandMentionSummaryExportParams, type BrandAppearancesRequest
} from '../../api/brandMentions';

/*
 * The Brand Mentions page's header and controls: what to look at (scope and
 * persona), the analysis run, the server exports and the classification filter.
 */

export const ScopePanel = ({
  keywords, groups, scope, onChange, selectedPersonaId, onPersonaChange
}: {
  keywords: Keyword[];
  groups: KeywordGroup[];
  scope: ReportScope;
  onChange: (scope: ReportScope) => void;
  selectedPersonaId: string | null;
  onPersonaChange: (personaId: string | null) => void;
}) => (
  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
    <h3 className="text-sm font-medium text-gray-900 mb-1">What to look at</h3>
    <p className="text-xs text-gray-500 mb-4">Pick one keyword to read each AI engine&apos;s answer, or a keyword group or all keywords for totals.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <KeywordScopeSelector
        keywords={keywords}
        groups={groups}
        value={scope}
        onChange={onChange}
        label="Scope"
      />
      <PersonaSelector
        id="brands-persona-filter"
        name="brands-persona-filter"
        selectedPersonaId={selectedPersonaId}
        onPersonaChange={onPersonaChange}
      />
    </div>
    {keywords.length === 0 && (
      <p className="text-gray-500 text-center py-8 text-sm">No keywords available. Add keywords in Settings › Keywords, then run an analysis.</p>
    )}
  </div>
);

const FilterButton = ({
  active, onClick, activeClass, inactiveClass, children
}: {
  active: boolean;
  onClick: () => void;
  activeClass: string;
  inactiveClass: string;
  children: ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active ? activeClass : inactiveClass}`}
  >
    {children}
  </button>
);

export const ClassificationFilter = ({
  filter, onFilterChange, counts
}: {
  filter: string | null;
  onFilterChange: (filter: string | null) => void;
  counts: {
    total: number;
    firstParty: number;
    competitor: number;
    other: number
  };
}) => (
  <div className="flex gap-2 flex-wrap">
    <FilterButton active={filter === null} onClick={() => onFilterChange(null)} activeClass="bg-gray-900 text-white" inactiveClass="bg-gray-100 text-gray-700 hover:bg-gray-200">
      All ({counts.total})
    </FilterButton>
    <FilterButton active={filter === 'first_party'} onClick={() => onFilterChange('first_party')} activeClass="bg-violet-700 text-white dark:bg-violet-600" inactiveClass="bg-violet-50 text-violet-700 hover:bg-violet-100">
      First Party ({counts.firstParty})
    </FilterButton>
    <FilterButton active={filter === 'competitor'} onClick={() => onFilterChange('competitor')} activeClass="bg-red-600 text-white" inactiveClass="bg-red-50 text-red-700 hover:bg-red-100">
      Competitors ({counts.competitor})
    </FilterButton>
    <FilterButton active={filter === 'other'} onClick={() => onFilterChange('other')} activeClass="bg-gray-600 text-white" inactiveClass="bg-gray-100 text-gray-700 hover:bg-gray-200">
      Other ({counts.other})
    </FilterButton>
  </div>
);

export const Header = ({
  industryName, firstPartyCount, competitorCount, onConfigClick
}: {
  industryName: string;
  firstPartyCount: number;
  competitorCount: number;
  onConfigClick: () => void;
}) => (
  <PageHeaderCard
    title="Brand Mentions"
    description="See which brands AI search engines mention."
    relaxed={false}
    footer={(
      <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2 text-sm">
        <span className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg">{industryName}</span>
        {firstPartyCount > 0 && <span className="px-3 py-1.5 bg-violet-50 text-violet-700 rounded-lg">{firstPartyCount} first-party</span>}
        {competitorCount > 0 && <span className="px-3 py-1.5 bg-gray-50 text-gray-700 rounded-lg">{competitorCount} competitors</span>}
      </div>
    )}
  >
    <button onClick={onConfigClick} className="px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 self-start">
      Configure Brands
    </button>
  </PageHeaderCard>
);

export const getFilterCounts = (data: BrandMentionsResponse | null) => ({
  total: data?.aggregated.total_unique_brands ?? 0,
  firstParty: data?.aggregated.summary.first_party_count ?? 0,
  competitor: data?.aggregated.summary.competitor_count ?? 0,
  other: data?.aggregated.summary.other_count ?? 0,
});

export const BrandReportControls = ({
  data, exportRequest, selectedTimestamp, onTimestampChange
}: {
  data: BrandMentionsResponse;
  exportRequest: BrandAppearancesRequest;
  selectedTimestamp: string | null;
  onTimestampChange: (timestamp: string | null) => void;
}) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      <label htmlFor="brands-analysis-run" className="block text-xs font-medium text-gray-500 mb-1.5">Analysis run</label>
      <select
        id="brands-analysis-run"
        name="brands-analysis-run"
        value={selectedTimestamp ?? ''}
        onChange={(event) => onTimestampChange(event.target.value || null)}
        className="min-w-64 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
      >
        <option value="">Latest</option>
        {data.available_runs.map((run) => <option key={run} value={run}>{run}</option>)}
      </select>
    </div>
    <div className="flex flex-wrap items-start gap-2">
      <ExportAllButton view="brand-mention-summary" params={brandMentionSummaryExportParams(exportRequest)} />
      <ExportAllButton view="brand-appearances" params={brandMentionsExportParams(exportRequest)} label="Export all mentions" />
    </div>
  </div>
);

export const AnalysisRunContext = ({
  data, scopeLabel, selectedTimestamp
}: {
  data: BrandMentionsResponse;
  scopeLabel: string;
  selectedTimestamp: string | null;
}) => {
  if (data.keyword !== null) {
    return selectedTimestamp === null ? null : (
      <p className="text-xs text-gray-500 px-1">Showing analysis run {selectedTimestamp} for {scopeLabel}.</p>
    );
  }

  if (selectedTimestamp !== null) {
    return (
      <p className="text-xs text-gray-500 px-1">
        Analysis run {selectedTimestamp} includes data for {data.keywords_with_data ?? 0} of {data.keywords_analyzed ?? 0} keywords in {scopeLabel}.
      </p>
    );
  }

  return (
    <p className="text-xs text-gray-500 px-1">
      Aggregated over each keyword&apos;s latest run; {data.keywords_with_data ?? 0} of {data.keywords_analyzed ?? 0} keywords in {scopeLabel} have data.
    </p>
  );
};
