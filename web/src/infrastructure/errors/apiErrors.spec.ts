import {
  describe, expect, it
} from 'vitest';
import {
  ApiRequestError,
  ApiConfigError,
  clientRejectionMessage,
  parseApiError,
  getErrorMessage,
  isAbortError,
  isDefinitiveClientRejection,
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

  it('stores structured response details from options', () => {
    const error = new ApiRequestError('Keyword is invalid', {
      statusCode: 400,
      responseMessage: 'Keyword is invalid',
      field: 'keywords[0].keyword',
    });

    expect({
      statusCode: error.statusCode,
      responseMessage: error.responseMessage,
      field: error.field,
    }).toStrictEqual({
      statusCode: 400,
      responseMessage: 'Keyword is invalid',
      field: 'keywords[0].keyword',
    });
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

  it('returns status code embedded in ApiRequestError', () => {
    const error = new ApiRequestError('HTTP 403: Forbidden', 403);

    const result = parseApiError(error);

    expect(result.statusCode).toBe(403);
  });

  it('returns category inferred from ApiRequestError status', () => {
    const error = new ApiRequestError('Request rejected', 429);

    const result = parseApiError(error);

    expect(result.category).toBe('rate_limit');
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

  it('preserves explicitly decoded response message', () => {
    const error = new ApiRequestError('HTTP 400: Bad Request', {
      statusCode: 400,
      responseMessage: 'Keyword already exists',
    });

    const message = getErrorMessage(error, 'keywords');

    expect(message).toBe('Keyword already exists');
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

describe('isDefinitiveClientRejection', () => {
  it('accepts a 400 validation rejection', () => {
    const error = new ApiRequestError('rejected', {
      statusCode: 400,
      responseMessage: 'Keyword must not be empty',
    });

    expect(isDefinitiveClientRejection(error)).toBe(true);
  });

  it('accepts a 409 conflict rejection', () => {
    const error = new ApiRequestError('conflict', { statusCode: 409 });

    expect(isDefinitiveClientRejection(error)).toBe(true);
  });

  it('rejects a 408 because a timed-out request may still have completed', () => {
    const error = new ApiRequestError('timeout', {
      statusCode: 408,
      responseMessage: 'Request Timeout',
    });

    expect(isDefinitiveClientRejection(error)).toBe(false);
  });

  it('rejects a 500 server error', () => {
    const error = new ApiRequestError('server', { statusCode: 500 });

    expect(isDefinitiveClientRejection(error)).toBe(false);
  });

  it('rejects an ApiRequestError without a status code', () => {
    expect(isDefinitiveClientRejection(new ApiRequestError('no status'))).toBe(false);
  });

  it('rejects plain transport errors', () => {
    expect(isDefinitiveClientRejection(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('clientRejectionMessage', () => {
  it('returns the server message for a definitive rejection', () => {
    const error = new ApiRequestError('rejected', {
      statusCode: 409,
      responseMessage: 'Keyword already exists',
    });

    expect(clientRejectionMessage(error)).toBe('Keyword already exists');
  });

  it('appends the field pointer when includeField is set', () => {
    const error = new ApiRequestError('rejected', {
      statusCode: 400,
      responseMessage: 'Keyword must be a string',
      field: 'keywords[2].keyword',
    });

    expect(clientRejectionMessage(error, 'keywords', { includeField: true }))
      .toBe('Keyword must be a string (field: keywords[2].keyword)');
  });

  it('omits the field pointer by default', () => {
    const error = new ApiRequestError('rejected', {
      statusCode: 400,
      responseMessage: 'Keyword must be a string',
      field: 'keyword',
    });

    expect(clientRejectionMessage(error)).toBe('Keyword must be a string');
  });
});

describe('parseApiError server-text gating', () => {
  it('suppresses the response message on a 500 server error', () => {
    const error = new ApiRequestError('server', {
      statusCode: 500,
      responseMessage: 'Traceback: internal details',
    });

    const parsed = parseApiError(error);

    expect(parsed.message).toBe('Server error occurred');
  });

  it('suppresses the response message on a 408 timeout', () => {
    const error = new ApiRequestError('timeout', {
      statusCode: 408,
      responseMessage: 'upstream stalled',
    });

    expect(parseApiError(error).message).toBe('Request timed out');
  });
});
