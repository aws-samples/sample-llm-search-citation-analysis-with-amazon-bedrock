import {
  describe, expect, it
} from 'vitest';
import {
  ApiRequestError,
  ApiConfigError,
  clientRejectionMessage,
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

describe('getErrorMessage categories', () => {
  it.each<{
    name: string;
    error: Error;
    expected: string 
  }>([
    {
      name: 'returns the network message for a fetch TypeError',
      error: new TypeError('Failed to fetch'),
      expected: 'Unable to connect to the server',
    },
    {
      name: 'returns the timeout message for a timeout error message',
      error: new TimeoutError(),
      expected: 'Request timed out',
    },
    {
      name: 'returns the auth message for an unauthorized error message',
      error: new UnauthorizedError(),
      expected: 'Authentication required',
    },
    {
      name: 'returns the permission message for the status embedded in an ApiRequestError',
      error: new ApiRequestError('Request rejected', 403),
      expected: 'You do not have permission to perform this action',
    },
    {
      name: 'returns the rate-limit message for a 429 ApiRequestError',
      error: new ApiRequestError('Request rejected', 429),
      expected: 'Too many requests',
    },
    {
      name: 'returns the rate-limit message for a rate-limit error message',
      error: new RateLimitError(),
      expected: 'Too many requests',
    },
  ])('$name', ({
    error, expected
  }) => {
    expect(getErrorMessage(error)).toBe(expected);
  });

  it('returns context-specific message when context provided', () => {
    expect(getErrorMessage(new NetworkError(), 'dashboard')).toBe('Unable to load dashboard data');
  });
});

describe('getErrorMessage', () => {
  it('returns the context message for a fetch failure', () => {
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

describe('getErrorMessage server-text gating', () => {
  it('suppresses the response message on a 500 server error', () => {
    const error = new ApiRequestError('server', {
      statusCode: 500,
      responseMessage: 'Traceback: internal details',
    });

    expect(getErrorMessage(error)).toBe('Server error occurred');
  });

  it('suppresses the response message on a 408 timeout', () => {
    const error = new ApiRequestError('timeout', {
      statusCode: 408,
      responseMessage: 'upstream stalled',
    });

    expect(getErrorMessage(error)).toBe('Request timed out');
  });
});
