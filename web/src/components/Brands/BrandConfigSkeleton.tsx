import {
  Skeleton, SkeletonLines, SkeletonRegion
} from '../ui/Skeleton';

const CHIP_IDS = ['chip-a', 'chip-b', 'chip-c'] as const;
const OPTION_IDS = ['sentiment', 'ranking', 'max-brands'] as const;

interface ListSectionSkeletonProps {
  /** The real section's surface and border, so the outline matches. */
  readonly toneClassName: string;
  /** Whether the real section has action buttons beside its heading. */
  readonly withActions?: boolean;
}

/** A brand or domain list card: heading, caption, add row and a row of chips. */
const ListSectionSkeleton = ({
  toneClassName, withActions = false
}: ListSectionSkeletonProps) => (
  <div className={`rounded-lg p-4 border ${toneClassName}`}>
    <div className="flex h-[30px] items-center justify-between mb-2">
      <Skeleton className="h-3.5 w-40" />
      {withActions && <Skeleton className="h-[30px] w-28 rounded-lg" />}
    </div>
    <div className="flex h-4 items-center mb-3"><Skeleton className="h-3 w-80 max-w-full" /></div>
    <div className="flex gap-2 mb-3">
      <Skeleton className="h-[38px] flex-1 rounded-lg" />
      <Skeleton className="h-[38px] w-16 rounded-lg" />
    </div>
    <div className="flex flex-wrap gap-2">
      {CHIP_IDS.map((id) => <Skeleton key={id} className="h-7 w-24 rounded-full" />)}
    </div>
  </div>
);

/**
 * `BrandConfigContent` while the configuration loads: the tab bar, the
 * industry picker, the four brand and domain cards, the extraction options and
 * the save bar, in the same stack and spacing as the form that replaces it.
 */
export const BrandConfigSkeleton = () => (
  <SkeletonRegion label="Loading brand configuration" className="space-y-6">
    <div className="flex gap-2 border-b border-gray-200 pb-3">
      <Skeleton className="h-9 w-36 rounded-lg" />
      <Skeleton className="h-9 w-40 rounded-lg" />
    </div>
    <div className="space-y-6">
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div className="flex h-5 items-center mb-3"><Skeleton className="h-3.5 w-20" /></div>
        <Skeleton className="h-[46px] w-full rounded-lg" />
        <SkeletonLines lines={2} className="mt-3" />
      </div>
      <ListSectionSkeleton toneClassName="bg-emerald-50 border-emerald-200" withActions />
      <ListSectionSkeleton toneClassName="bg-emerald-50/50 border-emerald-200" />
      <ListSectionSkeleton toneClassName="bg-amber-50 border-amber-200" withActions />
      <ListSectionSkeleton toneClassName="bg-amber-50/50 border-amber-200" />
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <div className="flex h-5 items-center mb-3"><Skeleton className="h-3.5 w-36" /></div>
        <div className="space-y-3">
          {OPTION_IDS.map((id) => (
            <div key={id} className="flex h-[38px] items-center gap-3">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-3.5 w-48" />
            </div>
          ))}
        </div>
      </div>
    </div>
    <div className="flex justify-end pt-4 border-t border-gray-200">
      <Skeleton className="h-10 w-44 rounded-lg" />
    </div>
  </SkeletonRegion>
);
