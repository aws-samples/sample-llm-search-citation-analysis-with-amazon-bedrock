/**
 * The brand's Settings the SEO pages start from instead of asking for them again: the brand's names and its own
 * domains, and each competitor's domains (Settings › Brand Tracking, `GET /brand-config`).
 */
import { apiGet } from './client';
import { decodeCompetitorDomains } from './competitorDomainsDecoders';
import { isStringArray } from './contentStudioDecoderPrimitives';
import { isRecord } from '../types/domain/keywordDecoders';

export interface CompetitorDomain {
  /** The competitor's name in Brand Tracking. */
  readonly name: string;
  readonly domain: string;
}

export interface BrandSettings {
  /** The first-party brand names, in Settings order. */
  readonly brandNames: readonly string[];
  /** The brand's own domains (`first_party_domains`), in Settings order. */
  readonly ownedDomains: readonly string[];
  /** Every competitor domain, one entry per domain, without the brand's own. */
  readonly competitorDomains: readonly CompetitorDomain[];
}

export const NO_BRAND_SETTINGS: BrandSettings = {
  brandNames: [],
  ownedDomains: [],
  competitorDomains: [],
};

function trimmedStrings(value: unknown): string[] {
  if (!isStringArray(value)) return [];
  return [...new Set(value.map((entry) => entry.trim()).filter((entry) => entry !== ''))];
}

/** Competitor domains as `{name, domain}` entries, first occurrence of a domain kept, owned domains left out. */
export function competitorDomainEntries(domains: Record<string, readonly string[]>, owned: readonly string[]): CompetitorDomain[] {
  const seen = new Set(owned);
  return Object.entries(domains).flatMap(([name, list]) => trimmedStrings(list).flatMap((domain) => {
    if (seen.has(domain)) return [];
    seen.add(domain);
    return [{
      name,
      domain,
    }];
  }));
}

/** The SEO-relevant part of a stored brand config; empty lists for anything missing or malformed. */
export function decodeBrandSettings(value: unknown): BrandSettings {
  if (!isRecord(value)) return NO_BRAND_SETTINGS;
  const tracked = isRecord(value.tracked_brands) ? value.tracked_brands : {};
  const ownedDomains = trimmedStrings(value.first_party_domains);
  return {
    brandNames: trimmedStrings(tracked.first_party),
    ownedDomains,
    competitorDomains: competitorDomainEntries(decodeCompetitorDomains(value.competitor_domains), ownedDomains),
  };
}

export async function fetchBrandSettings(signal?: AbortSignal): Promise<BrandSettings> {
  return decodeBrandSettings(await apiGet<unknown>('/brand-config', { signal }));
}
