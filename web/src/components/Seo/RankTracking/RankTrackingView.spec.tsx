import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  screen, waitFor, within
} from '@testing-library/react';
import { isSeoApiConfigured } from '../../../api/seo';
import { getSeoNotSetUpElement } from '../../../test/seoNotSetUp';
import { mockAdminRole } from '../../../test/useIsAdminMock';
import {
  createRankTracker,
  estimateRankTracker,
  fetchLatestRankRun,
  fetchRankHistory,
  fetchRankResults,
  fetchRankTrackers,
  addRankKeywords,
  removeRankKeywords,
  startRankRun,
  updateRankTracker,
} from '../../../api/seoRankTracking';
import {
  buildRankCell, buildRankEstimate, buildRankResults, buildRankRun, buildRankTracker, buildResultRow, buildTrackerList
} from '../../../api/seoRankTracking-fixtures';
import { TestError } from '../../../test/testError';
import { emitLive } from '../../../test/liveEventsMock';
import {
  answerKeywordRemoval, chooseGroupScope, clickAfterResults, clickOnEmptyMarket, getRowElement, mockChileTracker, mockRankTrackingApi,
  openRunConfirmation, renderEmptyMarket, renderRankTracking, renderWithResults, reviewAndConfirm, reviewNewTracker
} from './RankTracking-fixtures';
import {
  chooseExportFormat, mockStartExport
} from '../../../test/exportsApiMock';

vi.mock('../../../api/seo', () => import('../../../test/seoApiMock'));
vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));
vi.mock('../../../api/keywordGroups', () => ({ fetchKeywordGroups: vi.fn() }));
vi.mock('../../../hooks/useIsAdmin', () => import('../../../test/useIsAdminMock'));
vi.mock('../../../api/seoRankTracking');
vi.mock('../../../infrastructure/liveEvents', () => import('../../../test/liveEventsMock'));
vi.mock('../../../api/exports', () => import('../../../test/exportsApiMock'));

const NO_TRACKERS = buildTrackerList({ trackers: [] });

beforeEach(() => {
  mockAdminRole(true);
  vi.mocked(isSeoApiConfigured).mockReturnValue(true);
  mockRankTrackingApi();
});

describe('RankTrackingView setup', () => {
  it('shows the not-set-up state without fetching when the SEO API URL is missing', () => {
    vi.mocked(isSeoApiConfigured).mockReturnValue(false);

    renderRankTracking();

    expect(getSeoNotSetUpElement()).toBeInTheDocument();
    expect(fetchRankTrackers).not.toHaveBeenCalledWith();
  });

  it('names the tracker market on its card', async () => {
    mockChileTracker();

    renderRankTracking();

    expect(await screen.findByText(/^Chile \(Spanish\) · /)).toBeInTheDocument();
  });

  it('shows the market of the tracker being edited, not the header market', async () => {
    mockChileTracker();

    await clickAfterResults('Edit');

    expect(screen.getByText('Market: Chile (Spanish)')).toBeInTheDocument();
  });

  it('opens on the tracker named by ?tracker= (the Schedule page links)', async () => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({
      trackers: [buildRankTracker(), buildRankTracker({
        tracker_id: 'rt-second',
        domain: 'second.example' 
      })],
    }));

    renderRankTracking(null, '/seo/rank-tracking?tracker=rt-second');

    await waitFor(() => expect(fetchRankResults).toHaveBeenLastCalledWith('rt-second', expect.any(String)));
  });

  it('starts no paid run when the view opens', async () => {
    await renderWithResults();

    expect(startRankRun).not.toHaveBeenCalledWith('rt-example');
  });
});

describe('RankTrackingView results', () => {
  it('shows the change since the comparison check with an arrow', async () => {
    await renderWithResults();

    expect(within(getRowElement('cheap flights')).getByText('▲ 6 → 4')).toBeInTheDocument();
  });

  it('shows an unconfirmed miss as Not found (unconfirmed)', async () => {
    const unconfirmed = buildRankCell({
      status: 'not_found_unconfirmed',
      position: null,
      url: null,
    });
    vi.mocked(fetchRankResults).mockResolvedValue(buildRankResults({ rows: [buildResultRow({ desktop: unconfirmed })] }));

    await renderWithResults();

    expect(within(getRowElement('cheap flights')).getByText('Not found (unconfirmed)')).toBeInTheDocument();
  });

  it('asks the results for the period chosen in the compare select', async () => {
    const user = await renderWithResults();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Compare with' }), '30d');

    await waitFor(() => {
      expect(fetchRankResults).toHaveBeenLastCalledWith('rt-example', '30d');
    });
  });

  it('opens a keyword history when the keyword is clicked', async () => {
    await clickAfterResults('cheap flights');

    await waitFor(() => {
      expect(fetchRankHistory).toHaveBeenCalledWith('rt-example', 'kw-1');
    });
  });
});

describe('RankTrackingView paid actions', () => {
  it('names the paid calls of a manual check without starting it', async () => {
    const { dialog } = await openRunConfirmation();

    expect(within(dialog).getByText(/Each check starts 4 paid DataForSEO calls for 2 keywords/)).toBeInTheDocument();
    expect(startRankRun).not.toHaveBeenCalledWith('rt-example');
  });

  it('shows no price in the manual check confirmation', async () => {
    const { dialog } = await openRunConfirmation();

    expect(dialog).not.toHaveTextContent('$');
  });

  it('starts the run only after the check is confirmed', async () => {
    vi.mocked(startRankRun).mockResolvedValue({ run: buildRankRun({ status: 'pending' }) });
    const {
      user, dialog
    } = await openRunConfirmation();

    await user.click(within(dialog).getByRole('button', { name: 'Check rankings' }));

    expect(startRankRun).toHaveBeenCalledWith('rt-example');
  });

  it('hides the paid, editing and keyword removal actions from a non-admin', async () => {
    mockAdminRole(false);

    await renderWithResults();

    expect(screen.queryByRole('button', { name: 'Check rankings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Track a domain' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove cheap flights' })).not.toBeInTheDocument();
  });

  it('shows the monthly check count of a scheduled tracker before creating it', async () => {
    await reviewNewTracker();

    expect(await screen.findByText('The schedule runs about 4 checks a month.')).toBeInTheDocument();
    expect(createRankTracker).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe('RankTrackingView editing', () => {
  it('adds the typed keywords to the tracker after the save is confirmed', async () => {
    vi.mocked(updateRankTracker).mockResolvedValue({ tracker: buildRankTracker() });
    vi.mocked(addRankKeywords).mockResolvedValue({
      added: 1,
      keyword_count: 3,
    });
    const user = await clickAfterResults('Edit');
    await user.click(screen.getByRole('button', { name: 'Extra keywords' }));
    await user.type(screen.getByRole('textbox', { name: 'Extra keywords to add (one per line)' }), 'Late Flights');

    await reviewAndConfirm(user);

    expect(addRankKeywords).toHaveBeenCalledWith('rt-example', ['late flights']);
  });
});

describe('RankTrackingView run progress', () => {
  it('reads the active run when a step of it ran and reloads the results when it ends', async () => {
    const running = buildRankRun({
      status: 'running',
      keywords_checked: 1,
    });
    vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({ trackers: [buildRankTracker({ latest_run: running })] }));
    vi.mocked(fetchLatestRankRun).mockResolvedValueOnce(running).mockResolvedValue(buildRankRun());
    await renderWithResults();
    await waitFor(() => {
      expect(fetchLatestRankRun).toHaveBeenCalledTimes(1);
    });
    const loads = vi.mocked(fetchRankResults).mock.calls.length;

    await emitLive('seo', {
      type: 'seo-job.changed',
      feature: 'rank',
      id: buildRankTracker().tracker_id,
    });

    await waitFor(() => {
      expect(vi.mocked(fetchRankResults).mock.calls.length).toBeGreaterThan(loads);
    });
  });
});

describe('RankTrackingView keyword removal', () => {
  beforeEach(() => {
    const groupRow = buildResultRow({
      keyword_id: 'kw-2',
      keyword: 'flight deals',
      source: 'group',
    });
    vi.mocked(fetchRankResults).mockResolvedValue(buildRankResults({ rows: [buildResultRow(), groupRow] }));
    vi.mocked(removeRankKeywords).mockResolvedValue({
      keyword_count: 0,
      removed: 1,
    });
  });

  it('offers Remove on a hand-added keyword and none on a group keyword when the user is an Admin', async () => {
    await renderWithResults();

    expect(within(getRowElement('cheap flights')).getByRole('button', { name: 'Remove cheap flights' })).toBeInTheDocument();
    expect(within(getRowElement('flight deals')).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('removes nothing when the confirmation is cancelled', async () => {
    await answerKeywordRemoval('cheap flights', 'Cancel');

    expect(removeRankKeywords).not.toHaveBeenCalledWith('rt-example', ['kw-1']);
  });

  it('removes the keyword by id when the confirmation is accepted', async () => {
    await answerKeywordRemoval('cheap flights', 'Remove');

    expect(removeRankKeywords).toHaveBeenCalledWith('rt-example', ['kw-1']);
  });

  it('reloads the results after the keyword is removed', async () => {
    await answerKeywordRemoval('cheap flights', 'Remove');

    await waitFor(() => expect(fetchRankResults).toHaveBeenCalledTimes(2));
  });

  it('shows the failure message when the removal is refused', async () => {
    vi.mocked(removeRankKeywords).mockRejectedValue(new TestError('Admin access required'));

    await answerKeywordRemoval('cheap flights', 'Remove');

    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });
});

describe('RankTrackingView form domain from Settings', () => {
  it('preselects the brand own domain of Brand Tracking', async () => {
    await clickAfterResults('Track a domain');

    expect(screen.getByRole('combobox', { name: 'Domain' })).toHaveValue('example.com');
  });

  it('offers each competitor domain with the competitor name', async () => {
    await clickAfterResults('Track a domain');

    expect(screen.getByRole('option', { name: 'Competitor: Acme (acme.example.org)' })).toBeInTheDocument();
  });

  it('asks for a typed domain only after Other domain is chosen', async () => {
    const user = await clickAfterResults('Track a domain');
    expect(screen.queryByRole('textbox', { name: 'Other domain' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Domain' }), 'Other domain…');

    expect(screen.getByRole('textbox', { name: 'Other domain' })).toBeInTheDocument();
  });

  it('links to Settings › Brand Tracking instead of a domain field when Brand Tracking has no domain', async () => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({
      owned_domains: [],
      competitor_domains: {},
    }));

    await clickAfterResults('Track a domain');

    expect(screen.queryByRole('combobox', { name: 'Domain' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings › Brand Tracking' })).toHaveAttribute('href', '/settings/brand');
  });
});

describe('RankTrackingView form keywords from Settings', () => {
  it('estimates a new tracker on every keyword of the header market', async () => {
    await reviewNewTracker();

    expect(estimateRankTracker).toHaveBeenCalledWith({
      devices: 'mobile',
      depth: 30,
      schedule: 'weekly',
      keyword_scope: 'all',
      keywords: [],
    });
  });

  it('creates a group tracker for the chosen keyword group', async () => {
    const user = await chooseGroupScope();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Keyword group' }), 'group-coruna');

    await reviewAndConfirm(user);

    expect(createRankTracker).toHaveBeenCalledWith(expect.objectContaining({
      keyword_scope: 'group',
      group_id: 'group-coruna',
    }));
  });

  it('keeps Review disabled for the group scope until a group is chosen', async () => {
    await chooseGroupScope();

    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
  });

  it('keeps the extra keywords collapsed until asked for', async () => {
    await clickAfterResults('Track a domain');

    expect(screen.queryByRole('textbox', { name: 'Extra keywords (one per line)' })).not.toBeInTheDocument();
  });

  it('states the keyword cap when the scope holds more keywords than a check covers', async () => {
    vi.mocked(estimateRankTracker).mockResolvedValue(buildRankEstimate({
      keyword_count: 1000,
      scope_keyword_count: 1203,
    }));

    await reviewNewTracker();

    expect(await screen.findByText('These keywords number 1,203; each check covers the first 1,000.')).toBeInTheDocument();
  });

  it('leaves the scope of an older tracker of extra keywords unchanged when it is saved', async () => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({ trackers: [buildRankTracker({ keyword_scope: 'list' })] }));
    vi.mocked(updateRankTracker).mockResolvedValue({ tracker: buildRankTracker({ keyword_scope: 'list' }) });
    const user = await clickAfterResults('Edit');

    await reviewAndConfirm(user);

    expect(updateRankTracker).toHaveBeenCalledWith('rt-example', {
      devices: 'both',
      depth: 30,
      schedule: 'weekly',
    });
  });
});

describe('RankTrackingView one-click start', () => {
  it('offers to track the own domain for the market keywords when the market has no tracker', async () => {
    renderEmptyMarket(12);

    expect(await screen.findByText('Track example.com for your 12 keywords without a market.')).toBeInTheDocument();
  });

  it('names the header market in the one-click offer when one is chosen', async () => {
    renderEmptyMarket(12, 'cl-es');

    expect(await screen.findByText('Track example.com for your 12 keywords in Chile (Spanish).')).toBeInTheDocument();
  });

  it('says the market has no keyword yet when its count is zero', async () => {
    renderEmptyMarket(0, 'cl-es');

    expect(await screen.findByText('No active keyword in Chile (Spanish) yet.')).toBeInTheDocument();
  });

  it('opens the form prefilled with the defaults and creates nothing yet', async () => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(NO_TRACKERS);

    await clickOnEmptyMarket('Track your rankings');

    expect(screen.getByRole('radio', { name: 'All tracked keywords without a market' })).toBeChecked();
    expect(createRankTracker).not.toHaveBeenCalledWith(expect.anything());
  });

  it('creates the own tracker in the header market once the review is confirmed', async () => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(NO_TRACKERS);
    const user = await clickOnEmptyMarket('Track your rankings', 'cl-es');

    await reviewAndConfirm(user);

    expect(createRankTracker).toHaveBeenCalledWith({
      devices: 'mobile',
      depth: 30,
      schedule: 'weekly',
      keyword_scope: 'all',
      domain: 'example.com',
      keywords: [],
      market_id: 'cl-es',
    });
  });

  it('creates one tracker per competitor domain after the confirmation', async () => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({
      trackers: [],
      competitor_domains: {
        Acme: ['acme.example.org'],
        Globex: ['globex.example.net'],
      },
    }));
    const user = await clickOnEmptyMarket('Track competitors');

    await reviewAndConfirm(user, 'Confirm and create');

    expect(vi.mocked(createRankTracker).mock.calls.map(([request]) => request.domain)).toStrictEqual(['acme.example.org', 'globex.example.net']);
  });

  it('names the paid calls per competitor tracker before creating them', async () => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(NO_TRACKERS);
    const user = await clickOnEmptyMarket('Track competitors');

    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(within(await screen.findByRole('dialog')).getByText('1 tracker; for each of them:')).toBeInTheDocument();
    expect(createRankTracker).toHaveBeenCalledTimes(0);
  });

  it('links to Brand Tracking instead of offering the own tracker when no domain is set', async () => {
    vi.mocked(fetchRankTrackers).mockResolvedValue(buildTrackerList({
      trackers: [],
      owned_domains: [],
    }));

    renderRankTracking();

    expect(await screen.findByRole('link', { name: 'Open Settings › Brand Tracking' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Track your rankings' })).not.toBeInTheDocument();
  });

  it('shows a non-admin the empty state without the one-click card', async () => {
    mockAdminRole(false);
    vi.mocked(fetchRankTrackers).mockResolvedValue(NO_TRACKERS);

    renderRankTracking();

    expect(await screen.findByText('No rank tracker in this market')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Track your rankings' })).not.toBeInTheDocument();
  });
});

describe('RankTrackingView export', () => {
  it('exports the tracker results of the chosen period from the server', async () => {
    const user = await renderWithResults();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Compare with' }), '30d');
    await screen.findByRole('table');

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'seo-rank-tracking',
      params: {
        period: '30d',
        tracker_id: 'rt-example',
      },
      format: 'xlsx',
    });
  });

  it('disables the export while the tracker has no results', async () => {
    vi.mocked(fetchRankResults).mockResolvedValue(buildRankResults({ rows: [] }));

    await renderWithResults();

    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled();
  });
});
