import {
  describe, expect, it
} from 'vitest';
import identityFixtures from '../../../test-fixtures/keyword-identity.json';
import {
  keywordSelectionKey, uniqueResearchKeywords
} from './usePromoteKeywords';
import type { ResearchKeyword } from '../types';

describe('keywordSelectionKey', () => {
  it.each(identityFixtures.valid)(
    'returns $expected when input contains $description',
    ({
      input, expected
    }) => {
      expect(keywordSelectionKey(input)).toBe(expected);
    }
  );

  it.each(identityFixtures.boundaryWhitespace)(
    'returns alpha when input has $description boundaries',
    ({ codePoint }) => {
      const boundary = String.fromCodePoint(codePoint);

      expect(keywordSelectionKey(`${boundary}ALPHA${boundary}`)).toBe('alpha');
    }
  );

  it.each(identityFixtures.preservedBoundaryControls)(
    'preserves $description when it appears at both boundaries',
    ({ codePoint }) => {
      const control = String.fromCodePoint(codePoint);

      expect(keywordSelectionKey(`${control}ALPHA${control}`)).toBe(
        `${control}alpha${control}`
      );
    }
  );

  it.each(identityFixtures.invalid)(
    'returns empty key when input contains $description',
    ({ codeUnits }) => {
      const text = String.fromCharCode(...codeUnits);

      expect(keywordSelectionKey(text)).toBe('');
    }
  );

  it('excludes research row when keyword contains an unpaired surrogate', () => {
    const malformedKeyword = [{
      keyword: String.fromCharCode(0xD800),
      intent: 'commercial',
      competition: 'low',
      relevance: 80,
    }] satisfies ResearchKeyword[];

    expect(uniqueResearchKeywords(malformedKeyword)).toStrictEqual([]);
  });
});
