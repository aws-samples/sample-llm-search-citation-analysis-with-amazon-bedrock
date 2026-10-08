import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

/** Keyword cells per picker row at `lg` (the picker's grid is 1 / 2 / 3 columns). */
const PICKER_COLUMNS = 3;
/** The picker scrolls past `max-h-80`, so more rows than this would never show. */
const MAX_PICKER_ROWS = 9;
const GROUP_PILL_IDS = ['pill-a', 'pill-b', 'pill-c'] as const;

function pickerCellIds(keywordCount: number): string[] {
  const cells = Math.min(keywordCount, MAX_PICKER_ROWS * PICKER_COLUMNS);
  return Array.from({ length: cells }, (_, cell) => `picker-cell-${cell}`);
}

interface TriggerSectionSkeletonProps {
  /** Active keywords already known; sizes the picker so it does not grow when the groups arrive. */
  readonly keywordCount: number;
}

/**
 * The Run Analysis panel while admin membership and the keyword groups load:
 * the same card, the group buttons row, the keyword picker frame sized for the
 * known keywords, and the Start button, so the real panel replaces it in place.
 */
export const TriggerSectionSkeleton = ({ keywordCount }: TriggerSectionSkeletonProps) => (
  <SkeletonRegion label="Loading analysis options" className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
    <Skeleton className="h-4 w-44 mb-3" />
    <Skeleton className="h-4 w-52 mb-5" />
    <Skeleton className="h-4 w-40 mb-3" />
    <div className="flex flex-wrap gap-2 mb-4">
      {GROUP_PILL_IDS.map((id) => <Skeleton key={id} className="h-[34px] w-28 rounded-lg" />)}
    </div>
    {keywordCount > 0 && (
      <div className="mb-4">
        <Skeleton className="h-4 w-48 mb-3" />
        <div className="border border-gray-200 rounded-lg bg-gray-50">
          <div className="flex items-center gap-2 p-3 border-b border-gray-200">
            <Skeleton className="h-[34px] flex-1 rounded-lg" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="max-h-80 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-white">
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 px-3 pb-3">
              {pickerCellIds(keywordCount).map((id) => <Skeleton key={id} className="h-8 rounded" />)}
            </div>
          </div>
        </div>
      </div>
    )}
    <Skeleton className="h-9 w-36 rounded-lg" />
  </SkeletonRegion>
);
