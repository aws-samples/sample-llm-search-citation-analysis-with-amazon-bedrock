/**
 * Shared replacement for `./client` in the specs of the API modules built on
 * top of it (`executions`, `keywordGroups`, `users`, ...).
 *
 * Use it as the `vi.mock` factory so every spec stubs the four verbs the same
 * way, then drive them through the typed mocks:
 *
 * ```ts
 * vi.mock('./client', () => import('./clientMock-fixtures'));
 * import { mockApiGet, mockApiPost } from './clientMock-fixtures';
 * ```
 *
 * The factory's dynamic import and a spec's static import resolve to the same
 * module instance, so `mockApiGet` is the very function the module under test
 * calls — the same arrangement as `../test/infrastructureMock`. Vitest's
 * `clearMocks`/`restoreMocks` reset them between tests.
 */
import { vi } from 'vitest';
import type {
  apiDelete, apiGet, apiPost, apiPut
} from './client';

export const mockApiGet = vi.fn<typeof apiGet>();
export const mockApiPost = vi.fn<typeof apiPost>();
export const mockApiPut = vi.fn<typeof apiPut>();
export const mockApiDelete = vi.fn<typeof apiDelete>();

export {
  mockApiGet as apiGet,
  mockApiPost as apiPost,
  mockApiPut as apiPut,
  mockApiDelete as apiDelete,
};
