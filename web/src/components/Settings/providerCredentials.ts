/**
 * How Settings › AI Providers reads the credential fields of `GET /providers`:
 * a provider whose key is several inputs (`credential_fields`), a provider
 * that borrows another one's key (`credential_from`), and the "SEO data"
 * group the `seo` providers sit in.
 */
import type { ProviderConfig } from '../../hooks/useProviderConfig';

export type JoinedCredential =
  | {
    readonly ok: true;
    readonly apiKey: string;
  }
  | {
    readonly ok: false;
    readonly reason: string;
  };

/** "Login" for `login`: the label of a credential input. */
export function credentialFieldLabel(field: string): string {
  return field === '' ? field : `${field.charAt(0).toUpperCase()}${field.slice(1).replaceAll('_', ' ')}`;
}

/**
 * The inputs joined as `"<login>:<password>"`, each trimmed. Every input is
 * required, and all but the last may not hold a `:` (the server splits on
 * the first one).
 */
export function joinCredential(fields: readonly string[], values: readonly string[]): JoinedCredential {
  const trimmed = fields.map((_field, index) => (values[index] ?? '').trim());
  const empty = fields.find((_field, index) => trimmed[index] === '');
  if (empty !== undefined) {
    return {
      ok: false,
      reason: `${credentialFieldLabel(empty)} cannot be empty`,
    };
  }
  const withColon = fields.slice(0, -1).find((_field, index) => trimmed[index].includes(':'));
  if (withColon !== undefined) {
    return {
      ok: false,
      reason: `${credentialFieldLabel(withColon)} cannot contain ":"`,
    };
  }
  return {
    ok: true,
    apiKey: trimmed.join(':'),
  };
}

/**
 * The rows as the cards show them: a provider that borrows another one's key
 * counts as configured exactly when that provider has a key (it stores none
 * of its own); a source missing from the list leaves the row as sent.
 */
export function withBorrowedCredentials(providers: readonly ProviderConfig[]): ProviderConfig[] {
  const configured = new Map(providers.map((provider) => [provider.id, provider.configured]));
  return providers.map((provider) => {
    const source = provider.credential_from === undefined ? undefined : configured.get(provider.credential_from);
    return source === undefined ? provider : {
      ...provider,
      configured: source,
    };
  });
}

export interface ProviderGroups {
  /** AI engines and search providers, in the server's order. */
  readonly engines: ProviderConfig[];
  /** The SEO data credentials (`type: 'seo'`), shown in their own group below. */
  readonly seo: ProviderConfig[];
}

export function groupProviders(providers: readonly ProviderConfig[]): ProviderGroups {
  return {
    engines: providers.filter((provider) => provider.type !== 'seo'),
    seo: providers.filter((provider) => provider.type === 'seo'),
  };
}
