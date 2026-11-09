import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

const SCOPE_OPTION_IDS = ['scope-all', 'scope-groups', 'scope-keywords'] as const;

/**
 * The start card while admin membership and the keyword groups load: the
 * same header, the "Which keywords" options, the market disclosure, the
 * "Sent to" lines and the footer with the summary and Start, so the real
 * card replaces it in place.
 */
export const TriggerSectionSkeleton = () => (
  <SkeletonRegion label="Loading analysis options" className="bg-white rounded-lg border border-gray-200">
    <div className="p-4 sm:p-6 border-b border-gray-200">
      <Skeleton className="h-6 w-32 mb-2" />
      <Skeleton className="h-4 w-full max-w-xl" />
    </div>
    <div className="p-4 sm:p-6 max-w-3xl">
      <Skeleton className="h-4 w-28 mb-3" />
      <div className="flex flex-col gap-3 mb-5">
        {SCOPE_OPTION_IDS.map((id) => <Skeleton key={id} className="h-8 w-72" />)}
      </div>
      <Skeleton className="h-4 w-48 mb-6" />
      <Skeleton className="h-4 w-16 mb-3" />
      <Skeleton className="h-4 w-80 max-w-full mb-1.5" />
      <Skeleton className="h-4 w-56" />
    </div>
    <div className="px-4 sm:px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-3">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-9 w-36 rounded-lg" />
    </div>
  </SkeletonRegion>
);
