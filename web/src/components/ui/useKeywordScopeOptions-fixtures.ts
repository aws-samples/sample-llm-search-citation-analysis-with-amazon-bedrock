import type { Keyword } from '../../types';

/**
 * Two active keywords — `hotels` in the Coruña group and the ungrouped
 * `resorts` — the list the scope-selecting views render in their specs.
 */
export const SCOPE_KEYWORDS: Keyword[] = [
  {
    id: 'kw-1',
    keyword: 'hotels',
    created_at: '2026-01-01T00:00:00Z',
    group_ids: ['group-coruna'],
  },
  {
    id: 'kw-2',
    keyword: 'resorts',
    created_at: '2026-01-02T00:00:00Z',
  },
];
