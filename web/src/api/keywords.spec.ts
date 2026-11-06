import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { apiPost } from './client';
import {
  IncompletePromotionError, promoteKeywords, type PromoteKeywordsResponse
} from './keywords';
import { MAX_WRITE_ROUNDS } from './writeRounds';
import { buildKeyword } from './keywordGroups-fixtures';

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

const legacyPromotionOutcome = {
  created: 0,
  skipped: 1,
  createdKeywords: [],
  createdItems: [],
  skippedKeywords: ['hotel coruña'],
  groupedKeywords: [],
};

describe('promoteKeywords', () => {
  beforeEach(() => {
    mockApiPost.mockReset();
  });

  it('normalizes grouped keywords to an empty list when legacy response omits the field', async () => {
    mockApiPost.mockResolvedValue(legacyPromotionResponseFixture);

    const promotionOutcome = await promoteKeywords({ keywords: [researchKeywordFixture] });

    expect(promotionOutcome).toStrictEqual(legacyPromotionOutcome);
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
      ...legacyPromotionOutcome,
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

  it.each([
    {
      condition: 'a market is chosen',
      marketId: 'cl-es',
      body: {
        keywords: [researchKeywordFixture],
        market_id: 'cl-es',
      },
    },
    {
      condition: 'no market is chosen',
      marketId: null,
      body: { keywords: [researchKeywordFixture] },
    },
  ])('sends the promoted keywords market only when $condition', async ({
    marketId, body
  }) => {
    mockApiPost.mockResolvedValue(legacyPromotionResponseFixture);

    await promoteKeywords({
      keywords: [researchKeywordFixture],
      marketId,
    });

    expect(mockApiPost).toHaveBeenCalledWith('/keywords/promote', body, expect.anything());
  });
});

const spa = {
  keyword: 'Hotel Coruña Spa',
  intent: 'commercial',
  competition: 'low',
  relevance: 80,
} satisfies ResearchKeyword;
const beach = {
  keyword: 'hotel coruña beach',
  intent: 'commercial',
  competition: 'low',
  relevance: 80,
} satisfies ResearchKeyword;
const centre = {
  keyword: 'hotel coruña centre',
  intent: 'informational',
  competition: 'low',
  relevance: 80,
} satisfies ResearchKeyword;

const firstRound = {
  created: 1,
  skipped: 1,
  created_keywords: [buildKeyword({
    id: 'kw-beach',
    keyword: 'hotel coruña beach',
  })],
  skipped_keywords: [{
    keyword: 'hotel coruña centre',
    reason: 'duplicate',
  }],
  grouped_keywords: [],
  pending_keywords: ['hotel coruña spa', 'hotel coruña centre'],
  truncated: true,
} satisfies PromoteKeywordsResponse;

const secondRound = {
  created: 1,
  skipped: 1,
  created_keywords: [buildKeyword({
    id: 'kw-spa',
    keyword: 'Hotel Coruña Spa',
  })],
  skipped_keywords: [{
    keyword: 'hotel coruña centre',
    reason: 'duplicate',
  }],
  grouped_keywords: ['hotel coruña centre'],
  pending_keywords: [],
  truncated: false,
} satisfies PromoteKeywordsResponse;

const stillPending = {
  ...secondRound,
  created: 0,
  created_keywords: [],
  grouped_keywords: [],
  pending_keywords: ['hotel coruña spa'],
  truncated: true,
} satisfies PromoteKeywordsResponse;

describe('promoteKeywords rounds', () => {
  beforeEach(() => {
    mockApiPost.mockReset();
  });

  it('re-sends only the pending keywords, matched by keyword identity', async () => {
    mockApiPost.mockResolvedValueOnce(firstRound).mockResolvedValueOnce(secondRound);

    await promoteKeywords({ keywords: [spa, beach, centre] });

    expect(mockApiPost.mock.calls.map(([, body]) => body)).toStrictEqual([
      { keywords: [spa, beach, centre] },
      { keywords: [spa, centre] },
    ]);
  });

  it('merges the rounds into one outcome counting each skip once', async () => {
    mockApiPost.mockResolvedValueOnce(firstRound).mockResolvedValueOnce(secondRound);

    const outcome = await promoteKeywords({ keywords: [spa, beach, centre] });

    expect(outcome).toStrictEqual({
      created: 2,
      skipped: 1,
      createdKeywords: ['hotel coruña beach', 'Hotel Coruña Spa'],
      createdItems: [...firstRound.created_keywords, ...secondRound.created_keywords],
      skippedKeywords: ['hotel coruña centre'],
      groupedKeywords: ['hotel coruña centre'],
    });
  });

  it('stops after ten requests with the written outcome on the error', async () => {
    mockApiPost.mockResolvedValueOnce(firstRound).mockResolvedValue(stillPending);

    const failure = await promoteKeywords({ keywords: [spa, beach, centre] }).catch((error: unknown) => error);

    expect(mockApiPost).toHaveBeenCalledTimes(MAX_WRITE_ROUNDS);
    expect(failure).toBeInstanceOf(IncompletePromotionError);
    expect(failure).toMatchObject({
      pendingCount: 1,
      message: '1 keyword added, but 1 could not be added after 10 attempts. Add them again to finish.',
      outcome: { createdKeywords: ['hotel coruña beach'] },
    });
  });

  it('stops the rounds when the request is aborted', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    mockApiPost.mockResolvedValueOnce(firstRound).mockRejectedValueOnce(abort);

    await expect(promoteKeywords({ keywords: [spa, beach, centre] })).rejects.toBe(abort);
    expect(mockApiPost).toHaveBeenCalledTimes(2);
  });

  it('sends one request when the answer leaves nothing pending', async () => {
    mockApiPost.mockResolvedValueOnce(secondRound);

    await promoteKeywords({ keywords: [spa] });

    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });
});
