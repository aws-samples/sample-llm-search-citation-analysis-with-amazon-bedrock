import { screen } from '@testing-library/react';
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
