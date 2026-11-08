/**
 * Fields of a `GET /providers` row beyond the key, model and health ones:
 * which kind of provider it is and how it is credentialled.
 */
import type { ProviderType } from '../../constants/providers';

export interface ProviderCredentialFields {
  /** `llm` answer engine, `search` provider, or `seo` data credential (neither); absent on old servers. */
  type?: ProviderType;
  /** The inputs a key is made of (`['login', 'password']` for DataForSEO), joined with `:` when saved. */
  credential_fields?: string[];
  /** The provider whose stored key this one uses (no key field of its own). */
  credential_from?: string;
}
