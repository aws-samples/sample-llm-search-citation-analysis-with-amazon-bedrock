import {
  useCallback, useEffect, useRef, useState
} from 'react';

/** How far below the viewport the end of the list may be when the next batch is asked for. */
const LOAD_AHEAD_MARGIN = '400px';

/**
 * Calls `onReachEnd` when the element given to the returned ref scrolls into
 * view (or within `LOAD_AHEAD_MARGIN` of it), while `enabled`. `watch` is
 * whatever changes when a batch arrives (the number of rows shown): the
 * observer restarts then, so a sentinel still in view asks again until the
 * list fills the screen. Without `IntersectionObserver` nothing loads on its
 * own and the caller's button remains the way to load more.
 */
export function useLoadOnScroll(onReachEnd: () => void, enabled: boolean, watch: unknown) {
  const [sentinel, setSentinel] = useState<Element | null>(null);
  const latest = useRef(onReachEnd);
  latest.current = onReachEnd;

  useEffect(() => {
    if (!enabled || sentinel === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) latest.current();
    }, { rootMargin: `0px 0px ${LOAD_AHEAD_MARGIN} 0px` });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, sentinel, watch]);

  return useCallback((element: Element | null) => setSentinel(element), []);
}
