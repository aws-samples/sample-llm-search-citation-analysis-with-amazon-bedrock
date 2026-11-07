/**
 * The pages the Lighthouse form starts from, read from what the app already knows instead of asked again: the
 * homepage of the brand's own domain (Settings › Brand Tracking) and the pages the latest site audit crawled.
 */
import {
  useMemo, useState
} from 'react';
import { fetchAuditPageUrls } from '../../../api/seoPerformance';
import {
  useSiteAuditLoad, type SiteAuditLoadState
} from '../../../hooks/useSiteAuditLoad';
import type { LighthouseSample } from '../../../types/api/seoPerformance';

/** At most this many audit pages are offered as suggestions. */
export const SUGGESTED_PAGES_LIMIT = 50;

const NO_PAGES: readonly string[] = [];

/** `https://<first own domain>/`, or `''` when Brand Tracking has no own domain. */
export function ownedHomepage(ownedDomains: readonly string[]): string {
  const withoutScheme = (ownedDomains[0] ?? '').trim().replace(/^https?:\/\//i, '');
  const host = withoutScheme.split(/[/?#]/, 1)[0] ?? '';
  return host === '' ? '' : `https://${host}/`;
}

/** The sample pages first, then the crawled pages, without repeats, capped at `SUGGESTED_PAGES_LIMIT`. */
export function suggestedPages(samplePages: readonly string[], crawledPages: readonly string[]): string[] {
  return [...new Set([...samplePages, ...crawledPages])].slice(0, SUGGESTED_PAGES_LIMIT);
}

export interface AuditPageSuggestions {
  readonly pages: readonly string[];
  /** Reads the latest finished audit's crawled pages (free), once; called when the URL field is first focused. */
  readonly load: () => void;
}

/** Page URL suggestions from the latest finished audit: its sample pages at once, its crawled pages on demand. */
export function useAuditPageSuggestions(sample: SiteAuditLoadState<LighthouseSample>): AuditPageSuggestions {
  const [wanted, setWanted] = useState(false);
  const answered = sample.status === 'success' ? sample.value : null;
  const auditId = answered?.audit?.audit_id ?? null;
  const crawled = useSiteAuditLoad(
    wanted && auditId !== null ? `audit-pages:${auditId}` : null,
    (signal) => fetchAuditPageUrls(auditId ?? '', SUGGESTED_PAGES_LIMIT, { signal })
  );
  const samplePages = answered?.pages ?? NO_PAGES;
  const crawledPages = crawled.state.status === 'success' ? crawled.state.value : NO_PAGES;
  const pages = useMemo(() => suggestedPages(samplePages, crawledPages), [samplePages, crawledPages]);
  return {
    pages,
    load: () => { setWanted(true); },
  };
}
