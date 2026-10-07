/**
 * The behaviour every insights view with an "Analyze" scope picker shares
 * (Prompt Insights, Action Center), as one parametrised suite: it starts at
 * every keyword, offers each group and active keyword, hands the picked group
 * to its data hook, and hides the previous scope's answer while the new
 * scope's request is pending.
 *
 * A view spec mocks `../../hooks/useKeywordGroups`, sets the groups up with
 * `mockCorunaKeywordGroups` in its render helper, and calls
 * `describeScopeSelection` inside its top-level `describe`.
 */
import {
  describe, expect, it, vi, type MockInstance
} from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';
import { renderedScopeOptionLabels } from '../ui/KeywordScopeSelector-fixtures';
import {
  ALL_SCOPE, groupScope
} from '../ui/reportScope-fixtures';

/** Every option the "Analyze" picker offers for `SCOPE_KEYWORDS` and the Coruña group. */
const ANALYZE_SCOPE_OPTIONS = ['All keywords', 'Hotel Coruña (1)', 'hotels', 'resorts'];

/** Makes the mocked keyword-groups hook answer the Coruña group. */
export function mockCorunaKeywordGroups(): void {
  vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult());
}

/** A fetch that never settles, so a newly picked scope stays pending. */
export function neverSettlingFetch() {
  return vi.fn().mockImplementation(() => new Promise<null>(vi.fn()));
}

/** Picks the Coruña group in the "Analyze" scope picker. */
function selectCorunaGroup(): Promise<void> {
  return userEvent.selectOptions(screen.getByRole('combobox', { name: 'Analyze' }), 'group:group-coruna');
}

export interface ScopeSelectionContract {
  /** Renders the view idle: no answer yet, nothing in flight. */
  readonly renderIdle: () => void;
  /** Renders the view showing an answer, with every further fetch left pending. */
  readonly renderShowingAnswer: () => void;
  /** The view's mocked data hook, which receives the selected scope. */
  readonly scopedHook: MockInstance;
  /** What the view says while a request is in flight. */
  readonly loadingText: string;
  /** An element only a shown answer renders, or null when none is shown. */
  readonly answerMarker: () => HTMLElement | null;
}

export function describeScopeSelection({
  renderIdle, renderShowingAnswer, scopedHook, loadingText, answerMarker
}: ScopeSelectionContract): void {
  describe('scope selection', () => {
    it('asks for every keyword until a scope is picked', () => {
      renderIdle();

      expect(scopedHook).toHaveBeenCalledWith(ALL_SCOPE);
    });

    it('offers every keyword, each group and each active keyword as a scope', () => {
      renderIdle();

      expect(renderedScopeOptionLabels('Analyze')).toStrictEqual(ANALYZE_SCOPE_OPTIONS);
    });

    it('asks for the selected group when a group is picked', async () => {
      renderIdle();

      await selectCorunaGroup();

      expect(scopedHook).toHaveBeenLastCalledWith(groupScope('group-coruna'));
    });

    it('hides the previous scope while the selected scope remains pending', async () => {
      renderShowingAnswer();
      expect(answerMarker()).not.toBeNull();

      await selectCorunaGroup();

      expect(screen.getByText(loadingText)).toBeInTheDocument();
      expect(answerMarker()).toBeNull();
    });
  });
}
