import {
  useCallback, useState
} from 'react';
import { fetchBusinessProfile } from '../api/seoLocal';
import {
  identityFields, type IdentityInput
} from '../components/Seo/LocalSeo/localSeoRequest';
import type {
  BusinessIdentity, LocalPoint, ProfileRequest, ProfileResponse
} from '../types/api/seoLocal';
import {
  useSeoRequest, type SeoRequestState
} from './useKeywordExplorerRequest';

export interface LocalSeoProfile {
  readonly identity: IdentityInput;
  readonly setIdentity: (identity: IdentityInput) => void;
  /** The identity of the profile on screen (what reviews, updates and Q&A ask about). */
  readonly asked: BusinessIdentity | null;
  readonly state: SeoRequestState<ProfileResponse>;
  /** One paid profile lookup for `identity` (the form's, or a business opened from a list). */
  readonly load: (identity: IdentityInput, point: LocalPoint) => void;
}

/**
 * The Business profile tab's state, kept by the page so a business opened elsewhere loads on that click. Until the
 * user edits it or opens a business, the identity is the business named `defaultName` (the brand's Settings name).
 */
export function useLocalSeoProfile(defaultName = ''): LocalSeoProfile {
  const request = useSeoRequest<ProfileRequest, ProfileResponse>(fetchBusinessProfile);
  const [chosen, setIdentity] = useState<IdentityInput | null>(null);
  const identity: IdentityInput = chosen ?? {
    kind: 'name',
    value: defaultName,
  };
  const [asked, setAsked] = useState<BusinessIdentity | null>(null);
  const { run } = request;

  const load = useCallback((target: IdentityInput, point: LocalPoint) => {
    const fields = identityFields(target);
    if (fields === null) return;
    setIdentity(target);
    setAsked(fields);
    void run({
      ...fields,
      ...point 
    });
  }, [run]);

  return {
    identity,
    setIdentity,
    asked,
    state: request.state,
    load 
  };
}
