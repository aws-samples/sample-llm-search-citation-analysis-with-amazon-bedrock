import {
  describe, expect, it
} from 'vitest';
import domainFixtures from '../../../test-fixtures/domain-identity.json';
import { normalizeDomain } from './domainIdentity';

describe('normalizeDomain', () => {
  it.each(domainFixtures.cases)(
    'returns $expected for $description',
    ({
      input, expected
    }) => {
      expect(normalizeDomain(input)).toBe(expected);
    }
  );

  it.each([
    ['a scheme with a digit', 'h2://example.com/feed', 'example.com'],
    ['a scheme-relative URL', '//example.com/rooms', 'example.com'],
    ['several leading dots on a bare domain', '..example.com', 'example.com'],
  ])('returns the host for %s', (_description, input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});
