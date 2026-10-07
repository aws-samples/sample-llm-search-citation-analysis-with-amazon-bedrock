/**
 * Runtime guards for competitor domains: the `competitor_domains` map a
 * stored brand config carries, and the per-competitor `domains` that
 * `POST /brand-config/find-competitors` suggests in `competitor_details`.
 */
import { isRecord } from '../types/domain/keywordDecoders';
import { isStringArray } from './contentStudioDecoderPrimitives';

/** Competitor name to its domains. */
export type CompetitorDomains = Record<string, string[]>;

/** The `{name: [domain, ...]}` entries of `value` whose domains are a list of strings; `{}` when it is no map. */
export function decodeCompetitorDomains(value: unknown): CompetitorDomains {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => isStringArray(entry[1])));
}

/** The suggested domains of each named entry of `competitor_details`; entries without a name or domains are skipped. */
export function decodeSuggestedDomains(details: unknown): CompetitorDomains {
  if (!Array.isArray(details)) return {};
  const entries = details.flatMap((detail: unknown): Array<[string, string[]]> => {
    if (!isRecord(detail) || typeof detail.name !== 'string' || !isStringArray(detail.domains) || detail.domains.length === 0) {
      return [];
    }
    return [[detail.name, detail.domains]];
  });
  return Object.fromEntries(entries);
}
