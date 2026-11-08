/**
 * Runtime decoder for `GET /providers` (Settings › AI Providers).
 *
 * A row needs its id, name, description, docs link and the enabled /
 * configured flags; one without them is dropped rather than rendered as a
 * broken card. The fields that describe the provider kind and its credential (`type`, `credential_fields`,
 * `credential_from`) are kept only in their documented shapes, so a card
 * never offers a login form or borrows a credential because of a malformed
 * row. Health fields pass through as before.
 */
import type { ProviderConfig } from '../hooks/useProviderConfig';
import type { ProviderType } from '../constants/providers';
import type { ProviderCredentialFields } from '../types/api/providers';
import { isRecord } from '../types/domain/keywordDecoders';

type DecodedFields = 'model' | 'masked_key' | 'last_updated' | keyof ProviderCredentialFields;

/** A row as sent: the decoded fields still unchecked. */
type WireProviderRow = Omit<ProviderConfig, DecodedFields> & { readonly [field in DecodedFields]?: unknown };

const PROVIDER_TYPES: readonly ProviderType[] = ['llm', 'search', 'seo'];

function isProviderType(value: unknown): value is ProviderType {
  return PROVIDER_TYPES.some((type) => type === value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry !== '');
}

/** The fields a card cannot be drawn without. */
const REQUIRED_STRINGS = ['id', 'name', 'description', 'docs_url'] as const;
const REQUIRED_FLAGS = ['enabled', 'configured'] as const;

function isWireProviderRow(value: unknown): value is WireProviderRow {
  if (!isRecord(value)) return false;
  return REQUIRED_STRINGS.every((field) => typeof value[field] === 'string')
    && REQUIRED_FLAGS.every((field) => typeof value[field] === 'boolean');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function credentialFieldsOf(type: unknown, fields: unknown, from: unknown): ProviderCredentialFields {
  return {
    ...(isProviderType(type) ? { type } : {}),
    ...(isNonEmptyStringArray(fields) ? { credential_fields: fields } : {}),
    ...(typeof from === 'string' && from !== '' ? { credential_from: from } : {}),
  };
}

function decodeProviderRow(row: WireProviderRow): ProviderConfig {
  const {
    model, masked_key: maskedKey, last_updated: lastUpdated, type, credential_fields: fields, credential_from: from, ...rest
  } = row;
  return {
    ...rest,
    // A provider without a model (the SEO data credential) sends none.
    model: typeof model === 'string' ? model : '',
    masked_key: stringOrNull(maskedKey),
    last_updated: stringOrNull(lastUpdated),
    ...credentialFieldsOf(type, fields, from),
  };
}

/** The provider rows of a `GET /providers` body; `null` when it is not one. */
export function decodeProviders(payload: unknown): ProviderConfig[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.providers)) return null;
  return payload.providers.filter(isWireProviderRow).map(decodeProviderRow);
}
