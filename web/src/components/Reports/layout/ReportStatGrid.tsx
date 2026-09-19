import type { ReactNode } from 'react';

interface Props {
  /**
   * Number of stat cards per row on wide screens. Three-card headlines
   * stack to a single column on narrow screens; four-card headlines keep
   * two per row so the grid never degrades to one very tall column.
   */
  readonly columns: 3 | 4;
  readonly children: ReactNode;
}

/**
 * Responsive grid for a row of <ReportStatCard /> elements.
 */
export function ReportStatGrid({
  columns, children 
}: Props) {
  const columnsClass = columns === 3
    ? 'grid-cols-1 sm:grid-cols-3'
    : 'grid-cols-2 sm:grid-cols-4';
  return <div className={`grid ${columnsClass} gap-4`}>{children}</div>;
}
