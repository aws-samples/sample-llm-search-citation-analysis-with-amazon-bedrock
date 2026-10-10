import { vi } from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import {
  createDeferredValue, deferNextTwoCalls, type DeferredValue
} from '../test/fetchResponses';
import { renderLoadedHook } from '../test/loadedHook';
import {
  useGuardedLoad, type GuardedLoadSource
} from './useGuardedLoad';

/** The route names of a fictional airline, as the mocked list answers them. */
export const ROUTES = ['Lima – Cusco', 'Santiago – Punta Arenas'];
export const NEWER_ROUTES = ['Quito – Galápagos'];

/** A failing load as the mocked list rejects it. */
export class RouteListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteListError';
  }
}

/** `GET` of the route list; every spec scripts it before rendering. */
export const mockLoadRoutes = vi.fn<(signal: AbortSignal) => Promise<string[]>>();

/** A guarded load of the route list over `mockLoadRoutes`; every field can be overridden. */
export function buildRoutesSource(overrides: Partial<GuardedLoadSource<string[]>> = {}): GuardedLoadSource<string[]> {
  return {
    initial: [],
    load: mockLoadRoutes,
    errorMessage: (failure) => (failure instanceof Error ? `Routes unavailable: ${failure.message}` : 'Routes unavailable'),
    logMessage: '[routes] Error loading routes:',
    ...overrides,
  };
}

/** Renders the hook over `source`, built once so `reload` keeps its identity across renders. */
export function renderGuardedRoutes(source: GuardedLoadSource<string[]> = buildRoutesSource()) {
  return renderHook(() => useGuardedLoad(source));
}

/** The hook once its mount load of `routes` has settled. */
export function renderLoadedRoutes(routes: string[] = ROUTES) {
  mockLoadRoutes.mockResolvedValue(routes);
  const source = buildRoutesSource();
  return renderLoadedHook(() => useGuardedLoad(source));
}

/** The hook once its mount load, rejected with `failure`, has settled. */
export function renderFailedRoutes(failure: unknown, source: GuardedLoadSource<string[]> = buildRoutesSource()) {
  mockLoadRoutes.mockRejectedValue(failure);
  return renderLoadedHook(() => useGuardedLoad(source));
}

/** The hook with its mount load still pending; `pending` settles it. */
export function renderPendingRoutes() {
  const pending = createDeferredValue<string[]>();
  mockLoadRoutes.mockReturnValue(pending.promise);
  return {
    pending,
    ...renderGuardedRoutes(),
  };
}

/** Answers `pending` with `routes` and flushes the resulting updates. */
export async function settleRoutes(pending: DeferredValue<string[]>, routes: string[]): Promise<void> {
  await act(async () => {
    pending.resolve(routes);
    await pending.promise;
  });
}

interface TwoReloads {
  result: ReturnType<typeof renderGuardedRoutes>['result'];
  older: DeferredValue<string[]>;
  newer: DeferredValue<string[]>;
  /** Settles once both reloads have, however the spec resolved them. */
  reloads: Promise<void>;
}

/**
 * The loaded hook with two reloads in flight, started in order, each
 * answered by hand through `older` and `newer`.
 */
export async function renderTwoReloads(): Promise<TwoReloads> {
  const { result } = await renderLoadedRoutes();
  const [older, newer] = deferNextTwoCalls<string[]>(mockLoadRoutes);
  const started: Promise<void>[] = [];
  act(() => {
    started.push(result.current.reload(), result.current.reload());
  });
  return {
    result,
    older,
    newer,
    reloads: Promise.all(started).then(() => undefined),
  };
}

/**
 * `renderTwoReloads` with the newer reload already answered `NEWER_ROUTES`,
 * so a spec can settle the superseded `older` one and assert it changed nothing.
 */
export async function renderSupersededReload(): Promise<Omit<TwoReloads, 'newer'>> {
  const {
    newer, ...reloads
  } = await renderTwoReloads();
  await settleRoutes(newer, NEWER_ROUTES);
  return reloads;
}
