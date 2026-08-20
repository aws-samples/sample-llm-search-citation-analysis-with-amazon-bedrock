import { fetchAuthSession } from 'aws-amplify/auth';

/** The Cognito group that gates administrative routes.
 *
 * Must match `ADMIN_GROUP` in `lambda/shared/auth.py` and the `groupName` of
 * the `adminUserPoolGroup` in `lib/constructs/auth.ts`. This copy only decides
 * what the UI offers — the server enforces the same name independently, so a
 * mismatch here degrades to a hidden-but-still-authorized tab rather than to a
 * privilege escalation.
 */
export const ADMIN_GROUP = 'Admin';

/** The claim Cognito puts group membership in, on both the ID and access token. */
const GROUPS_CLAIM = 'cognito:groups';

/**
 * Get the current user's JWT token for API authentication
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch (error) {
    console.error('Error fetching auth session:', error);
    return null;
  }
}

/**
 * Read the signed-in user's Cognito groups from the ID token.
 *
 * Returns an empty array when the session is missing, the claim is absent, or
 * the claim has an unexpected shape — so callers that gate on membership fail
 * closed and hide privileged UI rather than showing it.
 *
 * This is a display concern only. The authoritative check is
 * `shared.auth.require_group` in the Lambda handlers, which reads the same
 * claim from the token API Gateway has already validated. Never rely on this
 * function for security: the token is in the browser, so a determined user can
 * always make the tab reappear.
 */
export async function getUserGroups(): Promise<string[]> {
  try {
    const session = await fetchAuthSession();
    const claim = session.tokens?.idToken?.payload[GROUPS_CLAIM];

    // A decoded ID token carries a genuine JSON array. The comma-separated
    // form is what API Gateway's authorizer produces; accepted here so both
    // sides of the wire agree on how the claim is read.
    if (typeof claim === 'string') {
      return claim.split(',').map((group) => group.trim()).filter(Boolean);
    }

    if (Array.isArray(claim)) {
      return claim.filter((group): group is string => typeof group === 'string');
    }

    return [];
  } catch (error) {
    console.error('Error reading user groups:', error);
    return [];
  }
}

/**
 * Make an authenticated fetch request with JWT token
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
}
