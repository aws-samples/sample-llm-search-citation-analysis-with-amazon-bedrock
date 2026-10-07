import {
  describe, expect, it
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { createDeferredValue } from '../../test/fetchResponses';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../ui/reportScope-fixtures';
import { useScopeSelection } from './useScopeSelection';

/** Renders the hook with `scope` already picked and its request `pending`; returns both and the settlers. */
function renderPickedScope() {
  const rendered = renderHook(() => useScopeSelection());
  const request = createDeferredValue<null>();
  act(() => {
    rendered.result.current.selectScope(groupScope('grp-luxury'));
  });
  const cleanup = rendered.result.current.trackScopeRequest(request.promise);
  return {
    ...rendered,
    request,
    cleanup,
  };
}

/** Settles the picked scope's `request` and returns whether the hook still reports a scope change pending. */
async function waitForSettledPending(rendered: ReturnType<typeof renderPickedScope>): Promise<boolean> {
  await act(async () => {
    rendered.request.resolve(null);
    await rendered.request.promise;
  });
  return rendered.result.current.scopePending;
}

describe('useScopeSelection', () => {
  it('starts at every keyword with no scope change pending', () => {
    const { result } = renderHook(() => useScopeSelection());

    expect(result.current).toStrictEqual({
      scope: ALL_SCOPE,
      scopePending: false,
      selectScope: expect.any(Function),
      trackScopeRequest: expect.any(Function),
    });
  });

  it('switches to the picked scope and reports it pending', () => {
    const { result } = renderPickedScope();

    expect(result.current.scope).toStrictEqual(groupScope('grp-luxury'));
    expect(result.current.scopePending).toBe(true);
  });

  it('ignores picking the scope already selected', () => {
    const { result } = renderHook(() => useScopeSelection());

    act(() => {
      result.current.selectScope(ALL_SCOPE);
    });

    expect(result.current.scopePending).toBe(false);
  });

  it('clears pending once the picked scope request settles', async () => {
    const rendered = renderPickedScope();

    expect(await waitForSettledPending(rendered)).toBe(false);
  });

  it('stays pending when a superseded scope request settles', async () => {
    const rendered = renderPickedScope();
    act(() => {
      rendered.result.current.selectScope(keywordScope('hotels'));
    });
    rendered.result.current.trackScopeRequest(new Promise(() => undefined));

    expect(await waitForSettledPending(rendered)).toBe(true);
  });

  it('stays pending when a request settles after its effect was cleaned up', async () => {
    const rendered = renderPickedScope();
    rendered.cleanup();

    expect(await waitForSettledPending(rendered)).toBe(true);
  });
});
