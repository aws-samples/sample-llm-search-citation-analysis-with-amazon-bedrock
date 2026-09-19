import {
  useCallback, useEffect, useRef
} from 'react';

interface LatestRequest {
  signal: AbortSignal;
  isCurrent: () => boolean;
  finish: () => void;
}

export function useLatestRequest() {
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const cancelRequest = useCallback((): void => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRequest();
    };
  }, [cancelRequest]);

  const beginRequest = useCallback((): LatestRequest => {
    cancelRequest();
    const controller = new AbortController();
    const generation = generationRef.current;
    controllerRef.current = controller;

    const isCurrent = (): boolean => mountedRef.current
      && generationRef.current === generation
      && controllerRef.current === controller;

    const finish = (): void => {
      if (controllerRef.current === controller) controllerRef.current = null;
    };

    return {
      signal: controller.signal,
      isCurrent,
      finish,
    };
  }, [cancelRequest]);

  const isMounted = useCallback((): boolean => mountedRef.current, []);

  return {
    beginRequest,
    cancelRequest,
    isMounted,
  };
}
