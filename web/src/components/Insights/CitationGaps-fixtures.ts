import type { ComponentProps } from 'react';
import type { Keyword } from '../../types';
import type { CitationGaps } from './CitationGaps';

const KEYWORDS: Keyword[] = [
  {
    id: 'kw-1',
    keyword: 'hotels',
    created_at: '2026-01-01T00:00:00Z',
    group_ids: ['group-coruna']
  },
  {
    id: 'kw-2',
    keyword: 'resorts',
    created_at: '2026-01-02T00:00:00Z'
  },
];

export function buildProps(
  overrides: Partial<ComponentProps<typeof CitationGaps>> = {}
): ComponentProps<typeof CitationGaps> {
  return {
    keywords: KEYWORDS,
    ...overrides,
  };
}
