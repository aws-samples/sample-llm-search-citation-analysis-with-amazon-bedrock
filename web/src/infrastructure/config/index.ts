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
