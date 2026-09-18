/**
 * Library utilities barrel export.
 * Contains infrastructure code: auth, config, and error handling.
 */

// Auth
export {
  ADMIN_GROUP, authenticatedFetch, getUserGroups 
} from './auth';

// Config
export { API_BASE_URL } from './config';

// URL safety (http/https-only policy for stored, externally-derived URLs)
export {
  isValidHttpUrl, safeHref 
} from './urlSafety';

// Errors
export {
  ApiRequestError,
  ApiConfigError,
  clientRejectionMessage,
  getErrorMessage,
  isAbortError,
  isDefinitiveClientRejection,
} from './errors';
