/** Sentinel `itemsPerPage` value meaning "show every item on one page". */
const SHOW_ALL_ITEMS = -1;

export interface PaginatedList<T> {
  /** The items visible on `currentPage`. */
  readonly pageItems: T[];
  readonly totalItems: number;
  readonly showAll: boolean;
  readonly totalPages: number;
  /** Zero-based index of the first visible item. */
  readonly startIndex: number;
  /** Zero-based index one past the last visible item. */
  readonly endIndex: number;
}

/**
 * Client-side page window shared by the citations and searches tables.
 * `currentPage` is one-based; `itemsPerPage === SHOW_ALL_ITEMS` collapses the
 * list to a single page.
 */
export function paginate<T>(items: readonly T[], currentPage: number, itemsPerPage: number): PaginatedList<T> {
  const totalItems = items.length;
  const showAll = itemsPerPage === SHOW_ALL_ITEMS;
  const totalPages = showAll ? 1 : Math.ceil(totalItems / itemsPerPage);
  const startIndex = showAll ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = showAll ? totalItems : startIndex + itemsPerPage;

  return {
    pageItems: items.slice(startIndex, endIndex),
    totalItems,
    showAll,
    totalPages,
    startIndex,
    endIndex,
  };
}
