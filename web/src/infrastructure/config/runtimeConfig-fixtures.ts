import { vi } from 'vitest';
import type { RuntimeConfigSources } from './runtimeConfig';

export const DEPLOYED_API_URL = 'https://abc123.execute-api.eu-west-1.amazonaws.com/prod/api';
export const BUILD_TIME_API_URL = 'https://build-time.example.test/prod/api';

/** What CloudFront answers for a missing object: the SPA's index.html with status 200 (403/404 error responses). */
export const SPA_FALLBACK_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';

/** Sources of a production build whose `/config.json` answers `response` (a rejection when it is an Error). */
export function buildSources(
  response: Response | Error,
  overrides: Partial<Omit<RuntimeConfigSources, 'fetchConfig'>> = {}
): RuntimeConfigSources & { fetchConfig: ReturnType<typeof vi.fn<RuntimeConfigSources['fetchConfig']>> } {
  const fetchConfig = vi.fn<RuntimeConfigSources['fetchConfig']>(() => (
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  ));
  return {
    fetchConfig,
    buildTimeApiUrl: undefined,
    devServer: false,
    production: true,
    ...overrides,
  };
}

/** A `/config.json` response with `body` serialised as JSON. */
export function buildConfigResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A text/html response, like CloudFront's SPA fallback or an S3 error page. */
export function buildHtmlResponse(status: number): Response {
  return new Response(SPA_FALLBACK_HTML, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}
