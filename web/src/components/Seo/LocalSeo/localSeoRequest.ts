/**
 * Form values of the local SEO tabs turned into request fields.
 *
 * A coordinate is sent only when both parts are valid numbers; otherwise no coordinate is sent and the API
 * uses the header market's city. A business is named by exactly one of a name, a Google cid or a place id.
 */
import type {
  BusinessIdentity, LocalPoint, LocalTarget
} from '../../../types/api/seoLocal';

export type IdentityKind = 'name' | 'cid' | 'place_id';

export interface PointInput {
  readonly latitude: string;
  readonly longitude: string;
}

export interface IdentityInput {
  readonly kind: IdentityKind;
  readonly value: string;
}

export const IDENTITY_LABELS: Record<IdentityKind, string> = {
  name: 'Business name',
  cid: 'Google cid',
  place_id: 'Place id',
};

/** No coordinate typed: the market city is used. */
export const EMPTY_POINT: PointInput = {
  latitude: '',
  longitude: '' 
};

function parsed(text: string, limit: number): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/** `{latitude, longitude}` when both are valid, else `{}` (the market city is used). */
export function pointFields(input: PointInput): Pick<LocalPoint, 'latitude' | 'longitude'> {
  const latitude = parsed(input.latitude, 90);
  const longitude = parsed(input.longitude, 180);
  return latitude === null || longitude === null ? {} : {
    latitude,
    longitude 
  };
}

/** Whether the point can be searched: a full coordinate, or none and a market city to fall back on. */
export function hasSearchPoint(input: PointInput, marketHasCity: boolean): boolean {
  return 'latitude' in pointFields(input) || marketHasCity;
}

export function identityFields(input: IdentityInput): BusinessIdentity | null {
  const value = input.value.trim();
  if (value === '') return null;
  if (input.kind === 'cid') return { cid: value };
  if (input.kind === 'place_id') return { place_id: value };
  return { name: value };
}

/** The business to find in results: the identity when given, else nothing (the brand's own domains). */
export function targetFields(input: IdentityInput): LocalTarget {
  return identityFields(input) ?? {};
}

/** The most precise identity of a business row: cid, then place id, then its name. */
export function identityOf(business: {
  cid: string | null;
  place_id: string | null;
  title: string 
}): IdentityInput {
  if (business.cid) return {
    kind: 'cid',
    value: business.cid 
  };
  if (business.place_id) return {
    kind: 'place_id',
    value: business.place_id 
  };
  return {
    kind: 'name',
    value: business.title 
  };
}

/** The colour band of a grid rank: top 3, top 10, lower, not found. */
export function rankBand(rank: number | null): 'top3' | 'top10' | 'low' | 'missing' {
  if (rank === null) return 'missing';
  if (rank <= 3) return 'top3';
  return rank <= 10 ? 'top10' : 'low';
}

/** Rows by `field`, highest first, rows without a value last (the provider's own order breaks ties). */
export function sortedByDescending<TRow>(rows: readonly TRow[], value: (row: TRow) => number | null): TRow[] {
  return rows
    .map((row, position) => ({
      row,
      position,
      key: value(row) 
    }))
    .sort((left, right) => {
      if (left.key === null || right.key === null) {
        return (left.key === null ? 1 : 0) - (right.key === null ? 1 : 0) || left.position - right.position;
      }
      return right.key - left.key || left.position - right.position;
    })
    .map((entry) => entry.row);
}
