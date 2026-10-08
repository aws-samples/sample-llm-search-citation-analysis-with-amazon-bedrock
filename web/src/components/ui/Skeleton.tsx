import type { ReactNode } from 'react';

/*
 * Skeleton placeholders. A view shows these while its data loads, laid out
 * like the content they stand in for, so the page keeps its shape and nothing
 * jumps when the data arrives. The `.skeleton` class (index.css) carries the
 * colour, dark-mode tint and pulse.
 */

interface SkeletonProps {
  /** Size and shape, e.g. `h-4 w-32` or `h-10 w-full rounded-lg`. */
  readonly className?: string;
}

/** One placeholder block. Decorative: assistive tech hears the region's label instead. */
export const Skeleton = ({ className = 'h-4 w-full' }: SkeletonProps) => (
  <div aria-hidden="true" className={`skeleton ${className}`} />
);

interface SkeletonRegionProps {
  /** Announced to screen readers, e.g. "Loading users". */
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/** Wraps a skeleton layout so screen readers announce one loading status for it. */
export const SkeletonRegion = ({
  label, className = '', children
}: SkeletonRegionProps) => (
  // <output> carries the implicit "status" role; `block` undoes its inline default.
  <output aria-busy="true" aria-live="polite" className={`block ${className}`}>
    <span className="sr-only">{label}</span>
    {children}
  </output>
);

const LINE_WIDTHS = ['w-full', 'w-11/12', 'w-4/5', 'w-2/3'] as const;

interface SkeletonLinesProps {
  readonly lines?: number;
  readonly className?: string;
}

/** A paragraph of text lines of varying width. */
export const SkeletonLines = ({
  lines = 3, className = ''
}: SkeletonLinesProps) => (
  <div aria-hidden="true" className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }, (_, index) => (
      <div key={index} className={`skeleton h-3.5 ${LINE_WIDTHS[index % LINE_WIDTHS.length]}`} />
    ))}
  </div>
);

interface SkeletonTableProps {
  readonly rows?: number;
  readonly columns?: number;
  /** Row height, matching the real table rows (default `h-14`). */
  readonly rowClassName?: string;
}

/** Table body rows: one bar per cell, the first column wider (it usually holds the name). */
export const SkeletonTable = ({
  rows = 5, columns = 4, rowClassName = 'h-14'
}: SkeletonTableProps) => (
  <div aria-hidden="true" className="divide-y divide-gray-100 dark:divide-gray-700">
    {Array.from({ length: rows }, (_, row) => (
      <div key={row} className={`flex items-center gap-6 px-6 ${rowClassName}`}>
        {Array.from({ length: columns }, (_, column) => (
          <div key={column} className={`skeleton h-3.5 ${column === 0 ? 'flex-[2]' : 'flex-1'}`} />
        ))}
      </div>
    ))}
  </div>
);

interface SkeletonCardsProps {
  readonly count?: number;
  /** Grid classes, e.g. `grid-cols-1 md:grid-cols-2`. */
  readonly gridClassName?: string;
  /** Height of each card, matching the real cards. */
  readonly cardClassName?: string;
}

/** A grid of card outlines with a title and two text lines each. */
export const SkeletonCards = ({
  count = 4,
  gridClassName = 'grid-cols-1 md:grid-cols-2',
  cardClassName = 'h-32',
}: SkeletonCardsProps) => (
  <div aria-hidden="true" className={`grid gap-4 ${gridClassName}`}>
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className={`rounded-lg border border-gray-200 bg-white p-4 space-y-3 ${cardClassName}`}>
        <div className="skeleton h-4 w-1/3" />
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-2/3" />
      </div>
    ))}
  </div>
);

/** Generic page placeholder: a header card over a two-card grid (lazy views' Suspense fallback). */
export const SkeletonPage = ({ label = 'Loading page' }: { readonly label?: string }) => (
  <SkeletonRegion label={label} className="space-y-6">
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3.5 w-96 max-w-full" />
    </div>
    <SkeletonCards count={2} gridClassName="grid-cols-1 lg:grid-cols-2" cardClassName="h-64" />
  </SkeletonRegion>
);
