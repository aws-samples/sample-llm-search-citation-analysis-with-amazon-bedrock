import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

const ROW_IDS = ['row-a', 'row-b', 'row-c'] as const;

interface ResearchListSkeletonProps {
  /** Announced to screen readers, e.g. "Loading history". */
  readonly label: string;
  /** Gap between the title line and the details line, as on the real rows. */
  readonly detailsGapClassName: string;
}

/**
 * A bordered list of research rows (status pill and title over a line of
 * details, a trailing action) while the first page of research history or
 * agent runs loads.
 */
export const ResearchListSkeleton = ({
  label, detailsGapClassName
}: ResearchListSkeletonProps) => (
  <SkeletonRegion label={label} className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
    {ROW_IDS.map((id) => (
      <div key={id} className="flex items-center gap-3 p-3 sm:p-4">
        <div className="flex-1 min-w-0">
          <div className="flex h-5 items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3.5 w-48" />
          </div>
          <div className={`flex h-4 items-center ${detailsGapClassName}`}>
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-8 w-28 rounded-lg shrink-0" />
      </div>
    ))}
  </SkeletonRegion>
);
