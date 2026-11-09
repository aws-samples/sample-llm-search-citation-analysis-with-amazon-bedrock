import type { ComponentType } from 'react';
import {
  Skeleton, SkeletonLines, SkeletonRegion, SkeletonTable
} from '../../ui/Skeleton';

/** What a loading section will show, so its placeholder takes the same shape. */
export type SectionShape = 'stats' | 'chart' | 'table' | 'block';

const CARD_CLASS = 'rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800';

function StatTiles() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {[0, 1, 2, 3].map((tile) => (
        <div key={tile} className={`${CARD_CLASS} space-y-3 p-5`}>
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-36 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function ChartCard() {
  return (
    <div className={`${CARD_CLASS} p-4`}>
      <Skeleton className="h-64 w-full" />
      <div className="mt-3 flex justify-center gap-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

function TableCard() {
  return (
    <div className={`${CARD_CLASS} overflow-hidden`}>
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-3 dark:border-gray-700"><Skeleton className="h-3 w-1/3" /></div>
      <SkeletonTable rows={4} columns={5} rowClassName="h-11" />
    </div>
  );
}

function BlockCard() {
  return (
    <div className={`${CARD_CLASS} p-4`}>
      <SkeletonLines lines={3} />
    </div>
  );
}

const SHAPES: Readonly<Record<SectionShape, ComponentType>> = {
  stats: StatTiles,
  chart: ChartCard,
  table: TableCard,
  block: BlockCard,
};

/**
 * A loading report section's body: placeholder tiles, a chart card, table
 * rows or text lines in the content's place, announced once as `label`.
 */
export function SectionSkeleton({
  shape, label
}: {
  readonly shape: SectionShape;
  readonly label: string;
}) {
  const Shape = SHAPES[shape];
  return (
    <SkeletonRegion label={label}>
      <Shape />
    </SkeletonRegion>
  );
}
