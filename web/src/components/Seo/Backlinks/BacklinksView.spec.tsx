import { BacklinksView } from './BacklinksView';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { isSeoApiConfigured } from '../../../api/seo';
import {
  render, screen, waitFor
} from '@testing-library/react';
import {
  BACKLINKS_EXPORT, buildBacklinkRow, buildOverview, buildSnapshots, buildTablePage
} from '../../../api/seoBacklinks-fixtures';
import {
  fetchBacklinkSnapshots, fetchBacklinksOverview, fetchBacklinksTable, startBacklinkSnapshots
} from '../../../api/seoBacklinks';
import {
  SOURCE_DOMAIN, clickExportStart, findExpandButton, openBacklinksExport, pressInBacklinksExport, renderBacklinksView,
  renderExpanded, renderExportReady, renderSearched, renderSpamIncluded, searchTarget, submitTarget, waitForLastTableRequest
} from './BacklinksView-fixtures';
import { mockStartExport } from '../../../test/exportsApiMock';
import { exportPlan } from '../../../exporters/paidExport';
import { mockAdminRole } from '../../../test/useIsAdminMock';
import {
  findBrandTrackingLinkElement, getAnalyzeOwnDomainElement, mockBrandSettings, NO_OWN_DOMAIN, OWN_DOMAIN, quickPickDomains
} from '../settingsDomains-fixtures';

vi.mock('../../../api/seo', () => import('../../../test/seoApiMock'));
vi.mock('../../../api/seoBacklinks');
vi.mock('../../../api/exports', () => import('../../../test/exportsApiMock'));
vi.mock('../../../hooks/useIsAdmin', () => import('../../../test/useIsAdminMock'));
vi.mock('../../../hooks/useSeoSettings');

class ValidationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationFailure';
  }
}

const SCREEN_EXPORT = 'Export the 1 rows on screen (free)';

/** The backlinks table a search of example.com shows first, without its page. */
const EXPORT_LIST = {
  target: 'example.com',
  scope: 'subdomains',
  sort_field: 'first_seen',
  sort_order: 'desc',
  filters: {},
  include_spam: false,
  mode: 'one_per_domain',
} as const;

/** `EXPORT_LIST` as `seo-backlinks` export params (strings, filters as JSON). */
const EXPORT_PARAMS = {
  tab: 'backlinks',
  target: 'example.com',
  scope: 'subdomains',
  sort_field: 'first_seen',
  sort_order: 'desc',
  filters: '{}',
  include_spam: 'false',
  mode: 'one_per_domain',
} as const;

beforeEach(() => {
  mockAdminRole(false);
  mockBrandSettings();
  vi.mocked(isSeoApiConfigured).mockReturnValue(true);
  vi.mocked(fetchBacklinkSnapshots).mockResolvedValue(buildSnapshots());
  vi.mocked(fetchBacklinksOverview).mockResolvedValue(buildOverview());
  vi.mocked(fetchBacklinksTable).mockResolvedValue(buildTablePage('backlinks', [buildBacklinkRow()]));
});

describe('BacklinksView before a search', () => {
  it('explains how to set SEO data up when the dashboard has no SEO API', () => {
    vi.mocked(isSeoApiConfigured).mockReturnValue(false);
    render(<BacklinksView />);

    expect(screen.getByRole('heading').textContent).toBe('SEO data is not set up');
  });

  it('makes no paid request on mount', async () => {
    await renderBacklinksView();

    expect([vi.mocked(fetchBacklinksOverview).mock.calls, vi.mocked(fetchBacklinksTable).mock.calls]).toStrictEqual([[], []]);
  });

  it('offers your and your competitors domains as quick picks', async () => {
    await renderBacklinksView();

    expect(screen.getByRole('button', { name: 'acme.example.org' })).toBeInTheDocument();
  });
});

describe('BacklinksView starting from Settings › Brand Tracking', () => {
  it('offers to analyze the own domain while the input is empty', async () => {
    await renderBacklinksView();

    expect(getAnalyzeOwnDomainElement()).toBeEnabled();
  });

  it('looks the own domain up with its subdomains on click', async () => {
    const user = await renderBacklinksView();
    await user.click(getAnalyzeOwnDomainElement());

    expect(vi.mocked(fetchBacklinksOverview).mock.calls[0][0]).toStrictEqual({
      target: OWN_DOMAIN,
      scope: 'subdomains',
    });
  });

  it('offers Settings domains and tracked domains once each, own domains first', async () => {
    await renderBacklinksView();

    expect(quickPickDomains()).toStrictEqual([OWN_DOMAIN, 'example.com', 'acme.example.org', 'globex.example']);
  });

  it('names the competitor of a competitor quick pick', async () => {
    await renderBacklinksView();

    expect(screen.getByRole('button', { name: 'globex.example' })).toHaveAttribute('title', 'Competitor: Globex');
  });

  it('links to Settings › Brand Tracking when the brand has no own domain', async () => {
    mockBrandSettings(NO_OWN_DOMAIN);
    await renderBacklinksView();

    expect(await findBrandTrackingLinkElement()).toHaveAttribute('href', '/settings/brand');
  });

  it('keeps Search disabled with an empty input when the brand has no own domain', async () => {
    mockBrandSettings(NO_OWN_DOMAIN);
    await renderBacklinksView();

    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });
});

describe('BacklinksView export', () => {
  it('offers one Export in the table toolbar and no CSV button', async () => {
    await renderExportReady();

    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  });

  it('prices the backlinks export at the backlinks rates', async () => {
    await openBacklinksExport();

    expect(screen.getByRole('dialog', { name: 'Export backlinks' })).toHaveTextContent('Price: up to $0.03 · 1 DataForSEO request');
  });

  it.each([
    ['opening the export dialog', openBacklinksExport],
    ['exporting the rows on screen', () => pressInBacklinksExport(SCREEN_EXPORT)],
    ['starting the paid export', () => pressInBacklinksExport('Start export')],
  ])('asks DataForSEO for no new page when %s', async (_step, step) => {
    await step();

    expect(vi.mocked(fetchBacklinksTable).mock.calls).toHaveLength(1);
  });

  it('queues the page on screen of the searched target for free', async () => {
    await pressInBacklinksExport(SCREEN_EXPORT);

    await waitFor(() => {
      expect(mockStartExport).toHaveBeenCalledWith({
        view: 'seo-backlinks',
        params: {
          ...EXPORT_PARAMS,
          page: '1',
          page_size: '50',
        },
        format: 'xlsx',
      });
    });
  });

  it('queues the confirmed rows with the spam setting, sort and link mode on screen', async () => {
    await clickExportStart(await renderSpamIncluded());

    await waitFor(() => {
      expect(mockStartExport).toHaveBeenCalledWith({
        view: 'seo-backlinks',
        params: {
          ...EXPORT_PARAMS,
          include_spam: 'true',
          rows: '120',
          price_usd: String(exportPlan(120, BACKLINKS_EXPORT).priceUsd),
        },
        format: 'xlsx',
      });
    });
  });
});

describe('BacklinksView search', () => {
  it('asks the overview once with the scope the input implies', async () => {
    const user = await renderBacklinksView();
    await searchTarget(user, 'example.com/blog');

    expect(vi.mocked(fetchBacklinksOverview).mock.calls.map(([request]) => request)).toStrictEqual([{
      target: 'example.com/blog',
      scope: 'subfolder',
    }]);
  });

  it('keeps the scope the user picked when the input changes', async () => {
    const user = await renderBacklinksView();
    await user.selectOptions(screen.getByLabelText('Scope'), 'domain');
    await searchTarget(user, 'example.com');

    expect(vi.mocked(fetchBacklinksOverview).mock.calls[0][0].scope).toBe('domain');
  });

  it('asks the first backlinks page with likely spam hidden, newest first', async () => {
    await renderSearched();

    await waitForLastTableRequest({
      ...EXPORT_LIST,
      page: 1,
      page_size: 50,
    });
  });

  it('asks again with likely spam included when the toggle is ticked', async () => {
    await renderSpamIncluded();

    expect(fetchBacklinksTable).toHaveBeenLastCalledWith('backlinks', expect.objectContaining({ include_spam: true }), expect.anything());
  });

  it('shows the error the server sent', async () => {
    vi.mocked(fetchBacklinksOverview).mockRejectedValue(new ValidationFailure('Enter a valid domain like example.com'));
    const user = await renderBacklinksView();
    await submitTarget(user, 'my_site.com');

    expect(await screen.findByText('Enter a valid domain like example.com')).toBeInTheDocument();
  });
});

describe('BacklinksView domain expansion', () => {
  it('loads every link of an expanded referring domain, strongest first', async () => {
    await renderExpanded();

    await waitForLastTableRequest({
      filters: { domain_from: SOURCE_DOMAIN },
      mode: 'as_is',
      sort_field: 'rank',
      page_size: 100,
    });
  });

  it('asks nothing more when a loaded domain is collapsed and expanded again', async () => {
    const user = await renderExpanded();
    const hide = await findExpandButton('Hide');
    const requests = vi.mocked(fetchBacklinksTable).mock.calls.length;
    await user.click(hide);
    await user.click(await findExpandButton('Show'));

    expect(vi.mocked(fetchBacklinksTable).mock.calls).toHaveLength(requests);
  });
});

describe('BacklinksView snapshots', () => {
  /** An Admin's page with the snapshot confirmation open. */
  async function setupSnapshotConfirmation() {
    mockAdminRole(true);
    const user = await renderBacklinksView();
    await user.click(screen.getByRole('button', { name: 'Snapshot now' }));
    return user;
  }
  it('hides the snapshot controls from a non-admin', async () => {
    await renderBacklinksView();

    expect(screen.queryByRole('button', { name: 'Snapshot now' })).not.toBeInTheDocument();
  });

  it('asks to confirm the paid call count, without a price, before a snapshot', async () => {
    await setupSnapshotConfirmation();

    expect(screen.getByRole('dialog')).toHaveTextContent('This starts 2 paid DataForSEO calls, one per domain. Continue?');
  });

  it('starts a snapshot only after the admin confirms', async () => {
    vi.mocked(startBacklinkSnapshots).mockResolvedValue({
      started: true,
      domains: 2,
    });
    const user = await setupSnapshotConfirmation();
    const beforeConfirm = vi.mocked(startBacklinkSnapshots).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Snapshot' }));

    expect(beforeConfirm).toBe(0);
    expect(await screen.findByText(/Snapshot started for 2 domains/)).toBeInTheDocument();
  });
});
