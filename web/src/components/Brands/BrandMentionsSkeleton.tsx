import {
  Skeleton, SkeletonRegion, SkeletonTable
} from '../ui/Skeleton';

const FILTER_IDS = ['all', 'first-party', 'competitors', 'other'] as const;

/**
 * The Brand Mentions results while the first answer for a scope loads: the
 * analysis-run picker and export button, the context line, the four
 * classification filters and the mentions table card.
 */
export const BrandMentionsSkeleton = () => (
  <SkeletonRegion label="Loading brand mentions" className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Skeleton className="h-3 w-24 mb-2.5" />
        <Skeleton className="h-[38px] w-64 rounded-lg" />
      </div>
      <Skeleton className="h-[38px] w-32 rounded-lg" />
    </div>
    <Skeleton className="h-3 w-96 max-w-full" />
    <div className="flex gap-2 flex-wrap">
      {FILTER_IDS.map((id) => <Skeleton key={id} className="h-9 w-28 rounded-lg" />)}
    </div>
    <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
      <div className="mb-4 space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <SkeletonTable rows={8} columns={5} />
    </div>
  </SkeletonRegion>
);
