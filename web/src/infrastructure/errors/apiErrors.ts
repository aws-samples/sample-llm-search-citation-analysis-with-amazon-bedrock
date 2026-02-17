/**
 * Centralized error handling for API calls.
 * Provides user-friendly error messages and error classification.
 */

export type ErrorCategory = 
  | 'network'
  | 'auth'
  | 'not_found'
  | 'validation'
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'config'
  | 'unknown';

export interface ApiError {
  message: string;
  category: ErrorCategory;
  originalError?: Error;
  statusCode?: number;
  recoverable: boolean;
  suggestion?: string;
}

const STATUS_TO_CATEGORY: Record<number, ErrorCategory> = {
  400: 'validation',
  401: 'auth',
  403: 'auth',
  404: 'not_found',
  408: 'timeout',
  429: 'rate_limit',
  500: 'server',
  502: 'server',
  503: 'server',
  504: 'timeout',
};

interface CategoryInfo {
  message: string;
  suggestion: string;
  recoverable: boolean;
}

const CATEGORY_MESSAGES: Record<ErrorCategory, CategoryInfo> = {
  network: {
    message: 'Unable to connect to the server',
    suggestion: 'Check your internet connection and try again',
    recoverable: true,
  },
  auth: {
    message: 'Authentication required',
    suggestion: 'Please check your API configuration',
    recoverable: false,
  },
  not_found: {
    message: 'The requested resource was not found',
    suggestion: 'The data may have been deleted or moved',
    recoverable: false,
  },
  validation: {
    message: 'Invalid request',
    suggestion: 'Please check your input and try again',
    recoverable: true,
  },
  rate_limit: {
    message: 'Too many requests',
    suggestion: 'Please wait a moment before trying again',
    recoverable: true,
  },
  server: {
    message: 'Server error occurred',
    suggestion: 'The server encountered an issue. Try again later',
    recoverable: true,
  },
  timeout: {
    message: 'Request timed out',
    suggestion: 'The server took too long to respond. Try again',
    recoverable: true,
  },
  config: {
    message: 'Configuration error',
    suggestion: 'Please check your API settings',
    recoverable: false,
  },
  unknown: {
    message: 'An unexpected error occurred',
    suggestion: 'Please try again or contact support if the issue persists',
    recoverable: true,
  },
};

const CONTEXT_MESSAGES: Record<string, Record<ErrorCategory, string>> = {
  dashboard: {
    network: 'Unable to load dashboard data',
    auth: 'Authentication required to view dashboard',
    not_found: 'Dashboard data not available',
    validation: 'Invalid dashboard request',
    rate_limit: 'Dashboard requests limited. Please wait',
    server: 'Failed to load dashboard',
    timeout: 'Dashboard loading timed out',
    config: 'Dashboard not configured properly',
    unknown: 'Failed to load dashboard data',
  },
  brands: {
    network: 'Unable to load brand mentions',
    auth: 'Authentication required to view brands',
    not_found: 'No brand data found for this keyword',
    validation: 'Invalid brand request',
    rate_limit: 'Brand requests limited. Please wait',
    server: 'Failed to load brand mentions',
    timeout: 'Brand data loading timed out',
    config: 'Brand tracking not configured',
    unknown: 'Failed to load brand mentions',
  },
  visibility: {
    network: 'Unable to load visibility metrics',
    auth: 'Authentication required for visibility data',
    not_found: 'No visibility data found',
    validation: 'Invalid visibility request',
    rate_limit: 'Visibility requests limited. Please wait',
    server: 'Failed to load visibility metrics',
    timeout: 'Visibility data loading timed out',
    config: 'Visibility tracking not configured',
    unknown: 'Failed to load visibility metrics',
  },
  content: {
    network: 'Unable to connect to content service',
    auth: 'Authentication required for content generation',
    not_found: 'Content not found',
    validation: 'Invalid content request',
    rate_limit: 'Content generation limited. Please wait',
    server: 'Content generation failed',
    timeout: 'Content generation timed out',
    config: 'Content service not configured',
    unknown: 'Failed to process content request',
  },
  keywords: {
    network: 'Unable to load keywords',
    auth: 'Authentication required for keyword management',
    not_found: 'Keyword not found',
    validation: 'Invalid keyword data',
    rate_limit: 'Keyword requests limited. Please wait',
    server: 'Failed to process keyword request',
    timeout: 'Keyword operation timed out',
    config: 'Keyword service not configured',
    unknown: 'Failed to process keyword request',
  },
  providers: {
    network: 'Unable to connect to provider service',
    auth: 'Authentication required for provider settings',
    not_found: 'Provider not found',
    validation: 'Invalid provider configuration',
    rate_limit: 'Provider requests limited. Please wait',
    server: 'Failed to update provider settings',
    timeout: 'Provider operation timed out',
    config: 'Provider service not configured',
    unknown: 'Failed to process provider request',
  },
  analysis: {
    network: 'Unable to start analysis',
    auth: 'Authentication required to run analysis',
    not_found: 'Analysis execution not found',
    validation: 'Invalid analysis parameters',
    rate_limit: 'Analysis requests limited. Please wait',
    server: 'Analysis failed to start',
    timeout: 'Analysis request timed out',
    config: 'Analysis service not configured',
    unknown: 'Failed to process analysis request',
  },
  research: {
    network: 'Unable to connect to research service',
    auth: 'Authentication required for keyword research',
    not_found: 'Research data not found',
    validation: 'Invalid research parameters',
    rate_limit: 'Research requests limited. Please wait',
    server: 'Keyword research failed',
    timeout: 'Research request timed out',
    config: 'Research service not configured',
    unknown: 'Failed to process research request',
  },
  rawResponses: {
    network: 'Unable to browse raw responses',
    auth: 'Authentication required to view responses',
    not_found: 'Response file not found',
    validation: 'Invalid file path',
    rate_limit: 'File requests limited. Please wait',
    server: 'Failed to load response data',
    timeout: 'File loading timed out',
    config: 'Raw responses not configured',
    unknown: 'Failed to load response data',
  },
};

function categorizeByStatusCode(statusCode: number): ErrorCategory | null {
  return STATUS_TO_CATEGORY[statusCode] ?? null;
}

function matchesNetworkError(msg: string): boolean {
  return msg.includes('network') || msg.includes('failed to fetch') || msg.includes('net::');
}

function matchesTimeoutError(msg: string): boolean {
  return msg.includes('timeout') || msg.includes('timed out');
}

function matchesAuthError(msg: string): boolean {
  return msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('401') || msg.includes('403');
}

function matchesNotFoundError(msg: string): boolean {
  return msg.includes('not found') || msg.includes('404');
}

function matchesRateLimitError(msg: string): boolean {
  return msg.includes('rate limit') || msg.includes('too many') || msg.includes('429');
}

function matchesConfigError(msg: string): boolean {
  return msg.includes('placeholder') || msg.includes('not configured') || msg.includes('environment');
}

function matchesValidationError(msg: string): boolean {
  return msg.includes('invalid') || msg.includes('validation') || msg.includes('400');
}

function matchesServerError(msg: string): boolean {
  return msg.includes('server') || msg.includes('500') || msg.includes('502') || msg.includes('503');
}

function categorizeByErrorMessage(msg: string): ErrorCategory | null {
  if (matchesNetworkError(msg)) return 'network';
  if (matchesTimeoutError(msg)) return 'timeout';
  if (matchesAuthError(msg)) return 'auth';
  if (matchesNotFoundError(msg)) return 'not_found';
  if (matchesRateLimitError(msg)) return 'rate_limit';
  if (matchesConfigError(msg)) return 'config';
  if (matchesValidationError(msg)) return 'validation';
  if (matchesServerError(msg)) return 'server';
  return null;
}

function categorizeError(error: unknown, statusCode?: number): ErrorCategory {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'unknown';
  }

  if (statusCode) {
    const category = categorizeByStatusCode(statusCode);
    if (category) return category;
  }

  if (error instanceof TypeError && error.message.includes('fetch')) {
    return 'network';
  }

  if (error instanceof Error) {
    const category = categorizeByErrorMessage(error.message.toLowerCase());
    if (category) return category;
  }

  return 'unknown';
}

class UnknownApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownApiError';
  }
}

/** Error thrown when an API request fails */
export class ApiRequestError extends Error {
  readonly statusCode?: number;
  readonly category: ErrorCategory;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.category = statusCode ? (categorizeByStatusCode(statusCode) ?? 'unknown') : 'unknown';
  }
}

/** Error thrown when API configuration is invalid */
export class ApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigError';
  }
}

export function parseApiError(
  error: unknown,
  context?: keyof typeof CONTEXT_MESSAGES,
  statusCode?: number
): ApiError {
  const category = categorizeError(error, statusCode);
  const categoryInfo = CATEGORY_MESSAGES[category];
  
  const contextMessage = context ? CONTEXT_MESSAGES[context]?.[category] : undefined;
  const message = contextMessage ?? categoryInfo.message;

  const originalError = error instanceof Error 
    ? error 
    : new UnknownApiError(String(error));

  return {
    message,
    category,
    originalError,
    statusCode,
    recoverable: categoryInfo.recoverable,
    suggestion: categoryInfo.suggestion,
  };
}

export function getErrorMessage(
  error: unknown,
  context?: keyof typeof CONTEXT_MESSAGES,
  statusCode?: number
): string {
  return parseApiError(error, context, statusCode).message;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function isRecoverableError(error: unknown, statusCode?: number): boolean {
  const category = categorizeError(error, statusCode);
  return CATEGORY_MESSAGES[category].recoverable;
}

export function createErrorHandler(
  setError: (error: string | null) => void,
  context?: keyof typeof CONTEXT_MESSAGES,
  onError?: (error: ApiError) => void
) {
  return (error: unknown, statusCode?: number) => {
    if (isAbortError(error)) {
      return;
    }
    
    const apiError = parseApiError(error, context, statusCode);
    setError(apiError.message);
    onError?.(apiError);
    
    console.error(`[${context ?? 'api'}] ${apiError.message}:`, apiError.originalError);
  };
}
