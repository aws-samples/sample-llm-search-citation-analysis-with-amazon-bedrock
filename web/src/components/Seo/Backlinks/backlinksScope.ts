/**
 * The scope a typed target implies, as the server reads it
 * (`lambda/shared/backlinks_target.py`): a root domain means its subdomains,
 * a URL with a path means that subfolder, unreadable text means the domain.
 * The scope select follows it until the user picks a scope.
 */
import type { BacklinksScope } from '../../../types/api/seoBacklinks';

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

export function impliedScope(input: string): BacklinksScope {
  const trimmed = input.trim();
  if (trimmed === '') return 'subdomains';
  try {
    const url = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
    return [...url.pathname].every((character) => character === '/') ? 'subdomains' : 'subfolder';
  } catch {
    return 'domain';
  }
}

/** Whether `scope` can be asked for `input`: a subfolder needs a path. */
export function scopeAllowed(input: string, scope: BacklinksScope): boolean {
  return scope !== 'subfolder' || impliedScope(input) === 'subfolder';
}

/** Whether the target has a history chart: domain and subdomain scopes only. */
export function hasHistory(scope: BacklinksScope): boolean {
  return scope === 'domain' || scope === 'subdomains';
}
