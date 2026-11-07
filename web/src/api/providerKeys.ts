/**
 * `POST /providers/{id}/validate` (Admin): checks a key against the provider
 * without saving it. For DataForSEO that is the free `user_data` call, so an
 * administrator can test a login before storing it. A 400 refusal ("API key
 * required") is read as a failed check, in the server's words.
 */
import { apiPost } from './client';
import { refusalMessage } from './providerModels';
import { isRecord } from '../types/domain/keywordDecoders';

export type ProviderKeyCheck =
  | { readonly valid: true }
  | {
    readonly valid: false;
    readonly error: string;
  };

const UNREADABLE_ANSWER = 'The provider check returned an unreadable answer';

function decodeKeyCheck(payload: unknown): ProviderKeyCheck {
  if (isRecord(payload) && payload.valid === true) return { valid: true };
  if (isRecord(payload) && payload.valid === false) {
    return {
      valid: false,
      error: typeof payload.error === 'string' && payload.error !== '' ? payload.error : 'The provider rejected the key',
    };
  }
  return {
    valid: false,
    error: refusalMessage(payload) ?? UNREADABLE_ANSWER,
  };
}

export async function validateProviderKey(providerId: string, apiKey: string): Promise<ProviderKeyCheck> {
  const payload = await apiPost<unknown>(
    `/providers/${encodeURIComponent(providerId)}/validate`,
    { api_key: apiKey },
    { acceptedJsonStatuses: [400] },
  );
  return decodeKeyCheck(payload);
}
