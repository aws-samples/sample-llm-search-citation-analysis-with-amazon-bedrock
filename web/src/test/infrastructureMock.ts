/**
 * Shared replacement for the `infrastructure` barrel in hook and component
 * specs.
 *
 * Use it as the `vi.mock` factory so every spec stubs the network layer the
 * same way:
 *
 * ```ts
 * vi.mock('../infrastructure', () => import('../test/infrastructureMock'));
 * import { mockAuthenticatedFetch } from '../test/infrastructureMock';
 * ```
 *
 * `authenticatedFetch` becomes a bare `vi.fn()` and `API_BASE_URL` is pinned
 * to a stable test origin; everything else (error classes, URL safety, group
 * lookups) is the real implementation, re-exported from the concrete modules
 * so the mocked barrel keeps the same surface as the real one.
 *
 * The factory's dynamic import and a spec's static import resolve to the same
 * module instance, so `mockAuthenticatedFetch` is the very function the code
 * under test calls.
 */
import { vi } from 'vitest';
import type { authenticatedFetch as realAuthenticatedFetch } from '../infrastructure/auth';

export * from '../infrastructure/errors';
export * from '../infrastructure/urlSafety';
export {
  ADMIN_GROUP, getUserGroups 
} from '../infrastructure/auth';

export const API_BASE_URL = 'https://api.test.com';

export const mockAuthenticatedFetch = vi.fn<typeof realAuthenticatedFetch>();

export { mockAuthenticatedFetch as authenticatedFetch };
