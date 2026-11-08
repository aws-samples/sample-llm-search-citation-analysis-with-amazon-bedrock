import type { RuntimeConfigResult } from './runtimeConfig';

/** How long the "API is being updated" screen waits before it looks for `/config.json` again. */
export const API_UNAVAILABLE_RETRY_MS = 15_000;
/**
 * Timed looks for `/config.json` before the screen stops looking on its own (about 10 minutes, longer than the
 * API stack's deploy): polling is bounded (TENETS.md, tenet 8). The retry button keeps working after that.
 */
export const API_UNAVAILABLE_MAX_TIMED_RETRIES = 40;

/** What `bootstrapDashboard` needs from `main.tsx`, injectable for specs. */
export interface DashboardBootstrap {
  readonly loadConfig: () => Promise<RuntimeConfigResult>;
  /** Import and render the app; called once, after the API URL is known. */
  readonly renderApp: () => Promise<void>;
  /** Show the "API is being updated" screen; `retry` looks for the config again at once. */
  readonly renderUnavailable: (retry: () => void) => void;
  readonly retryDelayMs: number;
  /** Timed retries left; the user's retry still works when none is. */
  readonly timedRetriesLeft?: number;
}

/**
 * Load the runtime config, then render the app. While there is no API URL
 * (during an upgrade the API stack deploys after the dashboard files), show
 * the unavailable screen and try again every `retryDelayMs`, at most
 * `timedRetriesLeft` times (`API_UNAVAILABLE_MAX_TIMED_RETRIES`), or whenever the
 * user asks.
 */
export async function bootstrapDashboard(bootstrap: DashboardBootstrap): Promise<void> {
  const config = await bootstrap.loadConfig();
  if (config.status === 'ready') {
    await bootstrap.renderApp();
    return;
  }
  const left = bootstrap.timedRetriesLeft ?? API_UNAVAILABLE_MAX_TIMED_RETRIES;
  const timer = left > 0
    ? setTimeout(() => void bootstrapDashboard({
      ...bootstrap,
      timedRetriesLeft: left - 1,
    }), bootstrap.retryDelayMs)
    : undefined;
  function retry(): void {
    clearTimeout(timer);
    void bootstrapDashboard(bootstrap);
  }
  bootstrap.renderUnavailable(retry);
}
