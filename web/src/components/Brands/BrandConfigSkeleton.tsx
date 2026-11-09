import {
  Skeleton, SkeletonLines, SkeletonRegion
} from '../ui/Skeleton';

const CHIP_IDS = ['chip-a', 'chip-b', 'chip-c', 'chip-d'] as const;
const ROW_IDS = ['row-a', 'row-b', 'row-c', 'row-d'] as const;

/** A section heading with its one-line description and a secondary action on the right. */
const SectionHeadSkeleton = () => (
  <div className="flex items-start justify-between gap-3">
    <div className="space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3.5 w-96 max-w-full" />
    </div>
    <Skeleton className="h-8 w-36 rounded-lg" />
  </div>
);

/** A labelled tag field: label, then a bordered box of chips. */
const TagFieldSkeleton = () => (
  <div>
    <Skeleton className="mb-2 h-3.5 w-24" />
    <div className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1.5">
      {CHIP_IDS.map((id) => <Skeleton key={id} className="h-6 w-28 rounded-full" />)}
    </div>
  </div>
);

/**
 * `BrandConfigContent` while the configuration loads: the intro and industry
 * picker, "Your brand" with its two tag fields, the competitor table and the
 * collapsed Advanced heading, in the same stack and spacing as the form.
 */
export const BrandConfigSkeleton = () => (
  <SkeletonRegion label="Loading brand configuration" className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
      <SkeletonLines lines={2} className="w-full max-w-xl" />
      <div className="w-full space-y-2 sm:w-72">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    </div>
    <div className="space-y-4 border-t border-gray-200 pt-6">
      <SectionHeadSkeleton />
      <TagFieldSkeleton />
      <TagFieldSkeleton />
    </div>
    <div className="space-y-4 border-t border-gray-200 pt-6">
      <SectionHeadSkeleton />
      <div className="divide-y divide-gray-200 rounded-lg border border-gray-200">
        {ROW_IDS.map((id) => (
          <div key={id} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-6 w-32 rounded-full" />
          </div>
        ))}
      </div>
    </div>
    <div className="border-t border-gray-200 pt-6"><Skeleton className="h-4 w-72" /></div>
  </SkeletonRegion>
);
