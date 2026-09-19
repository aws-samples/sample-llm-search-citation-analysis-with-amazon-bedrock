import { expect } from 'vitest';
import {
  renderHook, waitFor 
} from '@testing-library/react';
import { useIsAdmin } from './useIsAdmin';

/**
 * Renders the hook with `getGroups` as its group source and waits until the
 * session has been read, so `isAdmin` reflects the resolved membership.
 */
export async function renderResolvedIsAdmin(getGroups: () => Promise<string[]>) {
  const rendered = renderHook(() => useIsAdmin(getGroups));
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}
