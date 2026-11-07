import type { RuntimeConfigResult } from './runtimeConfig';

/** How long the "API is being updated" screen waits before it looks for `/config.json` again. */
export const API_UNAVAILABLE_RETRY_MS = 15_000;

/** What `bootstrapDashboard` needs from `main.tsx`, injectable for specs. */
export interface DashboardBootstrap {
  readonly loadConfig: () => Promise<RuntimeConfigResult>;
  /** Import and render the app; called once, after the API URL is known. */
  readonly renderApp: () => Promise<void>;
  /** Show the "API is being updated" screen; `retry` looks for the config again at once. */
  readonly renderUnavailable: (retry: () => void) => void;
  readonly retryDelayMs: number;
}

/**
 * Load the runtime config, then render the app. While there is no API URL
 * (during an upgrade the API stack deploys after the dashboard files), show
 * the unavailable screen and try again every `retryDelayMs`, or when the
 * user asks.
 */
export async function bootstrapDashboard(bootstrap: DashboardBootstrap): Promise<void> {
  const config = await bootstrap.loadConfig();
  if (config.status === 'ready') {
    await bootstrap.renderApp();
    return;
  }
  const pending = { timer: setTimeout(() => retry(), bootstrap.retryDelayMs) };
  function retry(): void {
    clearTimeout(pending.timer);
    void bootstrapDashboard(bootstrap);
  }
  bootstrap.renderUnavailable(retry);
}
