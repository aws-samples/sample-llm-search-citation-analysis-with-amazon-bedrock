import {
  Skeleton, SkeletonLines, SkeletonRegion
} from '../ui/Skeleton';

const CARD_IDS = ['card-a', 'card-b', 'card-c', 'card-d'] as const;

interface ListCardSkeletonProps {
  /** Card padding, as on the real card. */
  readonly paddingClassName: string;
  /** Lines of body text under the title (description, preview). */
  readonly lines: number;
  /** The real card's trailing control (Create Content button, delete icon). */
  readonly actionClassName: string;
}

/** A list card: icon tile, title, metadata, body lines and the trailing action. */
const ListCardSkeleton = ({
  paddingClassName, lines, actionClassName
}: ListCardSkeletonProps) => (
  <div className={`bg-white rounded-lg border border-gray-200 ${paddingClassName}`}>
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="flex items-start gap-3 sm:gap-4 flex-1">
        <Skeleton className="w-9 h-9 rounded-lg shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex h-6 items-center gap-2 mb-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <SkeletonLines lines={lines} className="mb-3" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <Skeleton className={`rounded-lg ${actionClassName}`} />
    </div>
  </div>
);

/** The Content Ideas list while the first ideas load. */
export const ContentIdeasSkeleton = () => (
  <SkeletonRegion label="Analyzing your data for content opportunities" className="grid gap-4">
    {CARD_IDS.map((id) => (
      <ListCardSkeleton key={id} paddingClassName="p-4 sm:p-5" lines={2} actionClassName="h-9 w-full sm:w-36" />
    ))}
  </SkeletonRegion>
);

/** The Generated Content list while the first history page loads. */
export const ContentHistorySkeleton = () => (
  <SkeletonRegion label="Loading content history" className="space-y-3">
    {CARD_IDS.map((id) => (
      <ListCardSkeleton key={id} paddingClassName="p-4" lines={1} actionClassName="h-8 w-8 self-end sm:self-auto" />
    ))}
  </SkeletonRegion>
);

/** Holds the "n high priority" badge's place on the Content Ideas tab until the ideas arrive. */
export const TabBadgeSkeleton = () => (
  <span aria-hidden="true" className="skeleton ml-2 inline-block h-5 w-[6.5rem] rounded-full align-middle" />
);

/** Card heights of the Content Brief form's sections: scope, strategy, mode, prompt editor, language and submit. */
const BRIEF_SECTIONS = [
  ['scope', 'h-[260px]'],
  ['strategy', 'h-40'],
  ['mode', 'h-40'],
  ['prompt', 'h-80'],
  ['submit', 'h-[86px]'],
] as const;

/** The Content Brief form while the keyword groups it scopes by load. */
export const GroupBriefFormSkeleton = () => (
  <SkeletonRegion label="Loading keyword groups" className="space-y-6">
    <div>
      <div className="flex h-7 items-center"><Skeleton className="h-5 w-40" /></div>
      <div className="mt-1 flex h-5 items-center"><Skeleton className="h-3.5 w-96 max-w-full" /></div>
    </div>
    {BRIEF_SECTIONS.map(([id, heightClassName]) => (
      <div key={id} className={`rounded-xl border border-gray-200 bg-white p-5 ${heightClassName}`}>
        <Skeleton className="h-3.5 w-32 mb-4" />
        <SkeletonLines lines={2} />
      </div>
    ))}
  </SkeletonRegion>
);
