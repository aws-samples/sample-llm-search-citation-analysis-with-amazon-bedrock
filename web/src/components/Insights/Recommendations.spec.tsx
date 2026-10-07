import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Recommendations } from './Recommendations';

vi.mock('../../hooks/useRecommendations', () => ({useRecommendations: vi.fn(),}));
vi.mock('../../hooks/useKeywordGroups');

import { useRecommendations } from '../../hooks/useRecommendations';
import { SCOPE_KEYWORDS } from '../ui/useKeywordScopeOptions-fixtures';
import {
  TRACKED_RECOMMENDATION, VISIBILITY_GAP_RECOMMENDATION, buildRecommendationsHookResult, buildRecommendationsResponse 
} from './Recommendations-fixtures';
import {
  describeScopeSelection, mockCorunaKeywordGroups, neverSettlingFetch
} from './useScopeSelection-fixtures';

const mockUseRecommendations = vi.mocked(useRecommendations);

/** Renders the Action Center with the hook answering `overrides`; returns its `fetchRecommendations` spy. */
function renderWithRecommendations(overrides: Parameters<typeof buildRecommendationsHookResult>[0] = {}) {
  const hookResult = buildRecommendationsHookResult(overrides);
  mockUseRecommendations.mockReturnValue(hookResult);
  render(<Recommendations keywords={SCOPE_KEYWORDS} />);
  return hookResult.fetchRecommendations;
}

/** Renders the Action Center listing `TRACKED_RECOMMENDATION`; returns the hook result it used. */
function renderWithTrackedRecommendation(overrides: Parameters<typeof buildRecommendationsHookResult>[0] = {}) {
  const hookResult = buildRecommendationsHookResult({
    data: buildRecommendationsResponse({ recommendations: [TRACKED_RECOMMENDATION] }),
    ...overrides,
  });
  mockUseRecommendations.mockReturnValue(hookResult);
  render(<Recommendations keywords={SCOPE_KEYWORDS} />);
  return hookResult;
}

/** Renders `TRACKED_RECOMMENDATION` and picks `status` in its status menu; returns the hook result it used. */
async function renderAndChooseStatus(status: string) {
  const hookResult = renderWithTrackedRecommendation();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status of Improve visibility' }), status);
  return hookResult;
}

describe('Recommendations', () => {
  beforeEach(() => {
    mockUseRecommendations.mockReturnValue(buildRecommendationsHookResult());
    mockCorunaKeywordGroups();
  });

  describe('initial render', () => {
    it('renders header title', () => {
      renderWithRecommendations();

      expect(screen.getByText('Action Center')).toBeInTheDocument();
    });

    it('fetches recommendations on mount', () => {
      const fetchRecommendations = renderWithRecommendations();

      expect(fetchRecommendations).toHaveBeenCalledWith(false);
    });
  });

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      renderWithRecommendations({ loading: true });

      expect(screen.getByText(/Generating recommendations/)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      renderWithRecommendations({ error: 'Failed to load' });

      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    it('renders priority summary cards', () => {
      renderWithRecommendations({
        data: buildRecommendationsResponse({
          by_priority: {
            high: 3,
            medium: 5,
            low: 2 
          },
        }),
      });

      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders recommendation cards', () => {
      renderWithRecommendations({
        data: buildRecommendationsResponse({
          recommendations: [VISIBILITY_GAP_RECOMMENDATION],
          by_priority: {
            high: 1,
            medium: 0,
            low: 0 
          },
        }),
      });

      expect(screen.getByText('Improve visibility')).toBeInTheDocument();
    });

    it('shows empty state when no recommendations', () => {
      renderWithRecommendations({ data: buildRecommendationsResponse() });

      expect(screen.getByText(/No recommendations available/)).toBeInTheDocument();
    });
  });

  describe('LLM toggle', () => {
    it('refetches with LLM when checkbox clicked', async () => {
      const fetchRecommendations = renderWithRecommendations({ data: buildRecommendationsResponse() });

      await userEvent.click(screen.getByRole('checkbox'));

      expect(fetchRecommendations).toHaveBeenCalledWith(true);
    });
  });

  describeScopeSelection({
    renderIdle: () => renderWithRecommendations(),
    renderShowingAnswer: () => renderWithTrackedRecommendation({ fetchRecommendations: neverSettlingFetch() }),
    scopedHook: mockUseRecommendations,
    loadingText: 'Generating recommendations...',
    answerMarker: () => screen.queryByText('High Priority'),
  });

  describe('status tracking', () => {
    it('shows the stored status of a tracked recommendation', () => {
      renderWithTrackedRecommendation();

      expect(screen.getByRole('combobox', { name: 'Status of Improve visibility' })).toHaveValue('in_progress');
    });

    it('saves the chosen status for that recommendation', async () => {
      const { updateStatus } = await renderAndChooseStatus('done');

      expect(updateStatus).toHaveBeenCalledWith(TRACKED_RECOMMENDATION, 'done');
    });

    it('does not expand the card when the status is changed', async () => {
      await renderAndChooseStatus('done');

      expect(screen.queryByText('Create content')).not.toBeInTheDocument();
    });

    it('disables the status while its save is in flight', () => {
      renderWithTrackedRecommendation({ updatingIds: ['rec-visibility'] });

      expect(screen.getByRole('combobox', { name: 'Status of Improve visibility' })).toBeDisabled();
    });

    it('offers no status for a recommendation without an id', () => {
      renderWithRecommendations({ data: buildRecommendationsResponse({ recommendations: [VISIBILITY_GAP_RECOMMENDATION] }) });

      expect(screen.queryByRole('combobox', { name: /^Status of/ })).not.toBeInTheDocument();
    });

    it('explains that the status was not saved when the save fails', () => {
      renderWithTrackedRecommendation({ statusError: 'Server error occurred' });

      expect(screen.getByRole('alert')).toHaveTextContent('Status not saved: Server error occurred');
    });
  });
});
