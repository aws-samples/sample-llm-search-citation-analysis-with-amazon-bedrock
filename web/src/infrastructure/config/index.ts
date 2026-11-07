/**
 * Application configuration.
 * 
 * VITE_API_URL is set during build by scripts/build-web.sh (fetched from CloudFormation)
 * For local development, set VITE_API_URL in .env.local
 */

import { ApiConfigError } from '../errors';

const apiUrl = import.meta.env.VITE_API_URL;

// Security: Enforce HTTPS in production
if (apiUrl && import.meta.env.PROD && !apiUrl.startsWith('https://')) {
  throw new ApiConfigError('API_BASE_URL must use HTTPS in production');
}

export const API_BASE_URL = apiUrl ?? '';

/**
 * The SEO stack's API, `/api` included (`SeoApiUrl` output + `/api`, set by
 * scripts/build-web.sh). Empty when the SEO stack is not deployed.
 */
const seoApiUrl = import.meta.env.VITE_SEO_API_URL;

if (seoApiUrl && import.meta.env.PROD && !seoApiUrl.startsWith('https://')) {
  throw new ApiConfigError('SEO_API_BASE_URL must use HTTPS in production');
}

export const SEO_API_BASE_URL = seoApiUrl ?? '';
