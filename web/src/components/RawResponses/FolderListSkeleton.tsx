import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

const ENTRY_IDS = ['entry-a', 'entry-b', 'entry-c', 'entry-d', 'entry-e', 'entry-f'] as const;

/** `FolderFileList` while a folder's listing loads: its entry rows and the totals footer. */
export const FolderListSkeleton = () => (
  <SkeletonRegion label="Loading folder">
    <div className="space-y-2">
      {ENTRY_IDS.map((id) => (
        <div key={id} className="flex items-center p-3 rounded-lg border border-gray-200">
          <Skeleton className="w-5 h-5 mr-3 rounded" />
          <div className="flex-1">
            <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-48" /></div>
            <div className="flex h-4 items-center"><Skeleton className="h-3 w-16" /></div>
          </div>
        </div>
      ))}
    </div>
    <div className="mt-4 pt-4 border-t border-gray-200">
      <div className="flex h-4 items-center"><Skeleton className="h-3 w-28" /></div>
    </div>
  </SkeletonRegion>
);
