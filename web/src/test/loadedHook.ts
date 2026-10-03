/**
 * Helpers for data hooks that expose a `loading` flag: wait for a load to
 * settle, or render the hook and wait for its initial load, for specs that
 * assert on the loaded state.
 */
import { expect } from 'vitest';
import {
  renderHook, waitFor, type RenderHookOptions
} from '@testing-library/react';

interface LoadingHookResult { readonly current: { readonly loading: boolean } }

export async function waitForLoaded(result: LoadingHookResult): Promise<void> {
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });
}

export async function renderLoadedHook<TResult extends { loading: boolean }>(
  useHook: () => TResult,
  options?: RenderHookOptions<unknown>
) {
  const rendered = renderHook(useHook, options);
  await waitForLoaded(rendered.result);
  return rendered;
}
