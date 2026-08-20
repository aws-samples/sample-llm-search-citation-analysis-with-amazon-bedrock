/**
 * Turns the health fields recorded on a provider row into display copy.
 *
 * Context (AUDIT-2026-08-19): Anthropic answered every request with
 * `400 "Your credit balance is too low"` from 2026-08-14 onward and no surface
 * in the dashboard said so — a dead provider looked exactly like a provider
 * with nothing to report. The backend now classifies each failure and
 * auto-disables a provider after repeated credit/key rejections; this module
 * is the single place that decides what the user is told about it.
 */

export const PROVIDER_ERROR_CATEGORIES = [
  'insufficient_credit',
  'invalid_key',
  'rate_limited',
  'timeout',
  'unknown',
] as const;

export type ProviderErrorCategory = typeof PROVIDER_ERROR_CATEGORIES[number];

/**
 * Health fields `GET /api/providers` reports per provider. All optional: rows
 * written before the health tracking shipped carry none of them.
 */
export interface ProviderHealthRecord {
  last_error?: string;
  last_error_at?: string;
  last_error_category?: ProviderErrorCategory;
  last_success_at?: string;
  consecutive_failures?: number;
  disabled_reason?: string;
  auto_disabled?: boolean;
}

/** Critical problems stop the provider dead; the softer two are transient. */
export type ProviderHealthTone = 'ok' | 'warning' | 'critical';

export interface ProviderHealthDescriptor {
  readonly tone: ProviderHealthTone;
  /** Human-readable outcome, safe to render as the badge text. */
  readonly label: string;
  /** Timestamp the label refers to, for relative-time display. */
  readonly occurredAt?: string;
  /** Raw provider error, kept for debugging via `title`. */
  readonly rawError?: string;
  /** Set only when the backend switched the provider off by itself. */
  readonly autoDisabledNote?: string;
}

const CATEGORY_MESSAGES: Record<ProviderErrorCategory, string> = {
  insufficient_credit: 'No credit remaining on this provider account',
  invalid_key: 'API key rejected — check or replace the key',
  rate_limited: 'Rate limited by the provider',
  timeout: 'Provider did not respond in time',
  unknown: 'Provider returned an unrecognised error',
};

/** Condensed forms for the app-wide banner, which lists several providers. */
const CATEGORY_SUMMARIES: Record<ProviderErrorCategory, string> = {
  insufficient_credit: 'no credit remaining',
  invalid_key: 'API key rejected',
  rate_limited: 'rate limited by the provider',
  timeout: 'no response in time',
  unknown: 'an unrecognised error',
};

const CRITICAL_CATEGORIES: ProviderErrorCategory[] = ['insufficient_credit', 'invalid_key'];

/**
 * Accepts `string` rather than the union because nothing validates the wire
 * payload: an unrecognised category must degrade to `unknown`, not crash.
 */
function resolveCategory(category: string | undefined): ProviderErrorCategory {
  return PROVIDER_ERROR_CATEGORIES.find((known) => known === category) ?? 'unknown';
}

function toTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return isNaN(parsed) ? null : parsed;
}

/** A success newer than the last failure means the provider came back. */
function hasRecovered(record: ProviderHealthRecord): boolean {
  const successTime = toTimestamp(record.last_success_at);
  const errorTime = toTimestamp(record.last_error_at);
  if (successTime === null || errorTime === null) return false;
  return successTime > errorTime;
}

function hasFailure(record: ProviderHealthRecord): boolean {
  return record.last_error !== undefined || record.last_error_category !== undefined;
}

function toneForCategory(category: ProviderErrorCategory): ProviderHealthTone {
  return CRITICAL_CATEGORIES.includes(category) ? 'critical' : 'warning';
}

function describeAutoDisabled(record: ProviderHealthRecord): ProviderHealthDescriptor {
  const category = resolveCategory(record.last_error_category);
  const reason = record.disabled_reason ?? CATEGORY_MESSAGES[category];
  return {
    tone: 'critical',
    label: 'Switched off automatically',
    occurredAt: record.last_error_at,
    rawError: record.last_error,
    autoDisabledNote: `${reason}. Re-enabling is manual — fix the problem, then turn it back on.`,
  };
}

function describeFailure(record: ProviderHealthRecord): ProviderHealthDescriptor {
  const category = resolveCategory(record.last_error_category);
  return {
    tone: toneForCategory(category),
    label: CATEGORY_MESSAGES[category],
    occurredAt: record.last_error_at,
    rawError: record.last_error,
  };
}

export interface ProviderHealthSubject extends ProviderHealthRecord {configured: boolean;}

/**
 * The health story for one provider, or `null` when there is nothing to say
 * (no key configured, or configured but never used and never failed).
 */
export function describeProviderHealth(
  provider: ProviderHealthSubject
): ProviderHealthDescriptor | null {
  if (!provider.configured) return null;

  if (provider.auto_disabled === true) return describeAutoDisabled(provider);

  if (hasFailure(provider) && !hasRecovered(provider)) return describeFailure(provider);

  if (provider.last_success_at === undefined) return null;

  return {
    tone: 'ok',
    label: 'Healthy',
    occurredAt: provider.last_success_at,
  };
}

export interface UnhealthyProviderSummary {
  readonly id: string;
  readonly tone: ProviderHealthTone;
  /** One-line sentence naming the provider and the problem. */
  readonly summary: string;
}

export interface ProviderHealthCandidate extends ProviderHealthSubject {
  id: string;
  name: string;
  enabled: boolean;
}

function summarize(provider: ProviderHealthCandidate): string {
  const category = resolveCategory(provider.last_error_category);
  const cause = CATEGORY_SUMMARIES[category];
  return provider.auto_disabled === true
    ? `${provider.name} was switched off automatically: ${provider.disabled_reason ?? cause}`
    : `${provider.name} is not returning results: ${cause}`;
}

/**
 * Providers worth interrupting the user about, in input order.
 *
 * Auto-disabled providers are included even though `enabled` is false by
 * definition — they were enabled until the system turned them off, and they
 * are the single most urgent case. Filtering them out on `enabled` alone would
 * re-hide exactly the outage this feature exists to surface.
 */
export function findUnhealthyProviders(
  providers: readonly ProviderHealthCandidate[]
): UnhealthyProviderSummary[] {
  return providers
    .filter((provider) => provider.enabled || provider.auto_disabled === true)
    .flatMap((provider) => {
      const health = describeProviderHealth(provider);
      if (health === null || health.tone === 'ok') return [];
      return [{
        id: provider.id,
        tone: health.tone,
        summary: summarize(provider),
      }];
    });
}
