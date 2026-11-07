import type { ReactNode } from 'react';

interface Props {
  /**
   * Number of stat cards per row on wide screens. Three-card headlines
   * stack to a single column on narrow screens; four-card headlines keep
   * two per row so the grid never degrades to one very tall column, and
   * five-card headlines likewise.
   */
  readonly columns: 3 | 4 | 5;
  readonly children: ReactNode;
}

const GRID_COLUMN_CLASSES: Readonly<Record<Props['columns'], string>> = {
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-5',
};

/**
 * Responsive grid for a row of <ReportStatCard /> elements.
 */
export function ReportStatGrid({
  columns, children 
}: Props) {
  const columnsClass = GRID_COLUMN_CLASSES[columns];
  return <div className={`grid ${columnsClass} gap-4`}>{children}</div>;
}
