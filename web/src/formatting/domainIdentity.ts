/**
 * The canonical domain of a URL or bare domain, as the backend computes it
 * (`lambda/shared/kpi_engine.normalize_domain`): the host, lower-case, without
 * userinfo, port, leading or trailing dots, or a leading `www.`. `null` when
 * there is no host. `test-fixtures/domain-identity.json` pins both runtimes.
 */
const SCHEME = /^[a-z][a-z\d+.-]*:\/\//;

/** The input as an absolute URL the way Python's `urlparse` would split it, or `null` when it has no host part. */
function asParsableUrl(text: string): string | null {
  if (!text.includes('//')) {
    return `http://${text}`;
  }
  if (text.startsWith('//')) {
    return `http:${text}`;
  }
  return SCHEME.test(text) ? text : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function dropTrailingDots(host: string): string {
  return host.endsWith('.') ? dropTrailingDots(host.slice(0, -1)) : host;
}

export function normalizeDomain(value: string): string | null {
  const url = asParsableUrl(value.trim().toLowerCase());
  const host = (url === null ? null : hostOf(url)) ?? '';
  const withoutLeadingDots = host.replace(/^\.+/, '');
  const withoutWww = withoutLeadingDots.startsWith('www.') ? withoutLeadingDots.slice(4) : withoutLeadingDots;
  const domain = dropTrailingDots(withoutWww);
  return domain === '' ? null : domain;
}
