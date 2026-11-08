import {
  useMemo, useState
} from 'react';
import { useKeywordExplorerTracking } from '../../../hooks/useKeywordExplorerTracking';
import type { SeoRequestState } from '../../../hooks/useKeywordExplorerRequest';
import type { Keyword } from '../../../types';
import type { ViewParams } from '../../../api/exports';
import type {
  KeywordResearchRequest, KeywordResearchResponse, SerpResponse
} from '../../../types/api/seo';
import { Button } from '../../ui/Button';
import { ExportAllButton } from '../../ui/ExportAllButton';
import {
  DEFAULT_SORT, EMPTY_FILTERS, activeFilterCount, explorerExportParams, filterKeywordRows, nextSort, sortKeywordRows,
  type KeywordFilters, type KeywordSort, type SortField
} from './keywordExplorerFilters';
import { KeywordFilterPanel } from './KeywordFilterPanel';
import { KeywordExplorerTable } from './KeywordExplorerTable';
import { KeywordTrackBar } from './KeywordTrackBar';
import { SerpPanel } from './SerpPanel';

export const GOOGLE_ADS_NOTE = 'Difficulty and intent are not available for this country';
export const CACHED_NOTE = 'From cache (refreshes daily)';

interface KeywordExplorerResultsProps {
  /** The research request the response answers (what the export asks the cache for). */
  readonly request: KeywordResearchRequest;
  readonly response: KeywordResearchResponse;
  readonly serpKeyword: string | null;
  readonly serpState: SeoRequestState<SerpResponse>;
  readonly onOpenSerp: (keyword: string, depth?: 20 | 50) => void;
  readonly onKeywordsAdded?: (created: Keyword[]) => void;
}

function ResearchNotes({ response }: { readonly response: KeywordResearchResponse }) {
  const notes = [
    ...(response.cached ? [CACHED_NOTE] : []),
    ...(response.used_fallback ? ['Few direct matches, so closely related keywords are shown too.'] : []),
  ];
  return (
    <div className="space-y-1 text-sm text-gray-600">
      {response.data_source === 'google_ads' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">{GOOGLE_ADS_NOTE}</p>
      )}
      {notes.length > 0 && <p>{notes.join(' · ')}</p>}
    </div>
  );
}

function ResultsToolbar({
  shown, total, filterCount, filtersOpen, onToggleFilters, exportParams
}: {
  readonly shown: number;
  readonly total: number;
  readonly filterCount: number;
  readonly filtersOpen: boolean;
  readonly onToggleFilters: () => void;
  readonly exportParams: ViewParams;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" aria-expanded={filtersOpen} onClick={onToggleFilters}>
        {filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
      </Button>
      <p className="flex-1 text-sm text-gray-600">
        {shown === total ? `Showing ${total} keywords` : `Showing ${shown} of ${total} keywords`}
      </p>
      <ExportAllButton view="seo-keyword-explorer" params={shown === 0 ? null : exportParams} />
    </div>
  );
}

/** The rows of one research: notes, filters, sortable table, tracking and the SERP panel. */
export function KeywordExplorerResults({
  request, response, serpKeyword, serpState, onOpenSerp, onKeywordsAdded
}: KeywordExplorerResultsProps) {
  const [filters, setFilters] = useState<KeywordFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<KeywordSort>(DEFAULT_SORT);
  const visible = useMemo(
    () => sortKeywordRows(filterKeywordRows(response.rows, filters), sort),
    [response.rows, filters, sort],
  );
  const tracking = useKeywordExplorerTracking(response.rows, onKeywordsAdded);

  if (response.rows.length === 0) {
    return (
      <p className="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-500">
        No keyword ideas for &ldquo;{response.keyword}&rdquo; in this market yet. Try a broader seed or another mode.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ResearchNotes response={response} />
      <ResultsToolbar
        shown={visible.length}
        total={response.rows.length}
        filterCount={activeFilterCount(filters)}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
        exportParams={explorerExportParams(request, filters, sort)}
      />
      {filtersOpen && <KeywordFilterPanel filters={filters} onChange={setFilters} />}
      <KeywordTrackBar tracking={tracking} />
      <div className={serpKeyword === null ? '' : 'grid grid-cols-1 lg:grid-cols-5 gap-4 items-start'}>
        <div className="lg:col-span-3">
          {visible.length === 0
            ? <p className="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-500">No keywords match the filters.</p>
            : (
              <KeywordExplorerTable
                rows={visible}
                sort={sort}
                onSort={(field: SortField) => setSort((current) => nextSort(current, field))}
                selectedKeys={tracking.promotion.selectedKeys}
                onToggle={tracking.promotion.toggle}
                activeKeyword={serpKeyword}
                onOpenSerp={onOpenSerp}
              />
            )}
        </div>
        {serpKeyword !== null && (
          <div className="lg:col-span-2">
            <SerpPanel keyword={serpKeyword} state={serpState} onLoad={(depth) => onOpenSerp(serpKeyword, depth)} />
          </div>
        )}
      </div>
    </div>
  );
}
