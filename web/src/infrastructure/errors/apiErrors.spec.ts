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

/** One `parseApiError` call (`error` plus the optional context and status) and the one field it must set. */
interface ParseApiErrorCase {
  name: string;
  error: Error;
  args: Parameters<typeof parseApiError> extends [unknown, ...infer TRest] ? TRest : never;
  field: keyof ReturnType<typeof parseApiError>;
  expected: unknown;
}

describe('parseApiError', () => {
  it.each<ParseApiErrorCase>([
    {
      name: 'returns network category for fetch TypeError',
      error: new TypeError('Failed to fetch'),
      args: [],
      field: 'category',
      expected: 'network',
    },
    {
      name: 'returns timeout category for timeout message',
      error: new TimeoutError(),
      args: [],
      field: 'category',
      expected: 'timeout',
    },
    {
      name: 'returns auth category for 401 status code',
      error: new UnauthorizedError(),
      args: [undefined, 401],
      field: 'category',
      expected: 'auth',
    },
    {
      name: 'returns status code embedded in ApiRequestError',
      error: new ApiRequestError('HTTP 403: Forbidden', 403),
      args: [],
      field: 'statusCode',
      expected: 403,
    },
    {
      name: 'returns category inferred from ApiRequestError status',
      error: new ApiRequestError('Request rejected', 429),
      args: [],
      field: 'category',
      expected: 'rate_limit',
    },
    {
      name: 'returns context-specific message when context provided',
      error: new NetworkError(),
      args: ['dashboard'],
      field: 'message',
      expected: 'Unable to load dashboard data',
    },
    {
      name: 'returns generic message when no context provided',
      error: new TypeError('Failed to fetch'),
      args: [],
      field: 'message',
      expected: 'Unable to connect to the server',
    },
    {
      name: 'sets recoverable to true for network errors',
      error: new TypeError('Failed to fetch'),
      args: [],
      field: 'recoverable',
      expected: true,
    },
    {
      name: 'sets recoverable to false for auth errors',
      error: new UnauthorizedError(),
      args: [undefined, 401],
      field: 'recoverable',
      expected: false,
    },
    {
      name: 'includes suggestion for error category',
      error: new RateLimitError(),
      args: [],
      field: 'suggestion',
      expected: 'Please wait a moment before trying again',
    },
  ])('$name', ({
    error, args, field, expected
  }) => {
    const result = parseApiError(error, ...args);

    expect(result[field]).toBe(expected);
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

  it('returns citation-gap network copy when the browser fetch fails', () => {
    expect(getErrorMessage(new TypeError('Failed to fetch'), 'citationGaps'))
      .toBe('Unable to load citation gaps');
  });

  it('returns citation-gap server copy when the API responds with 500', () => {
    expect(getErrorMessage(new ApiRequestError('HTTP 500', 500), 'citationGaps'))
      .toBe('Failed to load citation gaps');
  });

  it('returns citation-gap timeout copy when the gateway responds with 504', () => {
    expect(getErrorMessage(new ApiRequestError('HTTP 504', 504), 'citationGaps'))
      .toBe('Citation gap analysis timed out');
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
