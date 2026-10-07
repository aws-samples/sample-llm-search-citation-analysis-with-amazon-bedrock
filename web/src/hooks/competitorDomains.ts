/**
 * Edits of the competitor domains on the Brand Tracking form. Domains are
 * kept per competitor name, already normalised (`formatting/domainIdentity`),
 * at most `MAX_DOMAINS_PER_COMPETITOR` each, as `manage-brand-config` accepts.
 */
import type { CompetitorDomains } from '../api/competitorDomainsDecoders';

export const MAX_DOMAINS_PER_COMPETITOR = 10;

/** `domains` with `domain` added to `brand`, unless it is there already or the brand is at the cap. */
export function withCompetitorDomain(domains: CompetitorDomains, brand: string, domain: string): CompetitorDomains {
  const current = domains[brand] ?? [];
  if (current.includes(domain) || current.length >= MAX_DOMAINS_PER_COMPETITOR) return domains;
  return {
    ...domains,
    [brand]: [...current, domain] 
  };
}

/** `domains` with `domain` taken off `brand`; a brand left with none is dropped. */
export function withoutCompetitorDomain(domains: CompetitorDomains, brand: string, domain: string): CompetitorDomains {
  const remaining = (domains[brand] ?? []).filter((saved) => saved !== domain);
  const rest = Object.fromEntries(Object.entries(domains).filter(([name]) => name !== brand));
  return remaining.length > 0 ? {
    ...rest,
    [brand]: remaining 
  } : rest;
}

/** The domains of the tracked `competitors` only, so a removed competitor's domains are not saved. */
export function domainsOfCompetitors(domains: CompetitorDomains, competitors: string[]): CompetitorDomains {
  return Object.fromEntries(Object.entries(domains).filter(([name, list]) => competitors.includes(name) && list.length > 0));
}

/** Earlier suggestions with `next` added: each brand keeps its earlier domains, then the new ones it lacked. */
export function mergeSuggestedDomains(earlier: CompetitorDomains, next: CompetitorDomains): CompetitorDomains {
  const merged = { ...earlier };
  for (const [brand, list] of Object.entries(next)) {
    merged[brand] = [...new Set([...(earlier[brand] ?? []), ...list])];
  }
  return merged;
}

/** The domains offered for one competitor: its saved ones, then the suggestions not saved yet. */
export function competitorDomainChoices(saved: string[], suggested: string[]): string[] {
  return [...new Set([...saved, ...suggested])];
}
