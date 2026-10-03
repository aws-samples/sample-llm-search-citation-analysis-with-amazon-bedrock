import type {
  Keyword, KeywordGroup
} from '../types';
import type { GroupMembershipResponse } from '../types/domain/keywordDecoders';
import { mockApiPut } from './clientMock-fixtures';

export function buildGroup(overrides: Partial<KeywordGroup> = {}): KeywordGroup {
  return {
    id: 'group-coruna',
    name: 'Hotel Coruña',
    description: 'Galicia property',
    keyword_count: 2,
    created_at: '2026-09-18T09:00:00Z',
    updated_at: '2026-09-18T09:00:00Z',
    ...overrides,
  };
}

export function buildKeyword(overrides: Partial<Keyword> = {}): Keyword {
  return {
    id: 'kw-1',
    keyword: 'hotel coruña spa',
    created_at: '2026-09-18T09:00:00Z',
    status: 'active',
    ...overrides,
  };
}

/** The request bodies of every mocked `apiPut` call, in call order. */
export function sentPutBodies(): unknown[] {
  return mockApiPut.mock.calls.map(([, body]) => body);
}

export const groupsResponseFixture = {
  groups: [
    buildGroup(),
    buildGroup({
      id: 'group-marino',
      name: 'Hotel Gran Marino',
      keyword_count: 0 
    }),
  ],
  count: 2,
};

export const membershipResponseFixture = {
  group_id: 'group-coruna',
  added: ['kw-1'],
  removed: [],
  missing: ['ghost'],
  keywords: [buildKeyword({ group_ids: ['group-coruna'] })],
};

/** `count` distinct keyword ids, `${prefix}-1` onwards. */
export function buildKeywordIds(count: number, prefix = 'kw'): string[] {
  return Array.from({ length: count }, (_unused, index) => `${prefix}-${index + 1}`);
}

/** A PUT /keyword-groups/{id}/keywords response; every field can be overridden. */
export function buildMembershipResponse(
  overrides: Partial<GroupMembershipResponse> = {}
): GroupMembershipResponse {
  return {
    group_id: 'group-coruna',
    added: [],
    removed: [],
    missing: [],
    keywords: [],
    ...overrides,
  };
}
