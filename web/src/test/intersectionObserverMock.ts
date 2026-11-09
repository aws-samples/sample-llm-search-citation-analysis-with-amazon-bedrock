import { act } from '@testing-library/react';
import { vi } from 'vitest';

interface WatchingObserver {
  /** Tells the observer's callback that the watched marker is on screen. */
  readonly reportVisible: () => void;
  disconnected: boolean;
}

/** The observers created since `installIntersectionObserverMock`, newest last. */
const observers: WatchingObserver[] = [];

/** The entry list the code under test reads: it only looks at `isIntersecting`. */
function visibleEntries(): IntersectionObserverEntry[] {
  const entry: Pick<IntersectionObserverEntry, 'isIntersecting'> = { isIntersecting: true };
  return [entry] as unknown as IntersectionObserverEntry[];
}

/** Replaces `IntersectionObserver` with one the test triggers through `scrollSentinelIntoView`. */
export function installIntersectionObserverMock(): void {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', class {
    private readonly watching: WatchingObserver;

    constructor(callback: IntersectionObserverCallback) {
      this.watching = {
        reportVisible: () => callback(visibleEntries(), this as unknown as IntersectionObserver),
        disconnected: false,
      };
      observers.push(this.watching);
    }

    /** The test decides when the marker is visible. */
    observe(): void {
      // Nothing to do until scrollSentinelIntoView.
    }

    disconnect(): void {
      this.watching.disconnected = true;
    }
  });
}

/** Reports the list's end marker as visible to the observer currently watching it. */
export function scrollSentinelIntoView(): void {
  const active = observers.filter((observer) => !observer.disconnected);
  if (active.length === 0) throw new RangeError('No IntersectionObserver is watching');
  const latest = active[active.length - 1];
  act(() => {
    latest.reportVisible();
  });
}
