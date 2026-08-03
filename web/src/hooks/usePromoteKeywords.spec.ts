import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import {
  reduceSelection,
  initialSelectionState,
  usePromoteKeywords,
  SELECTION_LIMIT,
  SELECTION_LIMIT_MESSAGE,
} from './usePromoteKeywords';
import type {
  SelectionState, UsePromoteKeywords 
} from './usePromoteKeywords';
import { promoteKeywords } from '../api/keywords';

vi.mock('../api/client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '../api/client';

const mockApiPost = apiPost as ReturnType<typeof vi.fn>;

/**
 * A selection of exactly SELECTION_LIMIT texts, built programmatically so the
 * cap boundary is exercised without hand-writing 500 literals.
 */
const atCapSelection = Array.from(
  {length: SELECTION_LIMIT},
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
        (state, keyword) => reduceSelection(state, {
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

/**
 * `canPromote` is computed by the hook rather than by the reducer, so these
 * cases render the real hook and read its real output. The submitting cells are
 * produced by a promotion request that never settles; the empty-and-submitting
 * cell is reached by clearing the selection while that request is in flight,
 * which is the only way an empty selection can coexist with `submitting`
 * (`promote` refuses to start on an empty selection).
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
    vi.clearAllMocks();
    mockApiPost.mockReturnValue(new Promise(() => undefined));
  });

  const enablementFixtures: EnablementFixture[] = [
    {
      scenario: 'the selection is empty and no request is in progress',
      setupSelection: () => undefined,
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
          void readHook().promote('active', 'normal');
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
          void readHook().promote('active', 'normal');
        });
        act(() => {
          readHook().clearSelection();
        });
      },
      expectedSelectedCount: 0,
      expectedSubmitting: true,
      expectedCanPromote: false,
    },
  ];

  it.each(enablementFixtures)(
    'reports canPromote $expectedCanPromote when $scenario',
    ({
      setupSelection, expectedSelectedCount, expectedSubmitting, expectedCanPromote 
    }) => {
      const { result } = renderHook(() => usePromoteKeywords());

      setupSelection(() => result.current);

      expect(result.current.selectedCount).toBe(expectedSelectedCount);
      expect(result.current.submitting).toBe(expectedSubmitting);
      expect(result.current.canPromote).toBe(expectedCanPromote);
    }
  );
});

describe('Property 14: Successful promotion clears created keywords and retains skipped ones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      created_keywords: [{
        id: 'keyword-1',
        keyword: 'alpha',
      }],
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

    const outcome = await promoteKeywords({
      keywords: [
        {
          keyword: 'alpha',
          intent: 'commercial',
          competition: 'high',
          relevance: 90,
        },
        {
          keyword: 'beta',
          intent: 'informational',
          competition: 'low',
          relevance: 40,
        },
      ],
    });

    expect(outcome.skipped).toBe(outcome.skippedKeywords.length);
    expect(outcome.skippedKeywords).toStrictEqual(['beta', 'gamma']);
    expect(outcome.created).toBe(outcome.createdKeywords.length);
  });
});
