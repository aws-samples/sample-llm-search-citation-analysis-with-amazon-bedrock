import {
  describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import { renderSelectedPromotion } from './usePromoteKeywords-fixtures';
import { buildKeyword } from '../api/keywordGroups-fixtures';
import type { Keyword } from '../types';

vi.mock('../api/client', () => ({ apiPost: vi.fn() }));
vi.mock('../api/keywords', async () => {
  const actual = await vi.importActual<typeof import('../api/keywords')>('../api/keywords');
  return {
    ...actual,
    promoteKeywords: vi.fn(),
  };
});

import {
  IncompletePromotionError, promoteKeywords
} from '../api/keywords';

const mockPromote = vi.mocked(promoteKeywords);
const alpha = buildKeyword({
  id: 'keyword-1',
  keyword: 'alpha',
});

const incomplete = new IncompletePromotionError({
  created: 1,
  skipped: 0,
  createdKeywords: ['alpha'],
  createdItems: [alpha],
  skippedKeywords: [],
  groupedKeywords: [],
}, 2);

/** Renders the hook, selects 'alpha' and promotes it through rounds that end incomplete. */
async function renderIncompletePromotion(onKeywordsAdded?: (created: Keyword[]) => void) {
  mockPromote.mockRejectedValue(incomplete);
  const rendered = renderSelectedPromotion({ onKeywordsAdded });
  await act(() => rendered.result.current.promote());
  return rendered.result;
}

describe('promotion left incomplete after every round', () => {
  it('shows how many keywords could not be added', async () => {
    const result = await renderIncompletePromotion();

    expect(result.current.error).toBe('1 keyword added, but 2 could not be added after 10 attempts. Add them again to finish.');
  });

  it('hands the keywords the rounds did add to the caller', async () => {
    const onKeywordsAdded = vi.fn();

    await renderIncompletePromotion(onKeywordsAdded);

    expect(onKeywordsAdded).toHaveBeenCalledWith([alpha]);
  });

  it('unticks the keywords the rounds did add', async () => {
    const result = await renderIncompletePromotion();

    expect(result.current.selectedCount).toBe(0);
  });
});
