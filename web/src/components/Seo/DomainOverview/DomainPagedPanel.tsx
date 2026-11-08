import {
  useState, type ReactNode
} from 'react';
import type { SeoRequest } from '../../../hooks/useKeywordExplorerRequest';
import type {
  DomainScope, DomainTargetRequest
} from '../../../types/api/seoDomains';
import { DomainFilterPanel } from './DomainFilterPanel';
import { DomainPager } from './DomainPager';
import { DomainTableStatus } from './DomainTableStatus';
import type { FilterForm } from './domainFilters';
import {
  DataTable, type DataColumn
} from '../../ui/DataTable';
import { CompactNumber } from '../../ui/tableCells';
import {
  DomainPagedExport, type PagedExcel, type ShownAnswer
} from './DomainPagedExport';
import {
  pagedRequest, sortedBy, type PagedQuery, type PagedRequest
} from './domainPagedQuery';

interface PagedAnswer<TRow> extends ShownAnswer<TRow> {
  readonly has_more: boolean;
  readonly cached: boolean;
}

/** What differs between the ranked-keywords and the top-pages lists. */
export interface PagedListSpec<TFilters> {
  readonly bounds: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
  }>;
  readonly countConditions: (form: FilterForm, scope: DomainScope) => number;
  readonly toFilters: (form: FilterForm) => TFilters;
  readonly loadingLabel: string;
  readonly skeletonColumns: number;
  /** Names the table for assistive technology. */
  readonly caption: string;
}

/** The props of a list panel: what was analyzed, its resolved scope and the list's request. */
export interface DomainListProps<TRequest, TResponse> {
  readonly target: DomainTargetRequest;
  readonly scope: DomainScope;
  readonly request: SeoRequest<TRequest, TResponse>;
}

/** One column of a list: a shared `DataTable` column whose sort key is the list's sort. */
export type ListColumn<TRow, TSort extends string> = DataColumn<TRow, TSort>;

/** The estimated-traffic column both lists share, sorted by `sort`. */
export function etvColumn<TRow extends { readonly etv: number | null }, TSort extends string>(sort: TSort): ListColumn<TRow, TSort> {
  return {
    id: 'etv',
    header: 'Est. traffic',
    help: 'Estimated monthly organic visits from Google, by DataForSEO (not measured clicks).',
    sortKey: sort,
    numeric: true,
    render: (row) => <CompactNumber value={row.etv} />,
  };
}

/** How a list draws its rows. */
interface RowShape<TRow, TSort extends string> {
  readonly columns: ReadonlyArray<ListColumn<TRow, TSort>>;
  readonly rowKey: (row: TRow) => string;
}

interface Props<TSort extends string, TFilters, TRow, TResponse extends PagedAnswer<TRow>>
  extends DomainListProps<PagedRequest<TSort, TFilters>, TResponse>, RowShape<TRow, TSort> {
  readonly spec: PagedListSpec<TFilters>;
  readonly initialQuery: PagedQuery<TSort>;
  /** Shown before the first request (a button that sends `initialQuery`); none when the list loads with Analyze. */
  readonly start?: (load: () => void) => ReactNode;
  /** An "Export to Excel" button above the table: the page on screen, or more rows asked again (paid). */
  readonly excel?: PagedExcel<TRow, TSort, TFilters>;
}

/** A paged, sorted, filtered Labs list: every change of page, size, sort or filters is one paid page. */
export function DomainPagedPanel<TSort extends string, TFilters, TRow, TResponse extends PagedAnswer<TRow>>({
  target, scope, request, spec, initialQuery, columns, rowKey, start, excel
}: Props<TSort, TFilters, TRow, TResponse>) {
  const [query, setQuery] = useState<PagedQuery<TSort>>(initialQuery);
  const busy = request.state.status === 'loading';
  const send = (next: PagedQuery<TSort>) => {
    setQuery(next);
    void request.run(pagedRequest(target, next, spec.toFilters));
  };
  if (request.state.status === 'idle' && start !== undefined) return <>{start(() => send(initialQuery))}</>;
  return (
    <div className="space-y-3">
      <DomainFilterPanel bounds={spec.bounds} initial={query.filters} busy={busy}
        countConditions={(form) => spec.countConditions(form, scope)}
        onApply={(filters) => send({
          ...query,
          page: 1,
          filters,
        })} />
      <DomainTableStatus state={request.state} loadingLabel={spec.loadingLabel} columns={spec.skeletonColumns}>
        {(response) => (
          <>
            {excel !== undefined && (
              <DomainPagedExport excel={excel} response={response} target={target} query={query} toFilters={spec.toFilters} />
            )}
            <DataTable rows={response.items} columns={columns} rowKey={rowKey} caption={spec.caption}
              sort={{
                key: query.sort,
                order: query.order,
              }}
              onSort={(sort) => send(sortedBy(query, sort))} />
            <DomainPager page={query.page} pageSize={query.pageSize} totalCount={response.total_count} rowCount={response.items.length}
              hasMore={response.has_more} cached={response.cached} busy={busy}
              onPage={(page) => send({
                ...query,
                page,
              })}
              onPageSize={(pageSize) => send({
                ...query,
                page: 1,
                pageSize,
              })} />
          </>
        )}
      </DomainTableStatus>
    </div>
  );
}
