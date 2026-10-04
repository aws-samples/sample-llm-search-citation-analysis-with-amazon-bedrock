import type { KeywordGroup } from '../../../types';
import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';

export const AGENT_PROPOSAL_GROUPS = [
  {
    id: 'g1',
    name: 'Hotel Gran Marino',
    description: '',
    keyword_count: 12,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'g2',
    name: 'Hotel Atlántico',
    description: '',
    keyword_count: 4,
    created_at: '',
    updated_at: '',
  },
] satisfies KeywordGroup[];

/** The parsed JSON body of the first request sent through `authenticatedFetch`. */
export function firstRequestBody(): unknown {
  const [, init] = mockAuthenticatedFetch.mock.calls[0];
  return JSON.parse(String(init?.body));
}
