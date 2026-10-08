import {
  Skeleton, SkeletonLines, SkeletonRegion
} from '../ui/Skeleton';

/** `GET /providers` lists four answer engines and five search providers. */
const PROVIDER_CARD_IDS = [
  'openai', 'perplexity', 'gemini', 'claude', 'brave', 'tavily', 'exa', 'serpapi', 'firecrawl',
] as const;

/** One provider card: status dot, name and model, description, status pills, and the controls. */
const ProviderCardSkeleton = () => (
  <div className="bg-white rounded-lg border border-gray-200 p-4">
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-3">
        <Skeleton className="mt-1 w-3 h-3 rounded-full" />
        <div>
          <div className="flex h-5 items-center gap-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-[18px] w-28 rounded" />
          </div>
          <div className="mt-1 flex h-4 items-center"><Skeleton className="h-3 w-56" /></div>
          <div className="mt-2 flex items-center gap-2">
            <Skeleton className="h-6 w-20 rounded" />
            <Skeleton className="h-6 w-24 rounded" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-11 rounded-full" />
        <Skeleton className="h-[30px] w-20 rounded-lg" />
      </div>
    </div>
  </div>
);

/** `ProvidersConfig` before the first provider list arrives: header, every provider card, and the notes box. */
export const ProvidersConfigSkeleton = () => (
  <SkeletonRegion label="Loading providers" className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-52" /></div>
        <div className="mt-1 flex h-4 items-center"><Skeleton className="h-3 w-80 max-w-full" /></div>
      </div>
      <Skeleton className="h-9 w-24 rounded-lg" />
    </div>
    <div className="space-y-4">
      {PROVIDER_CARD_IDS.map((id) => <ProviderCardSkeleton key={id} />)}
    </div>
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="flex h-5 items-center mb-2"><Skeleton className="h-3.5 w-24" /></div>
      <SkeletonLines lines={5} />
    </div>
  </SkeletonRegion>
);
