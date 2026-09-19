import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  renderHook, act
} from '@testing-library/react';
import { uniqueResearchKeywords } from './keywordIdentity';
import {
  reduceSelection,
  initialSelectionState,
  promotionSuccessMessage,
  usePromoteKeywords,
  SELECTION_LIMIT,
  SELECTION_LIMIT_MESSAGE,
} from './usePromoteKeywords';
import {
  abortedPromotionRequest,
  availableKeywordFixtures,
  createMockPromotionRequest,
  createdKeywordItemFixture,
  fullProposalKeywordFixtures,
  renderPendingPromotion,
  renderSelectedPromotion,
  replacementAvailableKeywordFixtures,
  successfulFullProposalResponseFixture,
} from './usePromoteKeywords-fixtures';

import type {
  SelectionState, UsePromoteKeywords
} from './usePromoteKeywords';
import { promoteKeywords } from '../api/keywords';

vi.mock('../api/client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '../api/client';

const mockApiPost = vi.mocked(apiPost);

/**
 * A selection of exactly SELECTION_LIMIT texts, built programmatically so the
 * cap boundary is exercised without hand-writing 500 literals.
 */
const atCapSelection = Array.from(
  { length: SELECTION_LIMIT },
  (_unused, index) => `capped keyword ${index}`
);

describe('Property 12: Selection toggling never exceeds the 500-item cap', () => {
  const togglingFixtures = [
    {
      scenario: 'adding an unselected keyword below the cap',
      initialSelected: ['alpha'],
      toggles: ['beta'],
      expectedSelected: ['alpha', 'beta'],
      expectedLimitMessage: null,
    },
    {
      scenario: 'toggling off an already-selected keyword',
      initialSelected: ['alpha', 'beta', 'gamma'],
      toggles: ['beta'],
      expectedSelected: ['alpha', 'gamma'],
      expectedLimitMessage: null,
    },
    {
      scenario: 'adding a keyword while already at the cap',
      initialSelected: atCapSelection,
      toggles: ['overflow keyword'],
      expectedSelected: atCapSelection,
      expectedLimitMessage: SELECTION_LIMIT_MESSAGE,
    },
    {
      scenario: 'repeatedly toggling one keyword on, off, then on again',
      initialSelected: [],
      toggles: ['alpha', 'alpha', 'alpha'],
      expectedSelected: ['alpha'],
      expectedLimitMessage: null,
    },
    {
      scenario: 'reaching the cap with the 500th add and rejecting the 501st',
      initialSelected: atCapSelection.slice(0, SELECTION_LIMIT - 1),
      toggles: [`capped keyword ${SELECTION_LIMIT - 1}`, 'overflow keyword'],
      expectedSelected: atCapSelection,
      expectedLimitMessage: SELECTION_LIMIT_MESSAGE,
    },
    {
      scenario: 'toggling off a selected keyword while at the cap',
      initialSelected: atCapSelection,
      toggles: ['capped keyword 0'],
      expectedSelected: atCapSelection.slice(1),
      expectedLimitMessage: null,
    },
  ];

  it.each(togglingFixtures)(
    'keeps the selection within the cap when $scenario',
    ({
      initialSelected, toggles, expectedSelected, expectedLimitMessage
    }) => {
      const seedState: SelectionState = {
        ...initialSelectionState,
        selected: initialSelected,
      };

      const finalState = toggles.reduce<SelectionState>(
        (selection, keyword) => reduceSelection(selection, {
          type: 'toggle',
          keyword,
        }),
        seedState
      );

      expect(finalState.selected).toStrictEqual(expectedSelected);
      expect(finalState.limitMessage).toBe(expectedLimitMessage);
      expect(finalState.selected.length).toBeLessThanOrEqual(SELECTION_LIMIT);
    }
  );
});

describe('recommended selection replacement', () => {
  it('replaces the current selection with normalized unique recommendation keys', () => {
    const selection = reduceSelection({
      selected: ['old'],
      limitMessage: SELECTION_LIMIT_MESSAGE,
    }, {
      type: 'replace',
      keywords: [' Alpha ', 'ＡＬＰＨＡ', 'beta'],
    });

    expect(selection).toStrictEqual({
      selected: ['alpha', 'beta'],
      limitMessage: null,
    });
  });
});

/**
 * `canPromote` is computed by the hook rather than by the reducer, so these
 * cases render the real hook and read its real output. Submitting cases use a
 * promotion request that never settles. Clearing the selection cancels that
 * request, so an empty selection cannot remain in a submitting state.
 */
interface EnablementFixture {
  scenario: string;
  setupSelection: (readHook: () => UsePromoteKeywords) => void;
  expectedSelectedCount: number;
  expectedSubmitting: boolean;
  expectedCanPromote: boolean;
}

describe('Property 13: Promotion trigger is enabled exactly when a non-empty selection exists', () => {
  beforeEach(() => {
    mockApiPost.mockReturnValue(new Promise(vi.fn()));
  });

  const enablementFixtures: EnablementFixture[] = [
    {
      scenario: 'the selection is empty and no request is in progress',
      setupSelection: vi.fn(),
      expectedSelectedCount: 0,
      expectedSubmitting: false,
      expectedCanPromote: false,
    },
    {
      scenario: 'the selection is non-empty and no request is in progress',
      setupSelection: (readHook) => {
        act(() => {
          readHook().toggle('alpha');
        });
      },
      expectedSelectedCount: 1,
      expectedSubmitting: false,
      expectedCanPromote: true,
    },
    {
      scenario: 'the selection is non-empty and a request is in progress',
      setupSelection: (readHook) => {
        act(() => {
          readHook().toggle('alpha');
        });
        act(() => {
          void readHook().promote();
        });
      },
      expectedSelectedCount: 1,
      expectedSubmitting: true,
      expectedCanPromote: false,
    },
    {
      scenario: 'the selection is cleared while a request is in progress',
      setupSelection: (readHook) => {
        act(() => {
          readHook().toggle('alpha');
        });
        act(() => {
          void readHook().promote();
        });
        act(() => {
          readHook().clearSelection();
        });
      },
      expectedSelectedCount: 0,
      expectedSubmitting: false,
      expectedCanPromote: false,
    },
  ];

  it.each(enablementFixtures)(
    'reports canPromote $expectedCanPromote when $scenario',
    ({
      setupSelection, expectedSelectedCount, expectedSubmitting, expectedCanPromote
    }) => {
      const { result } = renderHook(() => usePromoteKeywords(availableKeywordFixtures));

      setupSelection(() => result.current);

      expect(result.current.selectedCount).toBe(expectedSelectedCount);
      expect(result.current.submitting).toBe(expectedSubmitting);
      expect(result.current.canPromote).toBe(expectedCanPromote);
    }
  );
});

describe('Property 14: Successful promotion clears created keywords and retains skipped ones', () => {
  const reconciliationFixtures = [
    {
      scenario: 'every selected keyword was created',
      selected: ['alpha', 'beta'],
      created: ['alpha', 'beta'],
      skipped: [],
      expectedSelected: [],
    },
    {
      scenario: 'every selected keyword was skipped as a duplicate',
      selected: ['alpha', 'beta'],
      created: [],
      skipped: ['alpha', 'beta'],
      expectedSelected: ['alpha', 'beta'],
    },
    {
      scenario: 'the selection was split between created and skipped keywords',
      selected: ['alpha', 'beta', 'gamma', 'delta'],
      created: ['alpha', 'gamma'],
      skipped: ['beta', 'delta'],
      expectedSelected: ['beta', 'delta'],
    },
    {
      scenario: 'the selection is empty',
      selected: [],
      created: [],
      skipped: [],
      expectedSelected: [],
    },
    {
      scenario: 'a selected text is in neither list because it was excluded upstream as empty',
      selected: ['alpha', '   ', 'beta'],
      created: ['alpha'],
      skipped: ['beta'],
      expectedSelected: ['beta'],
    },
  ];

  it.each(reconciliationFixtures)(
    'retains the original selection minus created plus skipped when $scenario',
    ({
      selected, created, skipped, expectedSelected
    }) => {
      const seedState: SelectionState = {
        ...initialSelectionState,
        selected,
      };

      const reconciled = reduceSelection(seedState, {
        type: 'reconcile',
        created,
        skipped,
      });

      expect(reconciled.selected).toStrictEqual(expectedSelected);
      expect(reconciled.limitMessage).toBeNull();
    }
  );

  it('reports a skipped count equal to its retained duplicate list length', async () => {
    mockApiPost.mockResolvedValue({
      created: 1,
      skipped: 2,
      created_keywords: [createdKeywordItemFixture],
      skipped_keywords: [
        {
          keyword: 'beta',
          reason: 'duplicate',
        },
        {
          keyword: 'gamma',
          reason: 'duplicate',
        },
        {
          keyword: '   ',
          reason: 'empty',
        },
      ],
    });

    const promotionOutcome = await promoteKeywords({
      keywords: [
        availableKeywordFixtures[0],
        {
          keyword: 'beta',
          intent: 'informational',
          competition: 'low',
          relevance: 40,
        },
      ],
    });

    expect(promotionOutcome.skipped).toBe(promotionOutcome.skippedKeywords.length);
    expect(promotionOutcome.skippedKeywords).toStrictEqual(['beta', 'gamma']);
    expect(promotionOutcome.created).toBe(promotionOutcome.createdKeywords.length);
    expect(promotionOutcome.createdItems).toStrictEqual([createdKeywordItemFixture]);
  });
});

describe('promotionSuccessMessage', () => {
  const messageFixtures = [
    {
      scenario: 'one keyword was added and nothing was skipped',
      created: 1,
      skipped: 0,
      expectedMessage: '1 keyword added',
    },
    {
      scenario: 'several keywords were added and nothing was skipped',
      created: 3,
      skipped: 0,
      expectedMessage: '3 keywords added',
    },
    {
      scenario: 'keywords were added and duplicates were skipped',
      created: 3,
      skipped: 2,
      expectedMessage: '3 keywords added, 2 already existed',
    },
    {
      scenario: 'every selected keyword already existed',
      created: 0,
      skipped: 1,
      expectedMessage: '0 keywords added, 1 already existed',
    },
  ];

  it.each(messageFixtures)(
    'reads "$expectedMessage" when $scenario',
    ({
      created, skipped, expectedMessage
    }) => {
      const message = promotionSuccessMessage({
        created,
        skipped,
        createdKeywords: [],
        createdItems: [],
        skippedKeywords: [],
      });

      expect(message).toBe(expectedMessage);
    }
  );
});

describe('full proposal promotion', () => {
  it('sends the full proposal with per-keyword statuses in one grouped request', async () => {
    mockApiPost.mockResolvedValue(successfulFullProposalResponseFixture);
    const onKeywordsAdded = vi.fn();
    const { result } = renderHook(() => usePromoteKeywords(
      fullProposalKeywordFixtures,
      onKeywordsAdded,
      { groupIds: ['g1'] }
    ));
    act(() => {
      result.current.replaceSelection(['alpha']);
    });

    await act(async () => {
      await result.current.promoteProposal();
    });

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith(
      '/keywords/promote',
      {
        keywords: [
          {
            ...fullProposalKeywordFixtures[0],
            status: 'active',
          },
          {
            ...fullProposalKeywordFixtures[1],
            status: 'inactive',
          },
        ],
        group_ids: ['g1'],
      },
      {
        signal: expect.objectContaining({ aborted: false }),
        allowStructured4xx: true,
      }
    );
    expect(onKeywordsAdded).toHaveBeenCalledWith([createdKeywordItemFixture]);
  });

  it('keeps the adjusted active selection after the full proposal is added', async () => {
    mockApiPost.mockResolvedValue(successfulFullProposalResponseFixture);
    const { result } = renderHook(() => usePromoteKeywords(fullProposalKeywordFixtures));
    act(() => {
      result.current.replaceSelection(['alpha']);
    });

    await act(async () => {
      await result.current.promoteProposal();
    });

    expect(result.current.selected).toStrictEqual(['alpha']);
    expect(result.current.outcome).toStrictEqual({
      created: 2,
      skipped: 0,
      createdKeywords: ['alpha', 'beta'],
      createdItems: successfulFullProposalResponseFixture.created_keywords,
      skippedKeywords: [],
    });
  });

  it('marks every proposal term inactive when the active selection is empty', async () => {
    mockApiPost.mockResolvedValue(successfulFullProposalResponseFixture);
    const { result } = renderHook(() => usePromoteKeywords(fullProposalKeywordFixtures));

    await act(async () => {
      await result.current.promoteProposal();
    });

    expect(mockApiPost).toHaveBeenCalledWith(
      '/keywords/promote',
      {
        keywords: fullProposalKeywordFixtures.map((keyword) => ({
          ...keyword,
          status: 'inactive',
        })),
      },
      {
        signal: expect.objectContaining({ aborted: false }),
        allowStructured4xx: true,
      }
    );
  });
});

describe('promotion request safety', () => {
  beforeEach(() => {
    mockApiPost.mockReturnValue(new Promise(vi.fn()));
  });

  it('sends one request when promotion is triggered twice before rendering updates', () => {
    const { result } = renderSelectedPromotion();

    act(() => {
      void result.current.promote();
      void result.current.promote();
    });

    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it('aborts the pending request when the hook unmounts', () => {
    const { unmount } = renderPendingPromotion();

    unmount();

    expect(mockApiPost).toHaveBeenCalledWith(...abortedPromotionRequest);
  });

  it('clears the request timeout when the hook unmounts during promotion', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderPendingPromotion();
    const callsBeforeUnmount = clearTimeoutSpy.mock.calls.length;

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(callsBeforeUnmount + 1);
    clearTimeoutSpy.mockRestore();
  });

  it('cancels stale promotion when available keywords change', () => {
    const {
      result, rerender
    } = renderPendingPromotion();

    rerender({ availableKeywords: replacementAvailableKeywordFixtures });

    expect(mockApiPost).toHaveBeenCalledWith(...abortedPromotionRequest);
    expect(result.current.selected).toStrictEqual([]);
    expect(result.current.submitting).toBe(false);
  });

  it('clears the request timeout when available keywords change during promotion', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { rerender } = renderPendingPromotion();
    const callsBeforeRerender = clearTimeoutSpy.mock.calls.length;

    rerender({ availableKeywords: replacementAvailableKeywordFixtures });

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(callsBeforeRerender + 1);
    clearTimeoutSpy.mockRestore();
  });

  it('aborts the pending request when the selection is cleared', () => {
    const { result } = renderPendingPromotion();

    act(() => {
      result.current.clearSelection();
    });

    expect(mockApiPost).toHaveBeenCalledWith(...abortedPromotionRequest);
    expect(result.current.submitting).toBe(false);
  });

  it('ignores the result when a cancelled promotion settles', async () => {
    const promotionRequest = createMockPromotionRequest();
    const onKeywordsAdded = vi.fn();
    mockApiPost.mockReturnValue(promotionRequest.promise);
    const {
      result, rerender
    } = renderPendingPromotion({ onKeywordsAdded });

    rerender({ availableKeywords: replacementAvailableKeywordFixtures });
    await act(async () => {
      promotionRequest.resolve();
      await promotionRequest.promise;
    });

    expect(result.current.outcome).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.selected).toStrictEqual([]);
    expect(onKeywordsAdded).toHaveBeenCalledTimes(0);
  });

  it('does not clear the request timeout again when a cancelled promotion settles', async () => {
    const promotionRequest = createMockPromotionRequest();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    mockApiPost.mockReturnValue(promotionRequest.promise);
    const { rerender } = renderPendingPromotion();

    rerender({ availableKeywords: replacementAvailableKeywordFixtures });
    const callsAfterCancellation = clearTimeoutSpy.mock.calls.length;
    await act(async () => {
      promotionRequest.resolve();
      await promotionRequest.promise;
    });

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(callsAfterCancellation);
    clearTimeoutSpy.mockRestore();
  });
});

describe('research keyword identity', () => {
  it('keeps the first row when keywords differ only by case and whitespace', () => {
    const duplicate = {
      ...availableKeywordFixtures[0],
      keyword: '  ALPHA  ',
      intent: 'informational',
    };
    const beta = {
      ...availableKeywordFixtures[0],
      keyword: 'beta',
    };

    const uniqueKeywords = uniqueResearchKeywords([
      availableKeywordFixtures[0],
      duplicate,
      beta,
    ]);

    expect(uniqueKeywords).toStrictEqual([availableKeywordFixtures[0], beta]);
  });

  it('keeps the first row when keywords use compatibility-equivalent Unicode', () => {
    const compatibilityDuplicate = {
      ...availableKeywordFixtures[0],
      keyword: '  ＡＬＰＨＡ  ',
      intent: 'informational',
    };

    const uniqueKeywords = uniqueResearchKeywords([
      availableKeywordFixtures[0],
      compatibilityDuplicate,
    ]);

    expect(uniqueKeywords).toStrictEqual([availableKeywordFixtures[0]]);
  });
});
