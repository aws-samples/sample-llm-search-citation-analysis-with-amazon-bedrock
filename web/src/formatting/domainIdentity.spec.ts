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
});
