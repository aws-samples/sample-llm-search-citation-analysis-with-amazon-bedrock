import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { apiPost } from './client';
import {
  promoteKeywords, type PromoteKeywordsResponse
} from './keywords';

import type { ResearchKeyword } from '../types';

vi.mock('./client', () => ({ apiPost: vi.fn() }));

const mockApiPost = vi.mocked(apiPost);

const researchKeywordFixture = {
  keyword: 'hotel coruña',
  intent: 'commercial',
  competition: 'high',
  relevance: 90,
} satisfies ResearchKeyword;

const legacyPromotionResponseFixture = {
  created: 0,
  skipped: 1,
  created_keywords: [],
  skipped_keywords: [{
    keyword: 'hotel coruña',
    reason: 'duplicate',
  }],
} satisfies PromoteKeywordsResponse;

describe('promoteKeywords', () => {
  beforeEach(() => {
    mockApiPost.mockReset();
  });

  it('normalizes grouped keywords to an empty list when legacy response omits the field', async () => {
    mockApiPost.mockResolvedValue(legacyPromotionResponseFixture);

    const promotionOutcome = await promoteKeywords({ keywords: [researchKeywordFixture] });

    expect(promotionOutcome).toStrictEqual({
      created: 0,
      skipped: 1,
      createdKeywords: [],
      createdItems: [],
      skippedKeywords: ['hotel coruña'],
      groupedKeywords: [],
    });
  });

  it('returns newly grouped keyword texts when response includes the field', async () => {
    mockApiPost.mockResolvedValue({
      ...legacyPromotionResponseFixture,
      grouped_keywords: ['hotel coruña'],
    });

    const promotionOutcome = await promoteKeywords({
      keywords: [researchKeywordFixture],
      groupIds: ['destination-group'],
    });

    expect(promotionOutcome).toStrictEqual({
      created: 0,
      skipped: 1,
      createdKeywords: [],
      createdItems: [],
      skippedKeywords: ['hotel coruña'],
      groupedKeywords: ['hotel coruña'],
    });
  });

  it.each([
    {
      condition: 'destination groups are omitted',
      groupIds: undefined,
    },
    {
      condition: 'destination groups are empty',
      groupIds: [],
    },
  ])('omits group_ids from request when $condition', async ({ groupIds }) => {
    mockApiPost.mockResolvedValue(legacyPromotionResponseFixture);

    await promoteKeywords({
      keywords: [researchKeywordFixture],
      groupIds,
    });

    expect(mockApiPost).toHaveBeenCalledWith(
      '/keywords/promote',
      { keywords: [researchKeywordFixture] },
      {
        signal: undefined,
        allowStructured4xx: true,
      }
    );
  });
});
