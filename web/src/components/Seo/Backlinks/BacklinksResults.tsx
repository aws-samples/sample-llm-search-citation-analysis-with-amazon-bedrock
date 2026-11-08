import {
  useEffect, useId, useMemo, useState, type ReactNode
} from 'react';
import {
  useBacklinksDomainExpansion, type DomainExpansion
} from '../../../hooks/useBacklinksDomainExpansion';
import type { SeoRequestState } from '../../../hooks/useKeywordExplorerRequest';
import { useBacklinksTable } from '../../../hooks/useBacklinksTable';
import type {
  BacklinksFilters, BacklinksMode, BacklinksScope, BacklinksTab, BacklinksTableRequest, BacklinksTableResponse,
  BacklinksTargetRequest
} from '../../../types/api/seoBacklinks';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
import {
  SkeletonRegion, SkeletonTable
} from '../../ui/Skeleton';
import {
  TabBar, TabPanel
} from '../../ui/TabBar';
import { TablePager } from '../../ui/TablePager';
import { BacklinksFilterPanel } from './BacklinksFilterPanel';
import {
  BacklinksTable, type TableSort
} from './BacklinksTable';
import {
  DEFAULT_SORT_FIELDS, TABLE_COLUMNS
} from './backlinksColumns';
import { BacklinksExportButton } from './BacklinksExportButton';
import {
  activeFilterCount, conditionCount, conditionLimit, overBudgetMessage
} from './backlinksFilters';
import {
  CACHED_NOTE, LOOKUP_NOTES, TAB_DESCRIPTIONS, TAB_LABELS
} from './backlinksFormat';

const PAGE_SIZES = [50, 100, 200] as const;
type PageSize = typeof PAGE_SIZES[number];

interface TableState {
  readonly page: number;
  readonly pageSize: PageSize;
  readonly sort: TableSort;
  readonly filters: BacklinksFilters;
  readonly includeSpam: boolean;
  readonly mode: BacklinksMode;
}

function initialState(tab: BacklinksTab): TableState {
  return {
    page: 1,
    pageSize: 50,
    sort: {
      field: DEFAULT_SORT_FIELDS[tab],
      order: 'desc',
    },
    filters: {},
    includeSpam: false,
    mode: 'one_per_domain',
  };
}

function Toolbar({
  tab, state, filtersOpen, onToggleFilters, onChange, exportButton
}: {
  readonly tab: BacklinksTab;
  readonly state: TableState;
  readonly filtersOpen: boolean;
  readonly onToggleFilters: () => void;
  readonly onChange: (next: Partial<TableState>) => void;
  readonly exportButton: ReactNode;
}) {
  const count = activeFilterCount(state.filters);
  const filtersLabel = count === 0 ? 'Filters' : `Filters (${count})`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={onToggleFilters} aria-expanded={filtersOpen} size="sm" variant="secondary">{filtersLabel}</Button>
      {tab !== 'top_pages' && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={state.includeSpam} onChange={(event) => onChange({ includeSpam: event.target.checked })} />
          Include likely spam
          <span className="text-xs text-gray-500">(spam score 40 or higher; unknown scores are always shown)</span>
        </label>
      )}
      {tab === 'backlinks' && (
        <fieldset className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          <legend className="sr-only">Links shown</legend>
          {(['one_per_domain', 'as_is'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={state.mode === mode}
              onClick={() => onChange({ mode })}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${state.mode === mode ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {mode === 'one_per_domain' ? 'One per domain' : 'All links'}
            </button>
          ))}
        </fieldset>
      )}
      <span className="flex-1" />
      {exportButton}
    </div>
  );
}

/** The table the state shows, without the page: what a page and an export chunk both ask. */
function listRequest(target: BacklinksTargetRequest, tab: BacklinksTab, state: TableState): BacklinksTableRequest {
  return {
    ...target,
    sort_field: state.sort.field,
    sort_order: state.sort.order,
    filters: state.filters,
    include_spam: state.includeSpam,
    ...(tab === 'backlinks' ? { mode: state.mode } : {}),
  };
}

function tableRequest(target: BacklinksTargetRequest, tab: BacklinksTab, state: TableState): BacklinksTableRequest {
  return {
    ...listRequest(target, tab, state),
    page: state.page,
    page_size: state.pageSize,
  };
}

/** The answer of one page request: a skeleton, the error, or the rows with paging and the cache note. */
function TablePage<TTab extends BacklinksTab>({
  tab, request, state, onSort, onChange, expansion
}: {
  readonly tab: TTab;
  readonly request: SeoRequestState<BacklinksTableResponse<TTab>>;
  readonly state: TableState;
  readonly onSort: (field: string) => void;
  readonly onChange: (next: Partial<TableState>) => void;
  readonly expansion: DomainExpansion | undefined;
}) {
  if (request.status === 'idle') return null;
  if (request.status === 'loading') {
    return (
      <SkeletonRegion label="Loading table" className="rounded-lg border border-gray-200 bg-white">
        <SkeletonTable rows={8} columns={TABLE_COLUMNS[tab].length} rowClassName="h-11" />
      </SkeletonRegion>
    );
  }
  if (request.status === 'error') return <ErrorAlert message={request.message} />;
  const loaded = request.response;
  return (
    <>
      <BacklinksTable tab={tab} rows={loaded.rows} sort={state.sort} onSort={onSort} expansion={expansion} />
      <TablePager
        page={state.page}
        pageSize={state.pageSize}
        sizes={PAGE_SIZES}
        totalCount={loaded.total_count}
        rowCount={loaded.rows.length}
        hasMore={loaded.has_more}
        label={`${TAB_LABELS[tab]} pages`}
        onPage={(page) => onChange({ page })}
        onPageSize={(pageSize) => onChange({ pageSize })}
        note={loaded.cached ? <span className="text-xs text-gray-500">{CACHED_NOTE}</span> : undefined}
      />
    </>
  );
}

/** One table: its page is asked for on every change the user makes, never when the filters exceed the budget. */
function TabTable({
  tab, target, scope
}: {
  readonly tab: BacklinksTab;
  readonly target: BacklinksTargetRequest;
  readonly scope: BacklinksScope;
}) {
  const [state, setState] = useState<TableState>(() => initialState(tab));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const table = useBacklinksTable(tab);
  const expansion = useBacklinksDomainExpansion(target, state.includeSpam);
  const limit = conditionLimit(tab, scope, state.includeSpam);
  const overBudget = conditionCount(state.filters) > limit;
  const request = useMemo(() => tableRequest(target, tab, state), [target, tab, state]);
  const { run } = table;

  useEffect(() => {
    if (!overBudget) void run(request);
  }, [overBudget, request, run]);

  // Sort, filters, page size, spam and link mode start again from page 1.
  const change = (next: Partial<TableState>) => setState((current) => ({
    ...current,
    ...next,
    page: next.page ?? 1,
  }));
  const sortOn = (field: string) => change({
    sort: {
      field,
      order: state.sort.field === field && state.sort.order === 'desc' ? 'asc' : 'desc',
    },
  });
  const loaded = table.state.status === 'success' ? table.state.response : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">{TAB_DESCRIPTIONS[tab]} {LOOKUP_NOTES.table}</p>
      <Toolbar
        tab={tab}
        state={state}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
        onChange={change}
        exportButton={(
          <BacklinksExportButton tab={tab} list={listRequest(target, tab, state)} loaded={loaded}
            disabled={loaded === null || loaded.rows.length === 0 || overBudget} />
        )}
      />
      {filtersOpen && <BacklinksFilterPanel tab={tab} applied={state.filters} limit={limit} onApply={(filters) => change({ filters })} />}
      {overBudget
        ? <ErrorAlert message={overBudgetMessage(limit)} />
        : (
          <TablePage
            tab={tab}
            request={table.state}
            state={state}
            onSort={sortOn}
            onChange={change}
            expansion={tab === 'backlinks' && state.mode === 'one_per_domain' ? expansion : undefined}
          />
        )}
    </div>
  );
}

/** The Backlinks / Referring domains / Top pages tabs of one target (no referring domains for a subfolder). */
export function BacklinksResults({
  target, scope
}: {
  readonly target: BacklinksTargetRequest;
  readonly scope: BacklinksScope;
}) {
  const tabs: BacklinksTab[] = scope === 'subfolder' ? ['backlinks', 'top_pages'] : ['backlinks', 'referring_domains', 'top_pages'];
  const [active, setActive] = useState<BacklinksTab>('backlinks');
  const panelId = useId();
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <TabBar
        className="px-4 sm:px-6"
        panelId={panelId}
        label="Backlinks tables"
        tabs={tabs.map((id) => ({
          id,
          label: TAB_LABELS[id],
        }))}
        activeId={active}
        onChange={setActive}
      />
      <TabPanel id={panelId} activeId={active} className="p-4 sm:p-6">
        <TabTable key={active} tab={active} target={target} scope={scope} />
      </TabPanel>
    </section>
  );
}
