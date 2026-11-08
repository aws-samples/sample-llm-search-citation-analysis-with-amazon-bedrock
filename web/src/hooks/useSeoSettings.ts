/**
 * What the SEO pages read from Settings so they never ask for it again: the brand's domains and names
 * (Brand Tracking) and the active keywords of the header market (Keywords). Both are free reads of the main API.
 */
import { useMemo } from 'react';
import {
  NO_BRAND_SETTINGS, fetchBrandSettings, type BrandSettings
} from '../api/brandSettings';
import { fetchAllKeywords } from '../api/keywordPages';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
import { keywordMarketId } from '../components/Markets/marketSelection';
import { getErrorMessage } from '../infrastructure';
import type { Keyword } from '../types';
import {
  useGuardedLoad, type GuardedLoadSource
} from './useGuardedLoad';

export interface SettingsRead<TValue> {
  readonly data: TValue;
  /** The first read has settled (an empty `data` is the answer, not the wait for one). */
  readonly loaded: boolean;
  readonly error: string | null;
}

const BRAND_SETTINGS_SOURCE: GuardedLoadSource<BrandSettings> = {
  initial: NO_BRAND_SETTINGS,
  load: fetchBrandSettings,
  errorMessage: (failure) => getErrorMessage(failure),
};

/** Settings › Brand Tracking: the brand's names, own domains and competitor domains. */
export function useBrandSettings(): SettingsRead<BrandSettings> {
  const {
    data, settled, error
  } = useGuardedLoad(BRAND_SETTINGS_SOURCE);
  return {
    data,
    loaded: settled,
    error,
  };
}

const KEYWORDS_SOURCE: GuardedLoadSource<Keyword[]> = {
  initial: [],
  load: (signal) => fetchAllKeywords({ signal }),
  errorMessage: (failure) => getErrorMessage(failure),
};

/** The active keywords of `marketId` (`null` = every market), sorted by text. */
export function activeMarketKeywords(keywords: readonly Keyword[], marketId: string | null): string[] {
  const texts = keywords
    .filter((keyword) => keyword.status === 'active' && (marketId === null || keywordMarketId(keyword) === marketId))
    .map((keyword) => keyword.keyword.trim())
    .filter((text) => text !== '');
  return [...new Set(texts)].sort((left, right) => left.localeCompare(right));
}

/** Settings › Keywords: the active keyword texts of the header market (every market when they are combined). */
export function useMarketKeywords(): SettingsRead<string[]> {
  const marketId = useSelectedMarketId();
  const {
    data, settled, error
  } = useGuardedLoad(KEYWORDS_SOURCE);
  const keywords = useMemo(() => activeMarketKeywords(data, marketId), [data, marketId]);
  return {
    data: keywords,
    loaded: settled,
    error,
  };
}
