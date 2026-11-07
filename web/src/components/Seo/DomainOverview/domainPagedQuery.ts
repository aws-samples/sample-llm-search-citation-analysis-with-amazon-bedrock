/**
 * The query of a paged Domain Overview list (ranked keywords, top pages):
 * the page, its size, the sort and the filter form, and the request it makes
 * (a page, or an export chunk of the same sorted, filtered list).
 */
import type { ExportChunk } from '../../../exporters/paidExport';
import type {
  DomainPageSize, DomainTargetRequest, SortOrder
} from '../../../types/api/seoDomains';
import {
  emptyFilterForm, searchText, type FilterForm
} from './domainFilters';

export interface PagedQuery<TSort extends string> {
  readonly page: number;
  readonly pageSize: DomainPageSize;
  readonly sort: TSort;
  readonly order: SortOrder;
  readonly filters: FilterForm;
}

/** Page 1 of 50 rows, largest first by `sort`, unfiltered. */
export function firstQuery<TSort extends string>(sort: TSort): PagedQuery<TSort> {
  return {
    page: 1,
    pageSize: 50,
    sort,
    order: 'desc',
    filters: emptyFilterForm(),
  };
}

/** The list a request asks for: the target, sort, filters and search. */
interface ListRequest<TSort extends string, TFilters> extends DomainTargetRequest {
  sort: TSort;
  order: SortOrder;
  filters: TFilters;
  search?: string;
}

export interface PagedRequest<TSort extends string, TFilters> extends ListRequest<TSort, TFilters> {
  page: number;
  page_size: DomainPageSize;
}

/** An export chunk of the list: `limit` rows from `offset` instead of a page. */
export interface PagedExportRequest<TSort extends string, TFilters> extends ListRequest<TSort, TFilters>, ExportChunk {}

function listRequest<TSort extends string, TFilters>(
  target: DomainTargetRequest, query: PagedQuery<TSort>, toFilters: (form: FilterForm) => TFilters,
): ListRequest<TSort, TFilters> {
  const search = searchText(query.filters);
  return {
    ...target,
    sort: query.sort,
    order: query.order,
    filters: toFilters(query.filters),
    ...(search === undefined ? {} : { search }),
  };
}

/** The request of `query` on `target`, its filter form read by `toFilters`. */
export function pagedRequest<TSort extends string, TFilters>(
  target: DomainTargetRequest, query: PagedQuery<TSort>, toFilters: (form: FilterForm) => TFilters,
): PagedRequest<TSort, TFilters> {
  return {
    ...listRequest(target, query, toFilters),
    page: query.page,
    page_size: query.pageSize,
  };
}

/** The request of `chunk` of the list `query` shows on `target` (same sort, filters and search). */
export function exportChunkRequest<TSort extends string, TFilters>(
  target: DomainTargetRequest, query: PagedQuery<TSort>, toFilters: (form: FilterForm) => TFilters, chunk: ExportChunk,
): PagedExportRequest<TSort, TFilters> {
  return {
    ...listRequest(target, query, toFilters),
    offset: chunk.offset,
    limit: chunk.limit,
  };
}

/** A click on a sortable heading: the same column flips the order, another one sorts it largest first. */
export function sortedBy<TSort extends string>(query: PagedQuery<TSort>, sort: TSort): PagedQuery<TSort> {
  return {
    ...query,
    page: 1,
    sort,
    order: sort === query.sort && query.order === 'desc' ? 'asc' : 'desc',
  };
}
