/**
 * Library utilities barrel export.
 * Contains infrastructure code: auth, config, and error handling.
 */

// Auth
export {
  getAuthToken, authenticatedFetch 
} from './auth';

// Config
export { API_BASE_URL } from './config';

// Errors
export {
  ApiRequestError,
  ApiConfigError,
  getErrorMessage,
  isAbortError,
  isRecoverableError,
  parseApiError,
  createErrorHandler,
} from './errors';

export type {
  ErrorCategory, ApiError 
} from './errors';
