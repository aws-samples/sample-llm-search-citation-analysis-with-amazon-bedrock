/**
 * Error handling utilities barrel export.
 */
export {
  ApiRequestError,
  ApiConfigError,
  clientRejectionMessage,
  getErrorMessage,
  isAbortError,
  isDefinitiveClientRejection,
  parseApiError,
} from './apiErrors';

export type {
  ErrorCategory, ApiError 
} from './apiErrors';
