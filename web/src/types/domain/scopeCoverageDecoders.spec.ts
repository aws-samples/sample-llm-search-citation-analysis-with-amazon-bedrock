import {
  describe, expect, it
} from 'vitest';
import {
  computingBodies, cursorExpiredBodies, failedBodies, fixtureBody, scopedBodies, scopedCoverages
} from './scopeCoverage-fixtures';
import {
  hasScopedResponseFields,
  isComputingResponse,
  isCursorExpiredBody,
  isFailedViewJobResponse,
  isScopeCoverage,
  isScopeSourceEnvelope,
} from './scopeCoverageDecoders';

describe('isScopeCoverage', () => {
  it('accepts a complete coverage', () => {
    expect(isScopeCoverage({
      keywords_total: 5000,
      keywords_analyzed: 5000,
      complete: true
    })).toBe(true);
  });

  it('accepts an empty scope', () => {
    expect(isScopeCoverage({
      keywords_total: 0,
      keywords_analyzed: 0,
      complete: true
    })).toBe(true);
  });

  it.each([
    ['more keywords analyzed than exist', {
      keywords_total: 10,
      keywords_analyzed: 11,
      complete: false
    }],
    ['a fractional count', {
      keywords_total: 10.5,
      keywords_analyzed: 1,
      complete: false
    }],
    ['a negative count', {
      keywords_total: 10,
      keywords_analyzed: -1,
      complete: false
    }],
    ['a missing flag', {
      keywords_total: 10,
      keywords_analyzed: 10
    }],
    ['a list', [5000, 5000, true]],
  ])('rejects %s', (_description, value) => {
    expect(isScopeCoverage(value)).toBe(false);
  });
});

describe('isScopeSourceEnvelope', () => {
  it('accepts live figures without as_of', () => {
    expect(isScopeSourceEnvelope({
      source: 'live',
      as_of: null,
      stale: false,
      refreshing: false
    })).toBe(true);
  });

  it('accepts a stale snapshot being refreshed', () => {
    expect(isScopeSourceEnvelope({
      source: 'snapshot',
      as_of: '2026-10-12T07:14:05Z',
      stale: true,
      refreshing: true
    })).toBe(true);
  });

  it.each([
    ['an unknown source', {
      source: 'cache',
      as_of: null,
      stale: false,
      refreshing: false
    }],
    ['a missing refreshing flag', {
      source: 'live',
      as_of: null,
      stale: false
    }],
    ['a numeric as_of', {
      source: 'snapshot',
      as_of: 1760253245,
      stale: false,
      refreshing: false
    }],
  ])('rejects %s', (_description, value) => {
    expect(isScopeSourceEnvelope(value)).toBe(false);
  });
});

describe('hasScopedResponseFields', () => {
  it('accepts a body from an API build before the contract', () => {
    expect(hasScopedResponseFields({ keywords_truncated: false })).toBe(true);
  });

  it('rejects a malformed coverage', () => {
    expect(hasScopedResponseFields({ coverage: { keywords_total: 5 } })).toBe(false);
  });

  it('rejects a non-boolean stale flag', () => {
    expect(hasScopedResponseFields({ stale: 'yes' })).toBe(false);
  });
});

describe('isComputingResponse', () => {
  it('rejects a body without a positive retry interval', () => {
    expect(isComputingResponse({
      status: 'computing',
      job: {
        id: 'job-1',
        started_at: '2026-10-12T07:20:11Z'
      },
      retry_after_ms: 0
    })).toBe(false);
  });

  it('rejects a body without a job', () => {
    expect(isComputingResponse({
      status: 'computing',
      retry_after_ms: 2000
    })).toBe(false);
  });

  it('rejects a failed job', () => {
    expect(isComputingResponse(fixtureBody('visibility', 'failed'))).toBe(false);
  });
});

describe('isCursorExpiredBody', () => {
  it('rejects the usual invalid-token 400', () => {
    expect(isCursorExpiredBody({
      error: 'Invalid next_token',
      field: 'next_token'
    })).toBe(false);
  });
});

describe('isFailedViewJobResponse', () => {
  it('rejects a computing body', () => {
    expect(isFailedViewJobResponse(fixtureBody('visibility', 'computing'))).toBe(false);
  });
});

describe('the scope-snapshot fixtures', () => {
  it.each(scopedCoverages)('%s %s carries a valid coverage', (_route, _case, coverage) => {
    expect(isScopeCoverage(coverage)).toBe(true);
  });

  it.each(scopedBodies)('%s %s carries a valid source envelope', (_route, _case, body) => {
    expect(isScopeSourceEnvelope(body)).toBe(true);
  });

  it.each(computingBodies)('%s %s is a computing body', (_route, _case, body) => {
    expect(isComputingResponse(body)).toBe(true);
  });

  it.each(failedBodies)('%s %s is a failed view job', (_route, _case, body) => {
    expect(isFailedViewJobResponse(body)).toBe(true);
  });

  it.each(cursorExpiredBodies)('%s %s is a cursor_expired body', (_route, _case, body) => {
    expect(isCursorExpiredBody(body)).toBe(true);
  });

  it('covers the paged routes with cursor_expired examples', () => {
    expect(cursorExpiredBodies.map(([route]) => route)).toStrictEqual([
      'brand-mentions-appearances',
      'brand-mentions',
      'citation-gaps',
      'group-kpis-keywords',
      'group-kpis',
      'recommendations',
      'reports-competitor',
      'sentiment-examples',
      'trends',
      'visibility',
    ]);
  });
});
