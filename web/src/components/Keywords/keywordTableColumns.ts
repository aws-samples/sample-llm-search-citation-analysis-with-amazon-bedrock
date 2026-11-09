/**
 * Widths and breakpoints of the keyword table's fixed columns, shared by the
 * header and the rows. The keyword column takes the rest; groups and the
 * added date drop out on narrow screens so a row stays one line
 * (`useKeywordColumnCount` mirrors these breakpoints).
 */
export const KEYWORD_COLUMNS = {
  select: 'w-10',
  market: 'w-48',
  groups: 'hidden md:table-cell w-40',
  status: 'w-24',
  added: 'hidden 2xl:table-cell w-28',
  actions: 'w-12',
} as const;
