import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  render, screen, fireEvent, act 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordExpansion } from './KeywordExpansion';
import {
  SELECTION_LIMIT, PROMOTION_TIMEOUT_MS, PROMOTION_TIMEOUT_MESSAGE 
} from '../../hooks/usePromoteKeywords';
import { ApiRequestError } from '../../infrastructure';
import type {
  ExpandedKeywordWithSource, KeywordExpansionResult 
} from '../../types';

vi.mock('../../api/client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '../../api/client';

const mockApiPost = apiPost as ReturnType<typeof vi.fn>;

function buildProps(overrides = {}) {
  return {
    onExpand: vi.fn(),
    loading: false,
    result: null,
    error: null,
    ...overrides,
  };
}

describe('KeywordExpansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial render', () => {
    it('renders seed keyword input', () => {
      render(<KeywordExpansion {...buildProps()} />);

      expect(screen.getByPlaceholderText(/e\.g\., best hotels/i)).toBeInTheDocument();
    });

    it('renders industry selector', () => {
      render(<KeywordExpansion {...buildProps()} />);

      expect(screen.getByText('General')).toBeInTheDocument();
    });

    it('renders expand button', () => {
      render(<KeywordExpansion {...buildProps()} />);

      expect(screen.getByRole('button', { name: /find keywords/i })).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('calls onExpand with input values', async () => {
      const onExpand = vi.fn();
      render(<KeywordExpansion {...buildProps({ onExpand })} />);

      const input = screen.getByPlaceholderText(/e\.g\., best hotels/i);
      await userEvent.type(input, 'hotels');

      const button = screen.getByRole('button', { name: /find keywords/i });
      await userEvent.click(button);

      expect(onExpand).toHaveBeenCalledWith('hotels', 'general', 20);
    });

    it('disables button when loading', () => {
      render(<KeywordExpansion {...buildProps({ loading: true })} />);

      expect(screen.getByRole('button', { name: /expanding/i })).toBeDisabled();
    });

    it('does not call onExpand when seed keyword is empty', async () => {
      const onExpand = vi.fn();
      render(<KeywordExpansion {...buildProps({ onExpand })} />);

      // Button should be disabled when empty
      const button = screen.getByRole('button', { name: /find keywords/i });
      expect(button).toBeDisabled();
    });
  });

  describe('with results', () => {
    it('renders keyword results table', () => {
      render(<KeywordExpansion {...buildProps({
        result: {
          seed_keyword: 'hotels',
          keywords: [
            {
              keyword: 'luxury hotels',
              search_volume: 1000,
              difficulty: 50,
              relevance: 0.9 
            },
          ],
        },
      })} />);

      expect(screen.getByText('luxury hotels')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      render(<KeywordExpansion {...buildProps({ error: 'Failed to expand keywords' })} />);

      expect(screen.getByText('Failed to expand keywords')).toBeInTheDocument();
    });
  });
});

const luxuryHotelsFixture: ExpandedKeywordWithSource = {
  keyword: 'luxury hotels',
  intent: 'commercial',
  competition: 'high',
  relevance: 9,
  source: 'expansion',
};

const beachResortsFixture: ExpandedKeywordWithSource = {
  keyword: 'beach resorts',
  intent: 'informational',
  competition: 'low',
  relevance: 7,
  source: 'expansion',
};

const expansionKeywordFixtures = [luxuryHotelsFixture, beachResortsFixture];

const expansionResultFixture: KeywordExpansionResult = {
  id: 'research-1',
  seed_keyword: 'hotels',
  industry: 'hospitality',
  keywords: expansionKeywordFixtures,
  keyword_count: expansionKeywordFixtures.length,
};

/**
 * A second result carrying the same keyword rows: the only reason a selection
 * can drop to zero after it is displayed is the clear-on-new-result effect.
 */
const replacementResultFixture: KeywordExpansionResult = {
  ...expansionResultFixture,
  id: 'research-2',
  seed_keyword: 'resorts',
};

const promotionWireFixture = {
  created: 1,
  skipped: 1,
  created_keywords: [{
    id: 'keyword-1',
    keyword: luxuryHotelsFixture.keyword,
  }],
  skipped_keywords: [{
    keyword: beachResortsFixture.keyword,
    reason: 'duplicate',
  }],
};

/** A request that never settles, so the in-flight state can be observed. */
const mockPendingRequest = () => new Promise<never>(() => undefined);

/**
 * A request that only settles when its `AbortSignal` fires, rejecting with the
 * signal's own abort reason exactly as an aborted `fetch` does.
 */
const mockAbortableRequest = (
  _endpoint: string,
  _body: unknown,
  options?: { signal?: AbortSignal }
) => new Promise<never>((_resolve, reject) => {
  const signal = options?.signal;
  signal?.addEventListener('abort', () => reject(signal.reason));
});

const renderExpansionWithResult = (result: KeywordExpansionResult) => render(
  <KeywordExpansion onExpand={vi.fn()} loading={false} result={result} error={null} />
);

const selectKeywordCheckbox = (keyword: string) =>
  screen.getByRole('checkbox', { name: `Select ${keyword}` });

const getPromoteButtonElement = () =>
  screen.getByRole('button', { name: /promote selected/i });

describe('KeywordExpansion promotion UI', () => {
  beforeEach(() => {
    mockApiPost.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders one selection checkbox per keyword row', () => {
    renderExpansionWithResult(expansionResultFixture);

    expect(screen.getAllByRole('checkbox')).toHaveLength(expansionKeywordFixtures.length);
  });

  it('displays a selected count equal to the number of checked keywords', async () => {
    renderExpansionWithResult(expansionResultFixture);

    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    await userEvent.click(selectKeywordCheckbox(beachResortsFixture.keyword));

    expect(screen.getByText(
      `${expansionKeywordFixtures.length} of ${SELECTION_LIMIT} keywords selected`
    )).toBeInTheDocument();
  });

  it('disables the promote trigger while no keyword is selected', () => {
    renderExpansionWithResult(expansionResultFixture);

    expect(getPromoteButtonElement()).toBeDisabled();
  });

  it('enables the promote trigger once a keyword is selected', async () => {
    renderExpansionWithResult(expansionResultFixture);

    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));

    expect(getPromoteButtonElement()).toBeEnabled();
  });

  it('sends a single request carrying the selected keyword research context on trigger', async () => {
    mockApiPost.mockResolvedValue(promotionWireFixture);
    renderExpansionWithResult(expansionResultFixture);

    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    await userEvent.click(getPromoteButtonElement());

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith(
      '/keywords/promote',
      {
        keywords: [luxuryHotelsFixture],
        status: 'active',
        priority: 'normal',
      },
      { signal: expect.any(AbortSignal) }
    );
  });

  it('shows a progress indicator and disables the trigger while the request is in flight', async () => {
    mockApiPost.mockImplementation(mockPendingRequest);
    renderExpansionWithResult(expansionResultFixture);

    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    await userEvent.click(getPromoteButtonElement());

    expect(screen.getByText(/promoting selected keywords/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /promoting/i })).toBeDisabled();
  });

  it('displays the created and skipped counts when the promotion succeeds', async () => {
    mockApiPost.mockResolvedValue(promotionWireFixture);
    renderExpansionWithResult(expansionResultFixture);

    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    await userEvent.click(getPromoteButtonElement());

    expect(await screen.findByText(
      `${promotionWireFixture.created} created, ${promotionWireFixture.skipped} skipped`
    )).toBeInTheDocument();
  });

  it('shows an error and retains the selection when the request fails', async () => {
    mockApiPost.mockRejectedValue(new ApiRequestError('HTTP 500: Server Error', 500));
    renderExpansionWithResult(expansionResultFixture);

    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    await userEvent.click(getPromoteButtonElement());

    expect(await screen.findByRole('alert')).toHaveTextContent(/promotion failed/i);
    expect(selectKeywordCheckbox(luxuryHotelsFixture.keyword)).toBeChecked();
    expect(getPromoteButtonElement()).toBeEnabled();
  });

  it('shows the timeout message when the request does not settle within the promotion timeout', async () => {
    vi.useFakeTimers();
    mockApiPost.mockImplementation(mockAbortableRequest);
    renderExpansionWithResult(expansionResultFixture);

    fireEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    fireEvent.click(getPromoteButtonElement());
    await act(async () => {
      vi.advanceTimersByTime(PROMOTION_TIMEOUT_MS);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(PROMOTION_TIMEOUT_MESSAGE);
    expect(selectKeywordCheckbox(luxuryHotelsFixture.keyword)).toBeChecked();
  });

  it('clears the selection when a new expansion result is displayed', async () => {
    const { rerender } = renderExpansionWithResult(expansionResultFixture);
    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    expect(screen.getByText(`1 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();

    rerender(
      <KeywordExpansion
        onExpand={vi.fn()}
        loading={false}
        result={replacementResultFixture}
        error={null}
      />
    );

    expect(screen.getByText(`0 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();
    expect(selectKeywordCheckbox(luxuryHotelsFixture.keyword)).not.toBeChecked();
  });
});
