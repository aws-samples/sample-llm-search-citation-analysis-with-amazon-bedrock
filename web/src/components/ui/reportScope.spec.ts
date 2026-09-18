import {
  describe, it, expect 
} from 'vitest';
import {
  ALL_SCOPE,
  decodeReportScope,
  describeReportScope,
  encodeReportScope,
  isReportScopeAvailable,
  reportScopeParams,
  reportScopesEqual,
} from './reportScope';
import type {
  Keyword, KeywordGroup 
} from '../../types';

const groups: KeywordGroup[] = [{
  id: 'g1',
  name: 'Hotel Coruña',
  description: '',
  keyword_count: 3,
  created_at: '',
  updated_at: '',
}];
const keywords: Keyword[] = [{
  id: 'k1',
  keyword: 'hotel coruna spa',
  created_at: '' 
}];

describe('encodeReportScope / decodeReportScope', () => {
  it('round-trips every scope kind', () => {
    const scopes = [ALL_SCOPE, {
      kind: 'group',
      groupId: 'g1' 
    }, {
      kind: 'keyword',
      keyword: 'hotel: spa' 
    }] as const;

    expect(scopes.map((scope) => decodeReportScope(encodeReportScope(scope)))).toStrictEqual([...scopes]);
  });

  it('keeps colons inside a keyword', () => {
    expect(decodeReportScope('keyword:a:b')).toStrictEqual({
      kind: 'keyword',
      keyword: 'a:b' 
    });
  });

  it('decodes anything unknown as all keywords', () => {
    expect(decodeReportScope('garbage')).toStrictEqual(ALL_SCOPE);
  });
});

describe('reportScopeParams', () => {
  it('sends keyword= for a keyword', () => {
    expect(reportScopeParams({
      kind: 'keyword',
      keyword: 'hotel coruna spa' 
    })).toStrictEqual({ keyword: 'hotel coruna spa' });
  });

  it('sends group_id= for a group', () => {
    expect(reportScopeParams({
      kind: 'group',
      groupId: 'g1' 
    })).toStrictEqual({ group_id: 'g1' });
  });

  it('sends scope=all for every keyword', () => {
    expect(reportScopeParams(ALL_SCOPE)).toStrictEqual({ scope: 'all' });
  });
});

describe('describeReportScope', () => {
  it('names the group', () => {
    expect(describeReportScope({
      kind: 'group',
      groupId: 'g1' 
    }, groups)).toBe('Hotel Coruña');
  });

  it('flags a group that no longer exists', () => {
    expect(describeReportScope({
      kind: 'group',
      groupId: 'gone' 
    }, groups)).toBe('Deleted group');
  });

  it('echoes the keyword and labels all keywords', () => {
    expect(describeReportScope({
      kind: 'keyword',
      keyword: 'x' 
    }, groups)).toBe('x');
    expect(describeReportScope(ALL_SCOPE, groups)).toBe('All keywords');
  });
});

describe('isReportScopeAvailable', () => {
  it('is true for all keywords, an existing group and an existing keyword', () => {
    expect(isReportScopeAvailable(ALL_SCOPE, keywords, groups)).toBe(true);
    expect(isReportScopeAvailable({
      kind: 'group',
      groupId: 'g1' 
    }, keywords, groups)).toBe(true);
    expect(isReportScopeAvailable({
      kind: 'keyword',
      keyword: 'hotel coruna spa' 
    }, keywords, groups)).toBe(true);
  });

  it('is false for a deleted group or keyword', () => {
    expect(isReportScopeAvailable({
      kind: 'group',
      groupId: 'gone' 
    }, keywords, groups)).toBe(false);
    expect(isReportScopeAvailable({
      kind: 'keyword',
      keyword: 'gone' 
    }, keywords, groups)).toBe(false);
  });
});

describe('reportScopesEqual', () => {
  it('compares by value', () => {
    expect(reportScopesEqual({
      kind: 'group',
      groupId: 'g1' 
    }, {
      kind: 'group',
      groupId: 'g1' 
    })).toBe(true);
    expect(reportScopesEqual(ALL_SCOPE, {
      kind: 'group',
      groupId: 'g1' 
    })).toBe(false);
  });
});
