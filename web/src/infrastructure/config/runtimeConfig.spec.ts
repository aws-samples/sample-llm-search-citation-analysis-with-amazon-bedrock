import {
  describe, expect, it, vi
} from 'vitest';
import { TestError } from '../../test/testError';
import {
  RUNTIME_CONFIG_PATH, liveEventsEndpoints, loadRuntimeConfig 
} from './runtimeConfig';
import {
  BUILD_TIME_API_URL,
  DEPLOYED_API_URL,
  buildConfigResponse,
  buildHtmlResponse,
  buildSources,
} from './runtimeConfig-fixtures';

const DEV_SERVER = {
  devServer: true,
  production: false,
};

describe('loadRuntimeConfig with an API URL', () => {
  it.each([
    ['the apiUrl of /config.json on a deployed dashboard', buildSources(buildConfigResponse({ apiUrl: DEPLOYED_API_URL })), DEPLOYED_API_URL],
    ['the apiUrl without its trailing slash, so endpoint paths join with one slash', buildSources(buildConfigResponse({ apiUrl: `${DEPLOYED_API_URL}/` })), DEPLOYED_API_URL],
    ['/config.json over a VITE_API_URL built into a production bundle', buildSources(buildConfigResponse({ apiUrl: DEPLOYED_API_URL }), { buildTimeApiUrl: BUILD_TIME_API_URL }), DEPLOYED_API_URL],
    ['the built-in VITE_API_URL when /config.json is missing', buildSources(buildHtmlResponse(404), { buildTimeApiUrl: BUILD_TIME_API_URL }), BUILD_TIME_API_URL],
    ['VITE_API_URL on the Vite dev server', buildSources(buildHtmlResponse(200), {
      buildTimeApiUrl: '/api',
      ...DEV_SERVER 
    }), '/api'],
    ['/config.json on the Vite dev server when VITE_API_URL is not set', buildSources(buildConfigResponse({ apiUrl: DEPLOYED_API_URL }), DEV_SERVER), DEPLOYED_API_URL],
  ])('returns %s', async (_case, sources, apiUrl) => {
    expect(await loadRuntimeConfig(sources)).toStrictEqual({
      status: 'ready',
      apiUrl,
    });
  });

  it('fetches /config.json exactly once', async () => {
    const sources = buildSources(buildConfigResponse({ apiUrl: DEPLOYED_API_URL }));

    await loadRuntimeConfig(sources);

    expect(sources.fetchConfig).toHaveBeenCalledExactlyOnceWith(RUNTIME_CONFIG_PATH);
  });

  it('does not fetch /config.json on the Vite dev server when VITE_API_URL is set', async () => {
    const sources = buildSources(buildHtmlResponse(200), {
      buildTimeApiUrl: '/api',
      ...DEV_SERVER 
    });

    await loadRuntimeConfig(sources);

    expect(sources.fetchConfig).not.toHaveBeenCalled();
  });
});

describe('loadRuntimeConfig without a usable /config.json', () => {
  it.each([
    ['CloudFront serves index.html for the missing object', buildHtmlResponse(200)],
    ['S3 refuses the missing object', buildHtmlResponse(403)],
    ['the object is not found', buildHtmlResponse(404)],
    ['the JSON has no apiUrl', buildConfigResponse({ url: DEPLOYED_API_URL })],
    ['the apiUrl is empty', buildConfigResponse({ apiUrl: '  ' })],
    ['the apiUrl is not a string', buildConfigResponse({ apiUrl: 42 })],
    ['the JSON is not an object', buildConfigResponse(null)],
    ['the apiUrl is not https in a production build', buildConfigResponse({ apiUrl: '//abc123.execute-api.eu-west-1.amazonaws.com/prod/api' })],
    ['the request fails', new TestError('network down')],
  ])('reports the API unavailable when %s', async (_case, response) => {
    expect(await loadRuntimeConfig(buildSources(response))).toStrictEqual({ status: 'unavailable' });
  });
});

describe('API_BASE_URL', () => {
  it('is the URL loadRuntimeConfig resolved when the config module is first imported after it', async () => {
    vi.resetModules();
    const runtimeConfig = await import('./runtimeConfig');
    await runtimeConfig.loadRuntimeConfig(buildSources(buildConfigResponse({ apiUrl: DEPLOYED_API_URL })));

    const { API_BASE_URL } = await import('./index');

    expect(API_BASE_URL).toBe(DEPLOYED_API_URL);
  });
});

const LIVE_EVENTS = {
  httpDomain: 'abc123.appsync-api.eu-west-1.amazonaws.com',
  realtimeDomain: 'abc123.appsync-realtime-api.eu-west-1.amazonaws.com',
};

describe('loadedLiveEvents', () => {
  it('is the liveEvents of /config.json once loadRuntimeConfig read it', async () => {
    vi.resetModules();
    const runtimeConfig = await import('./runtimeConfig');
    await runtimeConfig.loadRuntimeConfig(buildSources(buildConfigResponse({
      apiUrl: DEPLOYED_API_URL,
      liveEvents: LIVE_EVENTS 
    })));

    expect(runtimeConfig.loadedLiveEvents()).toStrictEqual(LIVE_EVENTS);
  });

  it.each([
    ['absent', undefined],
    ['missing its real-time domain', { httpDomain: LIVE_EVENTS.httpDomain }],
    ['a URL instead of a host name', {
      ...LIVE_EVENTS,
      httpDomain: `https://${LIVE_EVENTS.httpDomain}/event` 
    }],
    ['not an object', 'abc123'],
  ])('is null when liveEvents is %s, and the API still loads', async (_case, liveEvents) => {
    vi.resetModules();
    const runtimeConfig = await import('./runtimeConfig');
    const result = await runtimeConfig.loadRuntimeConfig(buildSources(buildConfigResponse({
      apiUrl: DEPLOYED_API_URL,
      liveEvents 
    })));

    expect([result.status, runtimeConfig.loadedLiveEvents()]).toStrictEqual(['ready', null]);
  });
});

describe('liveEventsEndpoints', () => {
  it('trims both host names', () => {
    expect(liveEventsEndpoints(` ${LIVE_EVENTS.httpDomain} `, LIVE_EVENTS.realtimeDomain)).toStrictEqual(LIVE_EVENTS);
  });
});
