import {
  describe, expect, it
} from 'vitest';
import {
  isAlertsResponse, isContentChangeMarker
} from './alerts';
import { buildContentChangeMarkerCandidate } from './alerts-fixtures';

describe('alert decoder coercion boundaries', () => {
  it('rejects an undefined alert-list payload', () => {
    expect(isAlertsResponse(undefined)).toBe(false);
  });

  it('rejects an array TTL that stringifies to a positive integer', () => {
    const candidate = buildContentChangeMarkerCandidate({ ttl: [1] });

    expect(isContentChangeMarker(candidate)).toBe(false);
  });

  it('rejects an object URL that stringifies to HTTPS', () => {
    const urlCandidate = { toString: () => 'https://example.com/coerced' };
    const candidate = buildContentChangeMarkerCandidate({ url: urlCandidate });

    expect(isContentChangeMarker(candidate)).toBe(false);
  });
});
