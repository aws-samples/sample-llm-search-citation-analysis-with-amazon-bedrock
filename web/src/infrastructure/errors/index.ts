/**
 * Error handling utilities barrel export.
 */
export {
  ApiRequestError,
  ApiConfigError,
  getErrorMessage,
  isAbortError,
  isRecoverableError,
  parseApiError,
  createErrorHandler,
} from './apiErrors';

export type {
  ErrorCategory, ApiError 
} from './apiErrors';
