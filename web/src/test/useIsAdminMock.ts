/**
 * Replacement for `hooks/useIsAdmin` in view specs:
 *
 * ```ts
 * vi.mock('../../../hooks/useIsAdmin', () => import('../../../test/useIsAdminMock'));
 * ```
 *
 * `mockAdminRole(true | false)` settles the hook as an Admin or a plain user.
 */
import { vi } from 'vitest';
import type { useIsAdmin as realUseIsAdmin } from '../hooks/useIsAdmin';

export const useIsAdmin = vi.fn<typeof realUseIsAdmin>();

/** Signs the viewer in as an Admin (`true`) or a plain user, membership already resolved. */
export function mockAdminRole(isAdmin: boolean): void {
  useIsAdmin.mockReturnValue({
    isAdmin,
    loading: false,
  });
}
