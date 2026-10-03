import { expect } from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SELECTION_LIMIT } from '../../hooks/usePromoteKeywords';
import { createdKeywordItemFixture } from '../../hooks/usePromoteKeywords-fixtures';
import type {
  ExpandedKeywordWithSource, ResearchKeyword
} from '../../types';

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

/** `promoteKeyword` without user-event, for specs running on fake timers. */
export function firePromoteKeyword(keyword: string): void {
  fireEvent.click(selectKeywordCheckbox(keyword));
  fireEvent.click(getPromoteButtonElement());
}

/** The selection counter `KeywordPromotionControls` shows. */
export const selectionCountText = (count: number) => `${count} of ${SELECTION_LIMIT} keywords selected`;

type CreatedKeywordItem = typeof createdKeywordItemFixture;

/**
 * A `created_keywords` wire entry: the COMPLETE created item as the backend
 * writes it, which is a superset of the `Keyword` fields the active keyword list
 * reads.
 */
export function buildCreatedKeywordItem(overrides: Partial<CreatedKeywordItem> = {}): CreatedKeywordItem {
  return {
    ...createdKeywordItemFixture,
    ...overrides,
  };
}

interface SkippedKeyword {
  keyword: string;
  reason: string;
}

/** The `/keywords/promote` response for the given created and skipped rows. */
export function buildPromotionWire(createdKeywords: CreatedKeywordItem[], skippedKeywords: SkippedKeyword[] = []) {
  return {
    created: createdKeywords.length,
    skipped: skippedKeywords.length,
    created_keywords: createdKeywords,
    skipped_keywords: skippedKeywords,
  };
}

type PromotionRequestArguments = [endpoint: string, body: { keywords: ResearchKeyword[] }, options: Record<string, unknown>];

/** The `apiPost` arguments of one promotion request carrying `keywords`. */
export function promotionRequestArguments(keywords: ResearchKeyword[]): PromotionRequestArguments {
  return [
    '/keywords/promote',
    { keywords },
    {
      signal: expect.any(AbortSignal),
      allowStructured4xx: true,
    },
  ];
}
