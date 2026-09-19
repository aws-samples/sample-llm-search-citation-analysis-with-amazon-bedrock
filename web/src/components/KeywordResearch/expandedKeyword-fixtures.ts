import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExpandedKeywordWithSource } from '../../types';

/** Keyword rows an expansion run returns, shared by the expansion and history specs. */
export const luxuryHotelsFixture: ExpandedKeywordWithSource = {
  keyword: 'luxury hotels',
  intent: 'commercial',
  competition: 'high',
  relevance: 9,
  source: 'expansion',
};

export const beachResortsFixture: ExpandedKeywordWithSource = {
  keyword: 'beach resorts',
  intent: 'informational',
  competition: 'low',
  relevance: 7,
  source: 'expansion',
};

export const expansionKeywordFixtures = [luxuryHotelsFixture, beachResortsFixture];

/** The promotion checkbox `KeywordResultsTable` renders for one keyword row. */
export const selectKeywordCheckbox = (keyword: string) =>
  screen.getByRole('checkbox', { name: `Select ${keyword}` });

/** The "Add to Keywords" trigger of `KeywordPromotionControls`. */
export const getPromoteButtonElement = () =>
  screen.getByRole('button', { name: /add to keywords/i });

/** Ticks `keyword` and triggers "Add to Keywords". */
export async function promoteKeyword(keyword: string): Promise<void> {
  await userEvent.click(selectKeywordCheckbox(keyword));
  await userEvent.click(getPromoteButtonElement());
}
