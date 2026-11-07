/**
 * Unmount-cleanup check for polling hooks: a pending poll timeout must be
 * cleared when the hook unmounts, which has no other observable effect.
 */
import { vi } from 'vitest';

/**
 * Renders the hook with `render` (which leaves a poll pending), unmounts it,
 * and returns how many times `clearTimeout` ran during the unmount.
 */
export async function countClearTimeoutsOnUnmount(render: () => Promise<{ unmount: () => void }>): Promise<number> {
  const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
  const { unmount } = await render();
  const callCountBefore = clearTimeoutSpy.mock.calls.length;
  unmount();
  const cleared = clearTimeoutSpy.mock.calls.length - callCountBefore;
  clearTimeoutSpy.mockRestore();
  return cleared;
}
