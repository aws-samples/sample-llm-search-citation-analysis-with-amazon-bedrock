/** Sentinel `itemsPerPage` value meaning "show every item on one page". */
export const SHOW_ALL_ITEMS = -1;

/** The window a one-based `currentPage` opens over `totalItems`. */
export interface PageWindow {
  readonly totalItems: number;
  readonly showAll: boolean;
  readonly totalPages: number;
  /** Zero-based index of the first visible item. */
  readonly startIndex: number;
  /** Zero-based index one past the last visible item. */
  readonly endIndex: number;
}

export interface PaginatedList<T> extends PageWindow {
  /** The items visible on `currentPage`. */
  readonly pageItems: T[];
}

/**
 * Page arithmetic shared by `paginate` and the `PaginationHeader`, so the
 * header above a table describes the same window the table shows.
 * `itemsPerPage === SHOW_ALL_ITEMS` collapses the list to a single page.
 */
export function pageWindow(totalItems: number, currentPage: number, itemsPerPage: number): PageWindow {
  const showAll = itemsPerPage === SHOW_ALL_ITEMS;
  const totalPages = showAll ? 1 : Math.ceil(totalItems / itemsPerPage);
  const startIndex = showAll ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = showAll ? totalItems : startIndex + itemsPerPage;

  return {
    totalItems,
    showAll,
    totalPages,
    startIndex,
    endIndex,
  };
}

/** Client-side page window shared by the citations and searches tables. */
export function paginate<T>(items: readonly T[], currentPage: number, itemsPerPage: number): PaginatedList<T> {
  const visible = pageWindow(items.length, currentPage, itemsPerPage);

  return {
    ...visible,
    pageItems: items.slice(visible.startIndex, visible.endIndex),
  };
}
