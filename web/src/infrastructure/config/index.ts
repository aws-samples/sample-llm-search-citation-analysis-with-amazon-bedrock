/**
 * Application configuration.
 *
 * `API_BASE_URL` is read once, when this module is first evaluated: `main.tsx`
 * awaits `loadRuntimeConfig` (runtimeConfig.ts) before it imports the app, so
 * by then it holds the URL from `/config.json` (or `VITE_API_URL` on the dev
 * server; see runtimeConfig.ts).
 */

import { ApiConfigError } from '../errors';
import { loadedApiUrl } from './runtimeConfig';

const apiUrl = loadedApiUrl();

// Security: Enforce HTTPS in production
if (apiUrl && import.meta.env.PROD && !apiUrl.startsWith('https://')) {
  throw new ApiConfigError('API_BASE_URL must use HTTPS in production');
}

export const API_BASE_URL = apiUrl;

/**
 * The SEO stack's API, `/api` included (`SeoApiUrl` output + `/api`, set by
 * scripts/build-web.sh). Empty when the SEO stack is not deployed.
 */
const seoApiUrl = import.meta.env.VITE_SEO_API_URL;

if (seoApiUrl && import.meta.env.PROD && !seoApiUrl.startsWith('https://')) {
  throw new ApiConfigError('SEO_API_BASE_URL must use HTTPS in production');
}

export const SEO_API_BASE_URL = seoApiUrl ?? '';
