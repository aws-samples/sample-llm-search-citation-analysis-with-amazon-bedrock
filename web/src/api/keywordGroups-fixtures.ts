import type {
  Keyword, KeywordGroup
} from '../types';

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
