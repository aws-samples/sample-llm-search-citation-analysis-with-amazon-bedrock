/**
 * The domains the SEO lookup pages start from, read from Settings › Brand Tracking: the brand's own domains
 * (the first one is the default target) and its competitors' domains, offered as quick picks.
 */
import { useMemo } from 'react';
import type { BrandSettings } from '../../api/brandSettings';
import { useBrandSettings } from '../../hooks/useSeoSettings';

export interface DomainPick {
  readonly domain: string;
  readonly role: 'owned' | 'competitor';
  /** The competitor's name in Brand Tracking; `null` for the brand's own domains. */
  readonly competitor: string | null;
}

/** The brand's own domains, then its competitors' domains, in Settings order. */
export function settingsDomainPicks(settings: BrandSettings): DomainPick[] {
  return [
    ...settings.ownedDomains.map((domain): DomainPick => ({
      domain,
      role: 'owned',
      competitor: null,
    })),
    ...settings.competitorDomains.map(({
      name, domain
    }): DomainPick => ({
      domain,
      role: 'competitor',
      competitor: name,
    })),
  ];
}

/** Every pick once (first occurrence kept), own domains first, otherwise in the order given. */
export function mergeDomainPicks(...lists: ReadonlyArray<readonly DomainPick[]>): DomainPick[] {
  const seen = new Set<string>();
  const unique = lists.flat().filter((pick) => {
    if (seen.has(pick.domain)) return false;
    seen.add(pick.domain);
    return true;
  });
  return [...unique.filter((pick) => pick.role === 'owned'), ...unique.filter((pick) => pick.role === 'competitor')];
}

export interface SettingsDomains {
  /** Own domains first, then competitors' domains. */
  readonly picks: readonly DomainPick[];
  /** The brand's own domain (first in Brand Tracking): the target when the input is empty. */
  readonly ownDomain: string | null;
  /** Brand Tracking was read and has no own domain: the page points to Settings instead of guessing. */
  readonly missingOwnDomain: boolean;
}

/** The Brand Tracking domains of the SEO lookup pages (a free read of the main API; nothing paid). */
export function useSettingsDomains(): SettingsDomains {
  const {
    data, loaded, error
  } = useBrandSettings();
  return useMemo(() => ({
    picks: settingsDomainPicks(data),
    ownDomain: data.ownedDomains[0] ?? null,
    missingOwnDomain: loaded && error === null && data.ownedDomains.length === 0,
  }), [data, loaded, error]);
}

/** The target a search form submits: what was typed, else the brand's own domain, else nothing. */
export function effectiveTarget(typed: string, ownDomain: string | null): string {
  const trimmed = typed.trim();
  return trimmed === '' ? (ownDomain ?? '') : trimmed;
}

/** The submit label: "Analyze <own domain>" while the input is empty and Settings has an own domain. */
export function submitLabel(typed: string, ownDomain: string | null, label: string): string {
  return typed.trim() === '' && ownDomain !== null ? `Analyze ${ownDomain}` : label;
}
