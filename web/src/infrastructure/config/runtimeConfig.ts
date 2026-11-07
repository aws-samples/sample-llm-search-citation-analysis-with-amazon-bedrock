/**
 * Where the dashboard finds its API at run time.
 *
 * Deployed dashboards read `/config.json` (`{ "apiUrl": "<stage url>/api" }`),
 * which `CitationAnalysisApiStack` writes into the web bucket: the API URL
 * changes with the API stack, so it is not built into the bundle. On the Vite
 * dev server a `VITE_API_URL` (`.env.local`) wins and nothing is fetched; in a
 * production build it is only the fallback when `/config.json` is missing.
 *
 * This module must stay free of imports from the app: `main.tsx` loads it
 * before anything that reads `API_BASE_URL` is evaluated.
 */

export const RUNTIME_CONFIG_PATH = '/config.json';

export type RuntimeConfigResult =
  | {
    readonly status: 'ready';
    readonly apiUrl: string 
  }
  /** No usable API URL yet: `/config.json` is missing (CloudFront then serves index.html), malformed, or not https. */
  | { readonly status: 'unavailable' };

/** Inputs of `loadRuntimeConfig`, injectable for specs. */
export interface RuntimeConfigSources {
  readonly fetchConfig: (path: string) => Promise<Response>;
  readonly buildTimeApiUrl: string | undefined;
  /** `import.meta.env.DEV`: the Vite dev server, where `VITE_API_URL` wins. */
  readonly devServer: boolean;
  /** `import.meta.env.PROD`: production builds accept https API URLs only. */
  readonly production: boolean;
}

const loaded = { apiUrl: '' };

function defaultSources(): RuntimeConfigSources {
  return {
    fetchConfig: (path) => fetch(path, { cache: 'no-store' }),
    buildTimeApiUrl: import.meta.env.VITE_API_URL,
    devServer: import.meta.env.DEV,
    production: import.meta.env.PROD,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

/** The `apiUrl` of a `/config.json` response, or `undefined` when the body is not that JSON object. */
async function readApiUrl(response: Response): Promise<string | undefined> {
  if (!response.ok) return undefined;
  try {
    const parsed: unknown = JSON.parse(await response.text());
    const apiUrl: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'apiUrl') : undefined;
    return typeof apiUrl === 'string' ? nonEmpty(apiUrl) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchApiUrl(sources: RuntimeConfigSources): Promise<string | undefined> {
  try {
    return await readApiUrl(await sources.fetchConfig(RUNTIME_CONFIG_PATH));
  } catch {
    return undefined;
  }
}

function withoutTrailingSlashes(url: string): string {
  return url.endsWith('/') ? withoutTrailingSlashes(url.slice(0, -1)) : url;
}

function accept(apiUrl: string, production: boolean): RuntimeConfigResult {
  if (production && !apiUrl.startsWith('https://')) return { status: 'unavailable' };
  loaded.apiUrl = withoutTrailingSlashes(apiUrl);
  return {
    status: 'ready',
    apiUrl: loaded.apiUrl 
  };
}

/** Resolve the API URL once, before the app renders. Never rejects. */
export async function loadRuntimeConfig(sources: RuntimeConfigSources = defaultSources()): Promise<RuntimeConfigResult> {
  const buildTimeApiUrl = nonEmpty(sources.buildTimeApiUrl);
  if (sources.devServer && buildTimeApiUrl !== undefined) return accept(buildTimeApiUrl, sources.production);
  const apiUrl = (await fetchApiUrl(sources)) ?? buildTimeApiUrl;
  return apiUrl === undefined ? { status: 'unavailable' } : accept(apiUrl, sources.production);
}

/** The URL `loadRuntimeConfig` resolved; the build-time `VITE_API_URL` (or `''`) before it ran, as in specs. */
export function loadedApiUrl(): string {
  return loaded.apiUrl === '' ? (import.meta.env.VITE_API_URL ?? '') : loaded.apiUrl;
}
