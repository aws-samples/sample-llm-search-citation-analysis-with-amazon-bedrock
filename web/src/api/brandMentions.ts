/**
 * One-off read of `/brand-mentions` for a scope at one exact run — what the
 * per-hotel Excel export attaches as its raw-data sheet. The interactive
 * Brands view keeps `useBrandMentions`, which owns its own loading state.
 */
import { apiGet } from './client';
import type {
  BrandMentionsResponse, ReportScope
} from '../types';
import { reportScopeParams } from '../components/ui/reportScope';
import { isBrandMentionsResponse } from '../hooks/useBrandMentions';

export class InvalidBrandMentionsResponseError extends TypeError {
  constructor() {
    super('Brand mentions API returned an invalid response');
    this.name = 'InvalidBrandMentionsResponseError';
  }
}

/** `marketId` is the header's market choice (`null` = every market). */
export async function fetchBrandMentionsAtRun(
  scope: ReportScope, timestamp: string, marketId: string | null = null
): Promise<BrandMentionsResponse> {
  const payload = await apiGet<unknown>('/brand-mentions', {
    params: {
      ...reportScopeParams(scope, marketId),
      timestamp,
    },
  });
  if (!isBrandMentionsResponse(payload)) throw new InvalidBrandMentionsResponseError();
  return payload;
}
