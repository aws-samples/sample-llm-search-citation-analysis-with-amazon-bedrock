import { renderLoadedHook } from '../test/loadedHook';
import { useIsAdmin } from './useIsAdmin';

/**
 * Renders the hook with `getGroups` as its group source and waits until the
 * session has been read, so `isAdmin` reflects the resolved membership.
 */
export async function renderResolvedIsAdmin(getGroups: () => Promise<string[]>) {
  return renderLoadedHook(() => useIsAdmin(getGroups));
}
