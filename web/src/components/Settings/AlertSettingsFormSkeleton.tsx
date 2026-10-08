import {
  Skeleton, SkeletonLines, SkeletonRegion
} from '../ui/Skeleton';

const THRESHOLD_IDS = ['mention-rate', 'position', 'competitor', 'improvement'] as const;

/** A label line over an input-height bar, the shape of one form field. */
const FieldSkeleton = ({ controlClassName }: { readonly controlClassName: string }) => (
  <div>
    <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-36" /></div>
    <Skeleton className={`mt-1 rounded-lg ${controlClassName}`} />
  </div>
);

/**
 * `AlertSettingsForm` before the settings arrive: the enable toggle card, the
 * four threshold fields in the same grid, the emails textarea, the buttons and
 * the subscription status card, each at its rendered height, so the content
 * change section below stays where it is when the form replaces it.
 */
export const AlertSettingsFormSkeleton = () => (
  <SkeletonRegion label="Loading alert settings" className="space-y-5">
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 p-4">
      <Skeleton className="mt-0.5 h-4 w-4 rounded" />
      <div className="flex-1">
        <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-28" /></div>
        <div className="mt-1 flex h-4 items-center"><Skeleton className="h-3 w-72 max-w-full" /></div>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {THRESHOLD_IDS.map((id) => <FieldSkeleton key={id} controlClassName="h-[38px] w-full" />)}
    </div>
    <FieldSkeleton controlClassName="h-[98px] w-full" />
    <div className="flex flex-wrap gap-3">
      <Skeleton className="h-9 w-40 rounded-lg" />
      <Skeleton className="h-9 w-44 rounded-lg" />
    </div>
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-44" /></div>
      <SkeletonLines lines={2} className="mt-2" />
      <div className="mt-3 flex h-5 items-center justify-between">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-5 w-20 rounded" />
      </div>
    </div>
  </SkeletonRegion>
);
