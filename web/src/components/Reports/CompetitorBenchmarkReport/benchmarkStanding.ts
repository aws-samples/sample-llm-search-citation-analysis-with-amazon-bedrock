import type { BrandLeaderboardRow } from '../../../types';

/** Where your brand stands among every brand the answers name. */
export interface BenchmarkStanding {
  /** Your brand's place in the leaderboard (by visibility score, 1 = first); `null` when no answer names it. */
  readonly rank: number | null;
  /** The brand with the largest share of voice (the leaderboard's first on a tie); `null` before any share. */
  readonly leader: BrandLeaderboardRow | null;
  readonly brandsNamed: number;
}

function largerShare(leader: BrandLeaderboardRow | null, brand: BrandLeaderboardRow): BrandLeaderboardRow | null {
  if (brand.share_of_voice === null) return leader;
  const leading = leader?.share_of_voice ?? null;
  return leading === null || brand.share_of_voice > leading ? brand : leader;
}

/** Your rank, the share-of-voice leader and the brand count of a leaderboard sorted by visibility score.
 *
 * `brands` may be the top of a longer leaderboard (`/visibility` lists its most visible brands, then
 * yours wherever it ranks): the rank is then the row's `position`, and `brandsTotal` counts every brand.
 */
export function benchmarkStanding(brands: readonly BrandLeaderboardRow[], brandsTotal: number = brands.length): BenchmarkStanding {
  const ours = brands.findIndex((brand) => brand.classification === 'first_party');
  return {
    rank: ours === -1 ? null : brands[ours].position ?? ours + 1,
    leader: brands.reduce<BrandLeaderboardRow | null>(largerShare, null),
    brandsNamed: brandsTotal,
  };
}
