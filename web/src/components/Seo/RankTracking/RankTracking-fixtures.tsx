/**
 * Rendering and interaction support for the Rank Tracking view specs. The specs mock `useIsAdmin`
 * and the rank tracking client; these helpers drive the view through them.
 */
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  expect, vi
} from 'vitest';
import { fetchKeywordGroups } from '../../../api/keywordGroups';
import { buildGroup } from '../../../api/keywordGroups-fixtures';
import {
  createRankTracker,
  estimateRankTracker,
  fetchRankHistory,
  fetchRankResults,
  fetchRankTracker,
  fetchRankTrackers,
  fetchRankTrend,
} from '../../../api/seoRankTracking';
import {
  buildRankEstimate, buildRankResults, buildRankTracker, buildRankTrend, buildTrackerList
} from '../../../api/seoRankTracking-fixtures';
import {
  buildMarketSelectionMock, renderWithMarketSelection
} from '../../Markets/markets-fixtures';
import { RankTrackingView } from './RankTrackingView';

type User = ReturnType<typeof userEvent.setup>;

/** The keyword group the Settings › Keywords mock holds. */
export const CORUNA_GROUP = buildGroup({
  id: 'group-coruna',
  name: 'Hotel Coruña',
});

/**
 * Answers every rank tracking read (the specs mock `api/seoRankTracking` and `api/keywordGroups`): one tracker
 * with results, one keyword group, an estimate of 2 keywords; creating a tracker answers that tracker.
 */
export function mockRankTrackingApi(): void {
  vi.mocked(fetchKeywordGroups).mockResolvedValue([CORUNA_GROUP]);
  vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList());
  vi.mocked(fetchRankTracker).mockResolvedValue({
    tracker: buildRankTracker(),
    keywords: [],
  });
  vi.mocked(fetchRankResults).mockResolvedValue(buildRankResults());
  vi.mocked(fetchRankTrend).mockResolvedValue(buildRankTrend());
  vi.mocked(fetchRankHistory).mockResolvedValue({
    tracker_id: 'rt-example',
    keyword_id: 'kw-1',
    depth: 30,
    points: [],
  });
  vi.mocked(estimateRankTracker).mockResolvedValue(buildRankEstimate());
  vi.mocked(createRankTracker).mockResolvedValue({ tracker: buildRankTracker() });
}

/** The view (in a router, for its Settings links) with `selectedMarketId` in the header (every market combined). */
export function renderRankTracking(selectedMarketId: string | null = null): User {
  const user = userEvent.setup();
  renderWithMarketSelection(<MemoryRouter><RankTrackingView /></MemoryRouter>, buildMarketSelectionMock({ selectedMarketId }));
  return user;
}

/** The tracker list answers one tracker in Chile (`cl-es`). */
export function mockChileTracker(): void {
  vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({ trackers: [buildRankTracker({ market_id: 'cl-es' })] }));
}

/** Renders the view with no tracker and an estimate of `keywordCount` keywords, `selectedMarketId` in the header. */
export function renderEmptyMarket(keywordCount: number, selectedMarketId: string | null = null): User {
  vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({ trackers: [] }));
  vi.mocked(estimateRankTracker).mockResolvedValue(buildRankEstimate({ keyword_count: keywordCount }));
  return renderRankTracking(selectedMarketId);
}

/** Renders the view and waits for the selected tracker's results table. */
export async function renderWithResults(): Promise<User> {
  const user = renderRankTracking();
  await screen.findByRole('table');
  return user;
}

/** Renders the view, waits for the results and clicks the button named `name`. */
export async function clickAfterResults(name: string): Promise<User> {
  const user = await renderWithResults();
  await user.click(screen.getByRole('button', { name }));
  return user;
}

/** Renders the view while the market has no tracker and clicks the one-click card's button named `name`. */
export async function clickOnEmptyMarket(name: string, selectedMarketId: string | null = null): Promise<User> {
  const user = renderRankTracking(selectedMarketId);
  await user.click(await screen.findByRole('button', { name }));
  return user;
}

/** Opens "Track a domain" and presses Review on its prefilled form. */
export async function reviewNewTracker(): Promise<User> {
  const user = await clickAfterResults('Track a domain');
  await user.click(screen.getByRole('button', { name: 'Review' }));
  return user;
}

/** Opens "Track a domain" and picks the one-keyword-group scope. */
export async function chooseGroupScope(): Promise<User> {
  const user = await clickAfterResults('Track a domain');
  await user.click(screen.getByRole('radio', { name: 'One keyword group' }));
  return user;
}

/** Presses Review on an open tracker form, then the confirm button named `confirmLabel` of its estimate. */
export async function reviewAndConfirm(user: User, confirmLabel = 'Confirm and save'): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Review' }));
  await user.click(await screen.findByRole('button', { name: confirmLabel }));
}

/** Renders the view, presses "Check rankings" and returns the confirmation dialog. */
export async function openRunConfirmation(): Promise<{
  user: User;
  dialog: HTMLElement 
}> {
  const user = await clickAfterResults('Check rankings');
  return {
    user,
    dialog: await screen.findByRole('dialog'),
  };
}

/** The table row of `keyword`. */
export function getRowElement(keyword: string): HTMLElement {
  const button = within(screen.getByRole('table')).getByRole('button', { name: keyword });
  const row = button.closest('tr');
  expect(row).not.toBeNull();
  return row ?? button;
}

/** Renders the view, presses Remove on the row of `keyword` and answers its confirmation with `answer`. */
export async function answerKeywordRemoval(keyword: string, answer: 'Remove' | 'Cancel'): Promise<void> {
  const user = await clickAfterResults(`Remove ${keyword}`);
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: answer }));
}
