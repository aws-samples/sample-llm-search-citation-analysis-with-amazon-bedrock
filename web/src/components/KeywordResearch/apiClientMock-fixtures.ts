/**
 * Replacement for the `api/client` module in the promotion UI specs, so every
 * spec stubs `apiPost` the same way and asserts on the very same mock:
 *
 * ```ts
 * vi.mock('../../api/client', () => import('./apiClientMock-fixtures'));
 * import { mockApiPost } from './apiClientMock-fixtures';
 * ```
 *
 * The factory's dynamic import and a spec's static import resolve to the same
 * module instance, so `mockApiPost` is the function `promoteKeywords` calls.
 */
import { vi } from 'vitest';
import type { apiPost as realApiPost } from '../../api/client';

export const mockApiPost = vi.fn<typeof realApiPost>();

export { mockApiPost as apiPost };
