import type { BedrockTierId } from '../../api/bedrockModels';
import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

const TIER_IDS: readonly BedrockTierId[] = ['fast', 'balanced', 'deep'];

/** One tier card: name, what it is used for, current model and badges, the label, and the picker row. */
const TierCardSkeleton = () => (
  <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
    <div className="flex h-7 items-center"><Skeleton className="h-5 w-24" /></div>
    <div className="mt-1 flex h-5 items-center"><Skeleton className="h-3.5 w-80 max-w-full" /></div>
    <div className="mt-3 flex h-6 items-center gap-2">
      <Skeleton className="h-3.5 w-56" />
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="h-5 w-28 rounded-full" />
    </div>
    <div className="mt-4 mb-1 flex h-5 items-center"><Skeleton className="h-3.5 w-28" /></div>
    <div className="flex items-center gap-2">
      <Skeleton className="h-9 flex-1 rounded-lg" />
      <Skeleton className="h-9 w-16 rounded-lg" />
      <Skeleton className="h-9 w-16 rounded-lg" />
    </div>
  </div>
);

/** The three tier cards before the first listing arrives. */
export const BedrockModelsSkeleton = () => (
  <SkeletonRegion label="Loading Bedrock models" className="space-y-4">
    {TIER_IDS.map((tier) => <TierCardSkeleton key={tier} />)}
  </SkeletonRegion>
);
