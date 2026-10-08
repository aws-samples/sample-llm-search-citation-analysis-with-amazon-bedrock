import {
  Skeleton, SkeletonCards, SkeletonLines, SkeletonRegion
} from '../ui/Skeleton';

/*
 * Placeholders the insights views (Prompt Insights, Citation Gaps, Action
 * Center) share while the answer for the selected scope is in flight. Each is
 * sized like the block it stands in for, so the answer lands without moving
 * the page.
 */

const TILE_IDS = ['tile-a', 'tile-b', 'tile-c', 'tile-d'] as const;

interface StatTilesSkeletonProps {
  /** How many summary tiles the view shows. */
  readonly count: 3 | 4;
  /** The grid's columns, as on the real tiles. */
  readonly gridClassName: string;
  /** Tile height; the default matches a label over a `text-xl sm:text-2xl` figure. */
  readonly tileClassName?: string;
}

/** The row of summary tiles (counts, coverage) above a view's results. */
export const StatTilesSkeleton = ({
  count, gridClassName, tileClassName = 'h-[68px] sm:h-[84px]'
}: StatTilesSkeletonProps) => (
  <div className={`grid gap-3 sm:gap-4 ${gridClassName}`}>
    {TILE_IDS.slice(0, count).map((id) => <Skeleton key={id} className={`rounded-lg ${tileClassName}`} />)}
  </div>
);

/** A two-column grid of result cards (prompt or gap cards), `cardClassName` setting their height. */
export const InsightCardGridSkeleton = ({ cardClassName }: { readonly cardClassName: string }) => (
  <SkeletonCards count={4} gridClassName="grid-cols-1 lg:grid-cols-2" cardClassName={cardClassName} />
);

/** Inline stand-in for a tab's count, e.g. the `18` of "Winning (18)". */
export const CountSkeleton = () => (
  <span aria-hidden="true" className="skeleton inline-block h-3 w-4 align-middle" />
);

const RECOMMENDATION_CARD_IDS = ['card-a', 'card-b', 'card-c', 'card-d'] as const;

/**
 * Action Center while recommendations are generated: the three priority tiles
 * (taller from `sm`, where they show a hint line) over a stack of collapsed
 * recommendation cards.
 */
export const RecommendationsSkeleton = ({ useLlm }: { readonly useLlm: boolean }) => (
  <SkeletonRegion
    label={useLlm ? 'Generating AI-enhanced recommendations' : 'Generating recommendations'}
    className="space-y-6"
  >
    <StatTilesSkeleton count={3} gridClassName="grid-cols-3" tileClassName="h-[68px] sm:h-[100px]" />
    <div className="space-y-4">
      {RECOMMENDATION_CARD_IDS.map((id) => (
        <div key={id} className="bg-white rounded-lg shadow p-5 flex items-start gap-4">
          <Skeleton className="w-5 h-5 mt-0.5 rounded" />
          <div className="flex-1">
            <Skeleton className="h-4 w-1/2 mt-1 mb-4" />
            <SkeletonLines lines={2} />
          </div>
        </div>
      ))}
    </div>
  </SkeletonRegion>
);
