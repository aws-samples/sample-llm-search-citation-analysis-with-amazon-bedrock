import {
  useEffect, useState 
} from 'react';
import {
  ADMIN_GROUP, getUserGroups 
} from '../infrastructure';

/**
 * Resolve group membership, treating any failure as "no groups".
 *
 * Mirrors `safeCheck` in `useOnboardingStatus`: a session we cannot read is not
 * an administrator, and the hook must still stop loading so the UI settles.
 */
async function safeGetGroups(getGroups: () => Promise<string[]>): Promise<string[]> {
  try {
    return await getGroups();
  } catch (error) {
    console.error('Error resolving admin membership:', error);
    return [];
  }
}

interface UseIsAdminReturn {
  /** True only once membership has been confirmed. Starts false. */
  isAdmin: boolean;
  /** True until the session has been read, so callers can avoid a UI flicker. */
  loading: boolean;
}

/**
 * Reports whether the signed-in user belongs to the Cognito `Admin` group.
 *
 * This is a **presentation** concern: it decides whether to offer
 * administrative UI, nothing more. Enforcement lives server-side in
 * `shared.auth.require_group`, which reads the same `cognito:groups` claim from
 * the token API Gateway has already validated. The ID token is in the browser,
 * so a determined user can always make hidden UI reappear — and will then get a
 * 403 from every route behind it.
 *
 * Fails closed: any error, an absent claim, or a still-loading session yields
 * `isAdmin: false`. Membership is an exact string match, never a substring, so
 * a group named `Admins` does not qualify.
 *
 * @param getGroups - Group source, injectable for testing.
 */
export function useIsAdmin(
  getGroups: () => Promise<string[]> = getUserGroups
): UseIsAdminReturn {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    const resolveMembership = async () => {
      const groups = await safeGetGroups(getGroups);

      // The session read outlives a fast unmount; without this guard React
      // warns and the state update leaks.
      if (!controller.signal.aborted) {
        setIsAdmin(groups.includes(ADMIN_GROUP));
        setLoading(false);
      }
    };
    resolveMembership();

    return () => controller.abort();
  }, [getGroups]);

  return {
    isAdmin,
    loading, 
  };
}
