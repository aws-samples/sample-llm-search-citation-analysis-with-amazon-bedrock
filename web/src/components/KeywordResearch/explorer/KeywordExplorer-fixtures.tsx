import { expect } from 'vitest';
import {
  screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PromotionOutcome } from '../../../api/keywords';
import { buildKeyword } from '../../../api/keywordGroups-fixtures';
import {
  buildMarketSelectionMock, renderWithMarketSelection
} from '../../Markets/markets-fixtures';
import { MemoryRouter } from 'react-router-dom';
import type { SettingsRead } from '../../../hooks/useSeoSettings';
import { KeywordExplorer } from './KeywordExplorer';
import { PICKER_LABEL } from './TrackedKeywordPicker';

export const BRAZIL_MARKET_ID = 'br-pt';

/** A settled `useMarketKeywords()` read: two tracked keywords unless overridden. */
export function buildMarketKeywordsRead(overrides: Partial<SettingsRead<string[]>> = {}): SettingsRead<string[]> {
  return {
    data: ['hotel lisboa', 'pousada rio'],
    loaded: true,
    error: null,
    ...overrides,
  };
}

/** The explorer with Brazil picked in the header (inside a router, for the Settings links). */
export function renderExplorer() {
  return renderWithMarketSelection(
    <MemoryRouter><KeywordExplorer /></MemoryRouter>,
    buildMarketSelectionMock({ selectedMarketId: BRAZIL_MARKET_ID }),
  );
}

/** Renders the explorer and picks `keyword` in the tracked keyword picker. */
export async function pickTrackedKeyword(keyword: string) {
  const user = userEvent.setup();
  renderExplorer();
  await user.selectOptions(screen.getByLabelText(PICKER_LABEL), keyword);
  return user;
}

/** Types `seed` and presses Search. */
export async function searchFor(seed: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Seed keyword'), seed);
  await user.click(screen.getByRole('button', { name: 'Search' }));
  return user;
}

/** Searches `seed` and waits for the results table. */
export async function searchAndWaitForRows(seed: string) {
  const user = await searchFor(seed);
  await waitFor(() => {
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
  return user;
}

/** Renders the explorer, researches `keyword` and clicks it to open its SERP panel. */
export async function openSerpFor(keyword: string) {
  renderExplorer();
  const user = await searchAndWaitForRows(keyword);
  await user.click(screen.getByRole('button', { name: keyword }));
  return user;
}

/** Ticks `keyword` and presses "Track keywords". */
export async function trackKeyword(user: ReturnType<typeof userEvent.setup>, keyword: string) {
  await user.click(screen.getByRole('checkbox', { name: `Select ${keyword}` }));
  await user.click(screen.getByRole('button', { name: 'Track keywords' }));
}

export function buildPromotionOutcome(overrides: Partial<PromotionOutcome> = {}): PromotionOutcome {
  return {
    created: 1,
    skipped: 0,
    createdKeywords: ['boutique hotel'],
    createdItems: [buildKeyword({ keyword: 'boutique hotel' })],
    skippedKeywords: [],
    groupedKeywords: [],
    ...overrides,
  };
}
