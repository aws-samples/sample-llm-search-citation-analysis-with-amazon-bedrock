/**
 * What the local SEO tabs read from Settings instead of asking again: the brand's first name and own domain
 * (Brand Tracking) and the header market's active keywords (Keywords). The point of every search is the header
 * market's city (`useLocalSeoMarket`). Each hint links to the Settings section that lacks a value a tab needs.
 */
import type { LocalSeoMarket } from '../../../hooks/useLocalSeoMarket';
import {
  useBrandSettings, useMarketKeywords
} from '../../../hooks/useSeoSettings';
import { SettingsHint } from '../SettingsHint';

export interface LocalSeoSettings {
  /** The first first-party brand name, `''` when Brand Tracking has none. */
  readonly brandName: string;
  /** The brand's first own domain, `''` when Brand Tracking has none. */
  readonly ownedDomain: string;
  /** Brand Tracking has been read (an empty value is then the answer, not the wait for one). */
  readonly brandLoaded: boolean;
  /** The header market's active keywords, offered in the keyword fields. */
  readonly keywords: readonly string[];
}

export function useLocalSeoSettings(): LocalSeoSettings {
  const brand = useBrandSettings();
  const keywords = useMarketKeywords();
  return {
    brandName: brand.data.brandNames[0] ?? '',
    ownedDomain: brand.data.ownedDomains[0] ?? '',
    brandLoaded: brand.loaded,
    keywords: keywords.data,
  };
}

/** The label of the "your business" field: left empty, the brand's own domain is matched. */
export function targetLabel(settings: LocalSeoSettings): string {
  return `Your business (empty: ${settings.ownedDomain === '' ? 'your domains' : settings.ownedDomain})`;
}

export function BrandNameHint({ settings }: { readonly settings: LocalSeoSettings }) {
  if (!settings.brandLoaded || settings.brandName !== '') return null;
  return <SettingsHint section="brand-config">Add the brand&apos;s name and the business field starts from it.</SettingsHint>;
}

export function OwnedDomainHint({ settings }: { readonly settings: LocalSeoSettings }) {
  if (!settings.brandLoaded || settings.ownedDomain !== '') return null;
  return (
    <SettingsHint section="brand-config">
      Your business is found by the brand&apos;s own domain: add it, or name the business above.
    </SettingsHint>
  );
}

/** Whether a search can fall back on the header market's city coordinates. */
export function marketHasPoint(market: LocalSeoMarket): boolean {
  return market.latitude !== null && market.longitude !== null;
}

/** The props of a tab that searches around the header market for the brand's business. */
export interface LocalTabProps {
  readonly market: LocalSeoMarket;
  readonly settings: LocalSeoSettings;
}

export function MarketPointHint({ market }: { readonly market: LocalSeoMarket }) {
  if (marketHasPoint(market)) return null;
  return (
    <SettingsHint section="markets">
      {market.marketField.market_id === undefined
        ? 'Pick a market with a city in the header, or type a latitude and longitude.'
        : 'The header market has no city to search around: type a latitude and longitude, or give the market a city.'}
    </SettingsHint>
  );
}

/** The hints of a tab that finds "your business" in results: the own domain to match and the market city. */
export function TargetTabHints({
  market, settings
}: LocalTabProps) {
  return (
    <>
      <OwnedDomainHint settings={settings} />
      <MarketPointHint market={market} />
    </>
  );
}
