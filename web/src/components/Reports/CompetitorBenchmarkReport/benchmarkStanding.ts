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

/** Your rank, the share-of-voice leader and the brand count of a leaderboard sorted by visibility score. */
export function benchmarkStanding(brands: readonly BrandLeaderboardRow[]): BenchmarkStanding {
  const index = brands.findIndex((brand) => brand.classification === 'first_party');
  return {
    rank: index === -1 ? null : index + 1,
    leader: brands.reduce<BrandLeaderboardRow | null>(largerShare, null),
    brandsNamed: brands.length,
  };
}
