import {
  describe, it, expect, vi, beforeEach, afterEach
} from 'vitest';
import {
  render, screen, act
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { KeywordExpansion } from './KeywordExpansion';
import {
  PROMOTION_TIMEOUT_MS,
  PROMOTION_TIMEOUT_MESSAGE,
  PROMOTION_SUCCESS_MESSAGE_MS,
  promotionSuccessMessage,
} from '../../hooks/usePromoteKeywords';
import { ApiRequestError } from '../../infrastructure';
import type {
  Keyword, KeywordExpansionResult
} from '../../types';
import {
  buildProps,
  createDefinitiveRejection,
  definitiveRejectionField,
  definitiveRejectionMessage,
} from './KeywordExpansion-fixtures';
import {
  beachResortsFixture,
  buildCreatedKeywordItem,
  buildPromotionWire,
  expansionKeywordFixtures,
  firePromoteKeyword,
  getPromoteButtonElement,
  luxuryHotelsFixture,
  promoteKeyword,
  promotionRequestArguments,
  selectKeywordCheckbox,
  selectionCountText,
} from './expandedKeyword-fixtures';

vi.mock('../../api/client', () => import('./apiClientMock-fixtures'));

import { mockApiPost } from './apiClientMock-fixtures';

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

const createdKeywordItemFixture = buildCreatedKeywordItem({
  keyword: luxuryHotelsFixture.keyword,
  notes: 'intent: commercial; competition: high; source: expansion',
});

const promotionWireFixture = buildPromotionWire([createdKeywordItemFixture], [{
  keyword: beachResortsFixture.keyword,
  reason: 'duplicate',
}]);

const successMessage = promotionSuccessMessage(promotionWireFixture);

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

const renderExpansion = (overrides: Partial<ComponentProps<typeof KeywordExpansion>> = {}) =>
  render(<KeywordExpansion {...buildProps(overrides)} />);

/** Renders the expansion result and promotes 'luxury hotels' through the UI. */
async function renderAndPromote(onKeywordsAdded?: (created: Keyword[]) => void): Promise<void> {
  renderExpansion({
    result: expansionResultFixture,
    onKeywordsAdded,
  });
  await promoteKeyword(luxuryHotelsFixture.keyword);
}

/** `renderAndPromote` without user-event, for tests running on fake timers. */
function renderAndFirePromote(): void {
  renderExpansion({ result: expansionResultFixture });
  firePromoteKeyword(luxuryHotelsFixture.keyword);
}

describe('KeywordExpansion', () => {
  describe('initial render', () => {
    it('shows a generic project-management seed example', () => {
      renderExpansion();

      expect(screen.getByRole('textbox')).toHaveAttribute(
        'placeholder',
        'e.g. project management software'
      );
    });

    it('renders industry selector', () => {
      renderExpansion();

      expect(screen.getByText('General')).toBeInTheDocument();
    });

    it('renders expand button', () => {
      renderExpansion();

      expect(screen.getByRole('button', { name: /find keywords/i })).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('calls onExpand with input values', async () => {
      const onExpand = vi.fn();
      renderExpansion({ onExpand });

      const input = screen.getByRole('textbox');
      await userEvent.type(input, 'hotels');

      const button = screen.getByRole('button', { name: /find keywords/i });
      await userEvent.click(button);

      expect(onExpand).toHaveBeenCalledWith('hotels', 'general', 20);
    });

    it('submits Hotels when Hotels & Hospitality is selected', async () => {
      const onExpand = vi.fn();
      renderExpansion({ onExpand });

      await userEvent.type(screen.getByRole('textbox'), 'boutique hotels');
      await userEvent.selectOptions(screen.getByDisplayValue('General'), 'hotels');
      await userEvent.click(screen.getByRole('button', { name: /find keywords/i }));

      expect(onExpand).toHaveBeenCalledWith('boutique hotels', 'hotels', 20);
    });

    it('disables button when loading', () => {
      renderExpansion({ loading: true });

      expect(screen.getByRole('button', { name: /expanding/i })).toBeDisabled();
    });

    it('does not call onExpand when seed keyword is empty', () => {
      renderExpansion();

      // Button should be disabled when empty
      const button = screen.getByRole('button', { name: /find keywords/i });
      expect(button).toBeDisabled();
    });
  });

  describe('with results', () => {
    it('renders keyword results table', () => {
      renderExpansion({ result: expansionResultFixture });

      expect(screen.getByText('luxury hotels')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      renderExpansion({ error: 'Failed to expand keywords' });

      expect(screen.getByText('Failed to expand keywords')).toBeInTheDocument();
    });
  });
});

describe('KeywordExpansion promotion UI', () => {
  beforeEach(() => {
    mockApiPost.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders one selection checkbox per keyword row', () => {
    renderExpansion({ result: expansionResultFixture });

    expect(screen.getAllByRole('checkbox')).toHaveLength(expansionKeywordFixtures.length);
  });

  it('sends a single request carrying the selected keyword research context on trigger', async () => {
    mockApiPost.mockResolvedValue(promotionWireFixture);

    await renderAndPromote();

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith(...promotionRequestArguments([luxuryHotelsFixture]));
  });

  it('shows a progress indicator and disables the trigger while the request is in flight', async () => {
    mockApiPost.mockImplementation(mockPendingRequest);

    await renderAndPromote();

    expect(screen.getByText(/adding selected keywords/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /adding/i })).toBeDisabled();
  });

  it('displays a success message when the promotion succeeds', async () => {
    mockApiPost.mockResolvedValue(promotionWireFixture);

    await renderAndPromote();

    expect(await screen.findByText(successMessage)).toBeInTheDocument();
  });

  it('dismisses the success message once its display window has elapsed', async () => {
    // Fake timers from the start, so the dismissal timer the hook arms on
    // success is the one this test advances.
    vi.useFakeTimers();
    mockApiPost.mockResolvedValue(promotionWireFixture);
    renderAndFirePromote();

    await act(async () => undefined);
    expect(screen.getByText(successMessage)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(PROMOTION_SUCCESS_MESSAGE_MS);
    });

    expect(screen.queryByText(successMessage)).not.toBeInTheDocument();
  });

  it('reports the created keywords to its owner when the promotion succeeds', async () => {
    mockApiPost.mockResolvedValue(promotionWireFixture);
    const onKeywordsAdded = vi.fn();

    await renderAndPromote(onKeywordsAdded);
    await screen.findByText(successMessage);

    expect(onKeywordsAdded).toHaveBeenCalledTimes(1);
    expect(onKeywordsAdded).toHaveBeenCalledWith([createdKeywordItemFixture]);
  });

  it('reports no created keywords to its owner when the request fails', async () => {
    mockApiPost.mockRejectedValue(new ApiRequestError('HTTP 500: Server Error', 500));
    const onKeywordsAdded = vi.fn();

    await renderAndPromote(onKeywordsAdded);
    await screen.findByRole('alert');

    expect(onKeywordsAdded).not.toHaveBeenCalled();
  });

  it('shows an error and retains the selection when the request fails', async () => {
    mockApiPost.mockRejectedValue(new ApiRequestError('HTTP 500: Server Error', 500));

    await renderAndPromote();

    expect(await screen.findByRole('alert')).toHaveTextContent(/adding keywords failed/i);
    expect(selectKeywordCheckbox(luxuryHotelsFixture.keyword)).toBeChecked();
    expect(getPromoteButtonElement()).toBeEnabled();
  });

  it.each([
    {
      outcome: 'shows exact field-qualified backend message when promotion is rejected',
      field: definitiveRejectionField,
      expectedText: `${definitiveRejectionMessage} (field: ${definitiveRejectionField})`,
    },
    {
      outcome: 'shows exact backend message when rejection omits field',
      field: undefined,
      expectedText: definitiveRejectionMessage,
    },
  ])('$outcome', async ({
    field, expectedText
  }) => {
    mockApiPost.mockRejectedValue(createDefinitiveRejection(field));

    await renderAndPromote();

    expect((await screen.findByRole('alert')).textContent).toBe(expectedText);
  });

  it('retains selection when promotion receives a definitive rejection', async () => {
    mockApiPost.mockRejectedValue(createDefinitiveRejection(definitiveRejectionField));

    await renderAndPromote();
    await screen.findByRole('alert');

    expect(selectKeywordCheckbox(luxuryHotelsFixture.keyword)).toBeChecked();
  });

  it('shows the timeout message when the request does not settle within the promotion timeout', async () => {
    vi.useFakeTimers();
    mockApiPost.mockImplementation(mockAbortableRequest);
    renderAndFirePromote();

    await act(async () => {
      vi.advanceTimersByTime(PROMOTION_TIMEOUT_MS);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(PROMOTION_TIMEOUT_MESSAGE);
    expect(selectKeywordCheckbox(luxuryHotelsFixture.keyword)).toBeChecked();
  });

  it('clears the selection when a new expansion result is displayed', async () => {
    const { rerender } = renderExpansion({ result: expansionResultFixture });
    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    expect(screen.getByText(selectionCountText(1))).toBeInTheDocument();

    rerender(<KeywordExpansion {...buildProps({ result: replacementResultFixture })} />);

    expect(screen.getByText(selectionCountText(0))).toBeInTheDocument();
    expect(selectKeywordCheckbox(luxuryHotelsFixture.keyword)).not.toBeChecked();
  });
});
