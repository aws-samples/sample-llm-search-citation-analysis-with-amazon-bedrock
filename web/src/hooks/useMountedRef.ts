import {
  useEffect, useRef, type MutableRefObject
} from 'react';

/**
 * A ref that reads `true` while the calling component is mounted and `false`
 * once it unmounts, so async work can drop results that land too late.
 *
 * It starts `true` so work begun before the setup effect runs (a child's
 * mount effect, say) is not dropped, and the setup effect sets it back to
 * `true` after StrictMode's simulated unmount. The ref object is stable.
 * Hooks with more to tear down on unmount add their own cleanup effect.
 */
export function useMountedRef(): MutableRefObject<boolean> {
  const mountedRef = useRef(true);

  // Stryker disable ArrayDeclaration: This mount lifecycle intentionally runs once per setup and cleanup cycle.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Stryker restore ArrayDeclaration

  return mountedRef;
}
