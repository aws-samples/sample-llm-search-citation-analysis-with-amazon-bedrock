import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

const ENTRY_IDS = ['entry-a', 'entry-b', 'entry-c', 'entry-d', 'entry-e', 'entry-f'] as const;

/** `FolderFileList` while a folder's listing loads: its compact entry rows and the totals footer. */
export const FolderListSkeleton = () => (
  <SkeletonRegion label="Loading folder">
    <div className="rounded-lg border border-gray-200 divide-y divide-gray-200">
      {ENTRY_IDS.map((id) => (
        <div key={id} className="flex h-9 items-center gap-3 px-3">
          <Skeleton className="w-4 h-4 rounded" />
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="ml-auto h-3 w-12" />
        </div>
      ))}
    </div>
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex h-4 items-center"><Skeleton className="h-3 w-28" /></div>
    </div>
  </SkeletonRegion>
);
