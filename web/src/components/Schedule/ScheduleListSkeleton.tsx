import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

const SCHEDULE_ROW_IDS = ['schedule-a', 'schedule-b'] as const;

/**
 * Schedule cards (name, timing line, scope line and the row's actions) while
 * `GET /schedules` is in flight on first visit, instead of the "No schedules
 * configured" empty state flashing before the list arrives.
 */
export const ScheduleListSkeleton = () => (
  <SkeletonRegion label="Loading schedules" className="space-y-3">
    {SCHEDULE_ROW_IDS.map((id) => (
      <div key={id} className="flex items-start justify-between gap-3 p-4 border border-gray-200 rounded-lg">
        <div className="flex-1 min-w-0">
          <div className="flex h-5 items-center gap-2">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="mt-1 flex h-5 items-center"><Skeleton className="h-3.5 w-56" /></div>
          <div className="mt-1 flex h-4 items-center"><Skeleton className="h-3 w-72 max-w-full" /></div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Skeleton className="h-[30px] w-16 rounded-lg" />
          <Skeleton className="h-[30px] w-20 rounded-lg" />
        </div>
      </div>
    ))}
  </SkeletonRegion>
);
