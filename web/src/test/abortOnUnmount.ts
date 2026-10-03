/**
 * Unmount-abort check for hooks that fetch through the mocked
 * `authenticatedFetch` (see ./infrastructureMock).
 */
import { vi } from 'vitest';
import { mockAuthenticatedFetch } from './infrastructureMock';

/**
 * Leaves every request pending, renders the hook with `render`, unmounts it,
 * and returns the `AbortController#abort` spy for the spec to assert on.
 */
export function spyOnAbortAfterPendingUnmount(render: () => { unmount: () => void }) {
  const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
  mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));
  render().unmount();
  return abortSpy;
}
