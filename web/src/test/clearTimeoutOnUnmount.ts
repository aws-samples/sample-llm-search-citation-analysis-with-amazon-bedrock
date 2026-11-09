/**
 * Unmount-cleanup check for polling hooks: a pending poll timeout (or
 * interval) must be cleared when the hook unmounts, which has no other
 * observable effect.
 */
import { vi } from 'vitest';

export type TimerClearFunctionName = 'clearTimeout' | 'clearInterval';

/**
 * Renders the hook with `render` (which leaves a poll pending), unmounts it,
 * and returns how many times `clearFunctionName` (`clearTimeout` by default)
 * ran during the unmount.
 */
export async function countClearTimeoutsOnUnmount(
  render: () => Promise<{ unmount: () => void }>,
  clearFunctionName: TimerClearFunctionName = 'clearTimeout'
): Promise<number> {
  const clearSpy = vi.spyOn(globalThis, clearFunctionName);
  const { unmount } = await render();
  const callCountBefore = clearSpy.mock.calls.length;
  unmount();
  const cleared = clearSpy.mock.calls.length - callCountBefore;
  clearSpy.mockRestore();
  return cleared;
}
