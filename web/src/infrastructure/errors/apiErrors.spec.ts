import {
  describe, it, expect 
} from 'vitest';
import {
  ApiRequestError,
  ApiConfigError,
  parseApiError,
  getErrorMessage,
  isAbortError,
  isRecoverableError,
} from './apiErrors';

class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

class NetworkError extends Error {
  constructor(message = 'Network error') {
    super(message);
    this.name = 'NetworkError';
  }
}

class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

class AbortedError extends Error {
  constructor(message = 'Aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

class GenericTestError extends Error {
  constructor(message = 'Some error') {
    super(message);
    this.name = 'GenericTestError';
  }
}

describe('ApiRequestError', () => {
  it('sets name to ApiRequestError', () => {
    const error = new ApiRequestError('test error');

    expect(error.name).toBe('ApiRequestError');
  });

  it('stores statusCode when provided', () => {
    const error = new ApiRequestError('test error', 404);

    expect(error.statusCode).toBe(404);
  });

  it('sets category based on statusCode', () => {
    expect(new ApiRequestError('test', 401).category).toBe('auth');
    expect(new ApiRequestError('test', 404).category).toBe('not_found');
    expect(new ApiRequestError('test', 429).category).toBe('rate_limit');
    expect(new ApiRequestError('test', 500).category).toBe('server');
  });

  it('sets category to unknown when statusCode not mapped', () => {
    const error = new ApiRequestError('test', 418);

    expect(error.category).toBe('unknown');
  });
});

describe('ApiConfigError', () => {
  it('sets name to ApiConfigError', () => {
    const error = new ApiConfigError('config error');

    expect(error.name).toBe('ApiConfigError');
  });

  it('stores message', () => {
    const error = new ApiConfigError('API not configured');

    expect(error.message).toBe('API not configured');
  });
});

describe('parseApiError', () => {
  it('returns network category for fetch TypeError', () => {
    const error = new TypeError('Failed to fetch');

    const result = parseApiError(error);

    expect(result.category).toBe('network');
  });

  it('returns timeout category for timeout message', () => {
    const error = new TimeoutError();

    const result = parseApiError(error);

    expect(result.category).toBe('timeout');
  });

  it('returns auth category for 401 status code', () => {
    const error = new UnauthorizedError();

    const result = parseApiError(error, undefined, 401);

    expect(result.category).toBe('auth');
  });

  it('returns context-specific message when context provided', () => {
    const error = new NetworkError();

    const result = parseApiError(error, 'dashboard');

    expect(result.message).toBe('Unable to load dashboard data');
  });

  it('returns generic message when no context provided', () => {
    const error = new TypeError('Failed to fetch');

    const result = parseApiError(error);

    expect(result.message).toBe('Unable to connect to the server');
  });

  it('sets recoverable to true for network errors', () => {
    const error = new TypeError('Failed to fetch');

    const result = parseApiError(error);

    expect(result.recoverable).toBe(true);
  });

  it('sets recoverable to false for auth errors', () => {
    const error = new UnauthorizedError();

    const result = parseApiError(error, undefined, 401);

    expect(result.recoverable).toBe(false);
  });

  it('includes suggestion for error category', () => {
    const error = new RateLimitError();

    const result = parseApiError(error);

    expect(result.suggestion).toBe('Please wait a moment before trying again');
  });
});

describe('getErrorMessage', () => {
  it('returns message string from parseApiError', () => {
    const error = new TypeError('Failed to fetch');

    const message = getErrorMessage(error, 'brands');

    expect(message).toBe('Unable to load brand mentions');
  });
});

describe('isAbortError', () => {
  it('returns true for error with name AbortError', () => {
    const error = new AbortedError();

    expect(isAbortError(error)).toBe(true);
  });

  it('returns false for other errors', () => {
    const error = new GenericTestError();

    expect(isAbortError(error)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isAbortError('string')).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('isRecoverableError', () => {
  it('returns true for network errors', () => {
    const error = new TypeError('Failed to fetch');

    expect(isRecoverableError(error)).toBe(true);
  });

  it('returns true for rate limit errors', () => {
    const error = new RateLimitError();

    expect(isRecoverableError(error, 429)).toBe(true);
  });

  it('returns false for auth errors', () => {
    const error = new UnauthorizedError();

    expect(isRecoverableError(error, 401)).toBe(false);
  });

  it('returns false for not found errors', () => {
    const error = new NotFoundError();

    expect(isRecoverableError(error, 404)).toBe(false);
  });
});
