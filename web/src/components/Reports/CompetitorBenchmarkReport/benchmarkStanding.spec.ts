import {
  describe, it, expect
} from 'vitest';
import { benchmarkStanding } from './benchmarkStanding';
import {
  buildBrandRow, buildLatestBrands
} from '../layout/reportPayload-fixtures';

describe('benchmarkStanding', () => {
  it('ranks your brand by its place in the leaderboard', () => {
    const brands = [buildBrandRow('Adidas'), buildBrandRow('Puma'), buildBrandRow('Nike', { classification: 'first_party' })];

    expect(benchmarkStanding(brands).rank).toBe(3);
  });

  it('has no rank for a brand no answer names', () => {
    expect(benchmarkStanding([buildBrandRow('Adidas')]).rank).toBeNull();
  });

  it.each([
    {
      name: 'picks the brand with the largest share of voice as the leader',
      brands: [buildBrandRow('Nike', { share_of_voice: 10 }), buildBrandRow('Adidas', { share_of_voice: 40 })],
      leader: 'Adidas',
    },
    {
      name: 'keeps the leaderboard\'s first brand as the leader on a tied share',
      brands: [buildBrandRow('Nike'), buildBrandRow('Adidas')],
      leader: 'Nike',
    },
    {
      name: 'skips brands without a share of voice when picking the leader',
      brands: [buildBrandRow('Nike', { share_of_voice: null }), buildBrandRow('Adidas', { share_of_voice: 5 })],
      leader: 'Adidas',
    },
    {
      name: 'takes a brand with a zero share as the leader when no brand has more',
      brands: [buildBrandRow('Nike', { share_of_voice: 0 })],
      leader: 'Nike',
    },
  ])('$name', ({
    brands, leader,
  }) => {
    expect(benchmarkStanding(brands).leader?.name).toBe(leader);
  });

  it('has no leader before any brand has a share', () => {
    expect(benchmarkStanding([buildBrandRow('Nike', { share_of_voice: null })]).leader).toBeNull();
  });

  it('counts every brand named', () => {
    expect(benchmarkStanding(buildLatestBrands()).brandsNamed).toBe(3);
  });

  it('stands nowhere in an empty leaderboard', () => {
    expect(benchmarkStanding([])).toStrictEqual({
      rank: null,
      leader: null,
      brandsNamed: 0,
    });
  });
});
