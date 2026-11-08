/**
 * Shared steps of the 2.45.0 scoped-view specs: the view job of a `202` answer, fake timers with
 * a fresh fetch mock for the polling specs, and the "Load more" click of a paged list.
 */
import {
  afterEach, beforeEach, vi
} from 'vitest';
import {
  act, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComputingResponse } from '../types/domain/scopeCoverage';
import { createMockJsonResponse } from './fetchResponses';
import { mockAuthenticatedFetch } from './infrastructureMock';

/** A view job computing an answer, as a hook holds it in `computing`. */
export const COMPUTING_JOB: ComputingResponse = {
  status: 'computing',
  job: {
    id: 'job-1',
    started_at: '2026-10-12T07:20:00Z',
  },
  retry_after_ms: 2000,
};

/** Every test of the calling `describe` runs on fake timers with `authenticatedFetch` reset. */
export function setupFakeTimersAndFetch(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    mockAuthenticatedFetch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

/** `authenticatedFetch` answers each `[body, status]` pair once, in order. */
export function answerFetchesInOrder(...answers: ReadonlyArray<readonly [unknown, number]>): void {
  answers.forEach(([body, status]) => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(body, status));
  });
}

/** Starts `request` without awaiting it (a polled `202`), then lets `ms` of fake time pass. */
export async function startThenAdvance(request: () => Promise<unknown>, ms: number): Promise<void> {
  act(() => { void request(); });
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** Awaits `request`, then lets `ms` of fake time pass (a stale refetch). */
export async function awaitThenAdvance(request: () => Promise<unknown>, ms: number): Promise<void> {
  await act(() => request());
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** Presses the "Load more <noun>" button of a paged list. */
export async function clickLoadMore(noun: string): Promise<void> {
  // Waits for the button: it appears once the first page has answered, which a loaded runner can delay.
  await userEvent.click(await screen.findByRole('button', { name: `Load more ${noun}` }));
}

/** The visible text of a `ComputingState` naming `subject` (its screen-reader label). */
export function computingLabel(subject: string): HTMLElement {
  return screen.getByText(new RegExp(`Computing the complete ${subject}`, 'u'), { selector: 'span' });
}
