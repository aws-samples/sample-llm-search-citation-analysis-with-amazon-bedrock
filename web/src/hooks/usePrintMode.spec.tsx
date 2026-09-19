import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { usePrintMode } from './usePrintMode';

/**
 * `usePrintMode` reads `?print=1` from the current URL and, when present
 * AND `ready` is true, calls `window.print()` after a short delay.
 *
 * Tests pin:
 *  - the hook returns `isPrintMode=false` for normal URLs (no auto-print),
 *  - the hook returns `isPrintMode=true` when `?print=1` is set,
 *  - `window.print` is only called once `ready` flips to true,
 *  - the timeout is cleared on unmount (no `print()` after the new tab
 *    is closed),
 *  - the configurable delay actually controls when the print fires.
 */

const wrapperAt = (path: string) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  );
  return Wrapper;
};

describe('usePrintMode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns isPrintMode=false when the URL has no print param', () => {
    const { result } = renderHook(() => usePrintMode(), {wrapper: wrapperAt('/visibility'),});
    expect(result.current.isPrintMode).toBe(false);
  });

  it('returns isPrintMode=true when the URL has ?print=1', () => {
    const { result } = renderHook(() => usePrintMode(), {wrapper: wrapperAt('/visibility?print=1'),});
    expect(result.current.isPrintMode).toBe(true);
  });

  it('does not auto-print when isPrintMode is false', () => {
    renderHook(() => usePrintMode(), { wrapper: wrapperAt('/visibility') });
    vi.advanceTimersByTime(5000);
    expect(window.print).not.toHaveBeenCalled();
  });

  it('triggers window.print after the delay when print mode is on and ready', () => {
    renderHook(() => usePrintMode({
      ready: true,
      printDelayMs: 1000 
    }), {wrapper: wrapperAt('/citations?print=1'),});
    vi.advanceTimersByTime(1000);
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('waits to print until ready transitions to true', () => {
    const { rerender } = renderHook(
      ({ ready }) => usePrintMode({
        ready,
        printDelayMs: 500 
      }),
      {
        initialProps: { ready: false },
        wrapper: wrapperAt('/?print=1'),
      },
    );
    vi.advanceTimersByTime(2000);
    expect(window.print).not.toHaveBeenCalled();

    rerender({ ready: true });
    vi.advanceTimersByTime(500);
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('clears the pending print timer on unmount', () => {
    const { unmount } = renderHook(
      () => usePrintMode({
        ready: true,
        printDelayMs: 1000 
      }),
      { wrapper: wrapperAt('/?print=1') },
    );
    unmount();
    vi.advanceTimersByTime(2000);
    expect(window.print).not.toHaveBeenCalled();
  });

  it('respects a custom printDelayMs', () => {
    renderHook(() => usePrintMode({
      ready: true,
      printDelayMs: 250 
    }), {wrapper: wrapperAt('/?print=1'),});
    vi.advanceTimersByTime(249);
    expect(window.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
