import {
  useEffect, useRef, useState
} from 'react';

/**
 * Whether the element is wider than its box (so it scrolls sideways) and
 * whether more of it lies to the right of the scroll position; re-measured
 * on resize and on scroll.
 */
export function useHorizontalOverflow<Element extends HTMLElement>() {
  const ref = useRef<Element>(null);
  const [state, setState] = useState({
    scrolls: false,
    moreRight: false,
  });

  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const measure = () => {
      const scrolls = element.scrollWidth > element.clientWidth + 1;
      const moreRight = scrolls && element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setState((previous) => (previous.scrolls === scrolls && previous.moreRight === moreRight ? previous : {
        scrolls,
        moreRight,
      }));
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, []);

  return {
    ref,
    ...state,
  };
}
