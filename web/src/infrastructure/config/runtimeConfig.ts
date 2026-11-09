/**
 * Where the dashboard finds its API and its live events at run time.
 *
 * Deployed dashboards read `/config.json` (`{ "apiUrl": "<stage url>/api",
 * "liveEvents": { "httpDomain", "realtimeDomain" } }`), which
 * `CitationAnalysisApiStack` writes into the web bucket: the API URL changes
 * with the API stack, so it is not built into the bundle. On the Vite dev
 * server a `VITE_API_URL` (`.env.local`) wins and nothing is fetched; in a
 * production build it is only the fallback when `/config.json` is missing.
 * The live events domains (`CitationAnalysisEventsStack`) come from the same
 * object, or from `VITE_LIVE_EVENTS_*` on the dev server; without them the
 * dashboard reads each state once and is not told when it changes.
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

/** The AWS AppSync Events domains (no scheme): the HTTP one authorizes, the real-time one carries the WebSocket. */
export interface LiveEventsEndpoints {
  readonly httpDomain: string;
  readonly realtimeDomain: string;
}

const loaded: {
  apiUrl: string;
  liveEvents: LiveEventsEndpoints | null 
} = {
  apiUrl: '',
  liveEvents: null,
};

/** A bare host name: letters, digits, dots and dashes. Anything else (a scheme, a path) is not used. */
const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/iu;

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

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

function domain(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? nonEmpty(value) : undefined;
  return trimmed !== undefined && DOMAIN.test(trimmed) ? trimmed : undefined;
}

/** Both live events domains, or `null` when either is missing or not a bare host name. */
export function liveEventsEndpoints(httpDomain: unknown, realtimeDomain: unknown): LiveEventsEndpoints | null {
  const http = domain(httpDomain);
  const realtime = domain(realtimeDomain);
  return http === undefined || realtime === undefined ? null : {
    httpDomain: http,
    realtimeDomain: realtime,
  };
}

interface FetchedConfig {
  readonly apiUrl: string | undefined;
  readonly liveEvents: LiveEventsEndpoints | null;
}

const NO_CONFIG: FetchedConfig = {
  apiUrl: undefined,
  liveEvents: null,
};

/** The `apiUrl` and `liveEvents` of a `/config.json` response; nothing when the body is not that JSON object. */
async function readConfig(response: Response): Promise<FetchedConfig> {
  if (!response.ok) return NO_CONFIG;
  try {
    const parsed: unknown = JSON.parse(await response.text());
    const apiUrl = field(parsed, 'apiUrl');
    const liveEvents = field(parsed, 'liveEvents');
    return {
      apiUrl: typeof apiUrl === 'string' ? nonEmpty(apiUrl) : undefined,
      liveEvents: liveEventsEndpoints(field(liveEvents, 'httpDomain'), field(liveEvents, 'realtimeDomain')),
    };
  } catch {
    return NO_CONFIG;
  }
}

async function fetchConfig(sources: RuntimeConfigSources): Promise<FetchedConfig> {
  try {
    return await readConfig(await sources.fetchConfig(RUNTIME_CONFIG_PATH));
  } catch {
    return NO_CONFIG;
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
  const fetched = await fetchConfig(sources);
  loaded.liveEvents = fetched.liveEvents;
  const apiUrl = fetched.apiUrl ?? buildTimeApiUrl;
  return apiUrl === undefined ? { status: 'unavailable' } : accept(apiUrl, sources.production);
}

/** The URL `loadRuntimeConfig` resolved; the build-time `VITE_API_URL` (or `''`) before it ran, as in specs. */
export function loadedApiUrl(): string {
  return loaded.apiUrl === '' ? (import.meta.env.VITE_API_URL ?? '') : loaded.apiUrl;
}

/**
 * The live events domains `loadRuntimeConfig` read from `/config.json`; on the dev server (or before it ran, as
 * in specs) the `VITE_LIVE_EVENTS_*` ones; `null` when there are none.
 */
export function loadedLiveEvents(): LiveEventsEndpoints | null {
  return loaded.liveEvents ?? liveEventsEndpoints(
    import.meta.env.VITE_LIVE_EVENTS_HTTP_DOMAIN,
    import.meta.env.VITE_LIVE_EVENTS_REALTIME_DOMAIN
  );
}
