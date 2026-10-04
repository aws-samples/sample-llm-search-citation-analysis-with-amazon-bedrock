import { act } from '@testing-library/react';
import type { Mock } from 'vitest';
import type { authenticatedFetch } from '../infrastructure/auth';

interface OverlappingCalls<TResult> {
  first: Promise<TResult>;
  second: Promise<TResult>;
}

/** The last path segment of a request URL, decoded (a batch or content ID). */
export function requestedPathId(url: string): string {
  return decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
}

/** URLs of the calls `fetch` received whose URL contains `pathFragment`, in call order. */
export function requestUrlsContaining(
  fetch: Mock<typeof authenticatedFetch>,
  pathFragment: string
): string[] {
  return fetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes(pathFragment));
}

/** Starts `start` twice (call index 0, then 1) inside one `act`, so the second call overlaps the first. */
export function startTwoOverlappingCalls<TResult>(
  start: (callIndex: number) => Promise<TResult>,
  placeholder: TResult
): OverlappingCalls<TResult> {
  const pending: OverlappingCalls<TResult> = {
    first: Promise.resolve(placeholder),
    second: Promise.resolve(placeholder),
  };
  act(() => {
    pending.first = start(0);
    pending.second = start(1);
  });
  return pending;
}
