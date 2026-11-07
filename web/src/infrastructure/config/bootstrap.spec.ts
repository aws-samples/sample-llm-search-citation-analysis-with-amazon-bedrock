import {
  describe, expect, it, vi
} from 'vitest';
import mainSource from '../../main.tsx?raw';
import {
  bootstrapDashboard, type DashboardBootstrap 
} from './bootstrap';
import type { RuntimeConfigResult } from './runtimeConfig';

const READY: RuntimeConfigResult = {
  status: 'ready',
  apiUrl: 'https://abc123.execute-api.eu-west-1.amazonaws.com/prod/api',
};
const UNAVAILABLE: RuntimeConfigResult = { status: 'unavailable' };
const RETRY_DELAY_MS = 15_000;

function stubBootstrap(...results: RuntimeConfigResult[]) {
  const loadConfig = vi.fn<DashboardBootstrap['loadConfig']>();
  for (const result of results) loadConfig.mockResolvedValueOnce(result);
  return {
    loadConfig,
    renderApp: vi.fn<DashboardBootstrap['renderApp']>(() => Promise.resolve()),
    renderUnavailable: vi.fn<DashboardBootstrap['renderUnavailable']>(),
    retryDelayMs: RETRY_DELAY_MS,
  };
}

describe('bootstrapDashboard', () => {
  it('renders the app once the API URL is known', async () => {
    const bootstrap = stubBootstrap(READY);

    await bootstrapDashboard(bootstrap);

    expect(bootstrap.renderApp).toHaveBeenCalledExactlyOnceWith();
    expect(bootstrap.renderUnavailable).not.toHaveBeenCalled();
  });

  it('shows the unavailable screen instead of the app while there is no API URL', async () => {
    const bootstrap = stubBootstrap(UNAVAILABLE);

    await bootstrapDashboard(bootstrap);

    expect(bootstrap.renderUnavailable).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    expect(bootstrap.renderApp).not.toHaveBeenCalled();
  });

  it.each([
    ['after the retry delay', vi.fn<(retry: () => void) => void>()],
    ['at once when the user retries, without a second timed retry', vi.fn<(retry: () => void) => void>((retry) => retry())],
  ])('looks for the config again %s and then renders the app', async (_case, userAction) => {
    vi.useFakeTimers();
    const bootstrap = stubBootstrap(UNAVAILABLE, READY);

    await bootstrapDashboard(bootstrap);
    userAction(bootstrap.renderUnavailable.mock.calls[0][0]);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    vi.useRealTimers();

    expect(bootstrap.loadConfig).toHaveBeenCalledTimes(2);
    expect(bootstrap.renderApp).toHaveBeenCalledExactlyOnceWith();
  });
});

describe('main.tsx', () => {
  it('imports the app only dynamically, after the runtime config is loaded', () => {
    expect(mainSource).not.toMatch(/^import .* from '\.\/App';$/m);
    expect(mainSource).toContain("await import('./App')");
  });

  it('does not import the config module that reads API_BASE_URL before the config is loaded', () => {
    expect(mainSource).not.toMatch(/from '\.\/infrastructure(\/config)?';/);
  });
});
