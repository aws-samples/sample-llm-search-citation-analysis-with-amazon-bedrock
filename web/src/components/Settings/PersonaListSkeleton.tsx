import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

const PERSONA_ROW_IDS = ['persona-a', 'persona-b', 'persona-c'] as const;

/**
 * The persona rows (name and status pill, description, template) and the
 * "n of m personas enabled" footer, while `GET /query-prompts` is in flight
 * for the first time.
 */
export const PersonaListSkeleton = () => (
  <SkeletonRegion label="Loading personas" className="space-y-4">
    <div className="space-y-2">
      {PERSONA_ROW_IDS.map((id) => (
        <div key={id} className="p-4 border border-gray-200 rounded-lg bg-white">
          <div className="flex h-5 items-center gap-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-[18px] w-14 rounded" />
          </div>
          <div className="mt-1 flex h-4 items-center"><Skeleton className="h-3 w-48" /></div>
          <div className="mt-1 flex h-4 items-center"><Skeleton className="h-3 w-80 max-w-full" /></div>
        </div>
      ))}
    </div>
    <div className="flex h-4 items-center"><Skeleton className="h-3 w-96 max-w-full" /></div>
  </SkeletonRegion>
);
