import { StrictMode } from 'react';
import {
  describe, expect, it
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMountedRef } from './useMountedRef';

describe('useMountedRef', () => {
  it('reads true during the first render, before the setup effect runs', () => {
    const renderValues: boolean[] = [];

    renderHook(() => {
      const mountedRef = useMountedRef();
      renderValues.push(mountedRef.current);
      return mountedRef;
    });

    expect(renderValues[0]).toBe(true);
  });

  it.each([
    {
      mode: 'a plain mount',
      wrapper: undefined
    },
    {
      mode: 'a StrictMode cleanup and setup replay',
      wrapper: StrictMode
    },
  ])('reads true while mounted after $mode and false after unmount', ({ wrapper }) => {
    const {
      result, unmount
    } = renderHook(() => useMountedRef(), { wrapper });
    const mountedRef = result.current;

    expect(mountedRef.current).toBe(true);

    unmount();

    expect(mountedRef.current).toBe(false);
  });

  it('keeps the same ref object across renders', () => {
    const {
      result, rerender
    } = renderHook(() => useMountedRef());
    const firstRef = result.current;

    rerender();

    expect(result.current).toBe(firstRef);
  });
});
