import { screen } from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fetchDomainKeywords, fetchDomainOverview, fetchDomainPages, fetchDomainSnapshots, fetchSerpCompetitors, takeDomainSnapshot
} from '../../../api/seoDomains';
import { isSeoApiConfigured } from '../../../api/seo';
import userEvent from '@testing-library/user-event';
import { PAID_EXPORT_LABEL } from '../../ui/PaidExportButton';
import { exportPlan } from '../../../exporters/paidExport';
import {
  findBrandTrackingLinkElement, getAnalyzeOwnDomainElement, mockBrandSettings, NO_OWN_DOMAIN, OWN_DOMAIN, quickPickDomains
} from '../settingsDomains-fixtures';
import {
  analyzeAndClick, analyzeDomain, mockDomainAnswers, openPagedExport, pagedExportVia,
  renderDomainOverview, SeoRefusal, sentRequest, submitDomain, SWISS_MARKET_ID, type DomainClick
} from './DomainOverviewView-fixtures';
import {
  buildDomainKeywords, buildDomainSnapshots, buildSerpCompetitors, LABS_EXPORT
} from '../../../api/seoDomains-fixtures';
import {
  chooseExportFormat, mockStartExport
} from '../../../test/exportsApiMock';

vi.mock('../../../api/seo', () => import('../../../test/seoApiMock'));
vi.mock('../../../api/seoDomains');
vi.mock('../../../hooks/useIsAdmin', () => import('../../../test/useIsAdminMock'));
vi.mock('../../../hooks/useSeoSettings');
vi.mock('../../../api/exports', () => import('../../../test/exportsApiMock'));

const SNAPSHOT_BUTTON = {
  role: 'button',
  name: 'Snapshot estimated traffic now',
} as const;

const SHOW_SNAPSHOTS = {
  role: 'button',
  name: 'Show stored traffic snapshots',
} as const;

const PAGES_CLICKS = [{
  role: 'tab',
  name: 'Top pages',
}, {
  role: 'button',
  name: /Load top pages/,
}] as const;

const COMPETITORS_CLICKS = [{
  role: 'tab',
  name: 'SERP competitors',
}, {
  role: 'button',
  name: /Find SERP competitors/,
}] as const;

const NO_CLICKS: readonly DomainClick[] = [];

beforeEach(() => {
  vi.mocked(isSeoApiConfigured).mockReturnValue(true);
  mockDomainAnswers();
});

describe('DomainOverviewView before any request', () => {
  it('explains the missing SEO stack when its API URL was not built in', () => {
    vi.mocked(isSeoApiConfigured).mockReturnValue(false);
    const { container } = renderDomainOverview();

    expect(container.querySelector('h3')?.textContent).toBe('SEO data is not set up');
  });

  it('makes no paid call on mount', () => {
    renderDomainOverview();

    expect(vi.mocked(fetchDomainOverview).mock.calls).toHaveLength(0);
  });
});

describe('DomainOverviewView starting from Settings › Brand Tracking', () => {
  it('offers to analyze the own domain while the input is empty', () => {
    renderDomainOverview();

    expect(getAnalyzeOwnDomainElement()).toBeEnabled();
  });

  it('makes no paid call for the own domain before the click', () => {
    renderDomainOverview();

    expect([vi.mocked(fetchDomainOverview).mock.calls, vi.mocked(fetchDomainKeywords).mock.calls]).toStrictEqual([[], []]);
  });

  it('analyzes the own domain in the header market on click', async () => {
    renderDomainOverview();
    await userEvent.setup().click(getAnalyzeOwnDomainElement());

    expect(sentRequest(fetchDomainOverview)).toStrictEqual({
      target: OWN_DOMAIN,
      market_id: SWISS_MARKET_ID,
    });
  });

  it('offers the own domain first, then the competitor domains, as quick picks', () => {
    renderDomainOverview();

    expect(quickPickDomains()).toStrictEqual([OWN_DOMAIN, 'acme.example.org', 'globex.example']);
  });

  it('names the competitor of a competitor quick pick', () => {
    renderDomainOverview();

    expect(screen.getByRole('button', { name: 'acme.example.org' })).toHaveAttribute('title', 'Competitor: Acme');
  });

  it('analyzes a competitor domain when its quick pick is clicked', async () => {
    renderDomainOverview();
    await userEvent.setup().click(screen.getByRole('button', { name: 'globex.example' }));

    expect(sentRequest(fetchDomainOverview)).toStrictEqual({
      target: 'globex.example',
      market_id: SWISS_MARKET_ID,
    });
  });

  it('links to Settings › Brand Tracking when the brand has no own domain', async () => {
    mockBrandSettings(NO_OWN_DOMAIN);
    renderDomainOverview();

    expect(await findBrandTrackingLinkElement()).toHaveAttribute('href', '/settings/brand');
  });

  it('keeps Analyze disabled with an empty input when the brand has no own domain', () => {
    mockBrandSettings(NO_OWN_DOMAIN);
    renderDomainOverview();

    expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  });
});

describe('Analyze', () => {
  it('asks the overview for the target in the header market', async () => {
    await analyzeDomain();

    expect(sentRequest(fetchDomainOverview)).toStrictEqual({
      target: 'example.com',
      market_id: SWISS_MARKET_ID,
    });
  });

  it('labels the traffic as a DataForSEO estimate', async () => {
    await analyzeDomain();

    expect(screen.getByText(/Estimated by DataForSEO from search volume and ranking position, not measured clicks/)).toBeInTheDocument();
  });

  it('loads the first page of keywords sorted by estimated traffic', async () => {
    await analyzeDomain();

    expect(sentRequest(fetchDomainKeywords)).toMatchObject({
      page: 1,
      page_size: 50,
      sort: 'traffic',
      order: 'desc',
    });
  });

  it('shows the API message when the market is not covered', async () => {
    vi.mocked(fetchDomainOverview).mockRejectedValue(new SeoRefusal('DataForSEO does not serve this market'));

    await analyzeDomain();

    expect(screen.getByText('DataForSEO does not serve this market')).toBeInTheDocument();
  });
});

describe('ranked keywords', () => {
  it.each([
    ['Next', { page: 2 }],
    ['Volume', {
      page: 1,
      sort: 'volume',
      order: 'desc',
    }],
  ])('asks the page a click on %s names', async (name, expected) => {
    await analyzeAndClick({
      role: 'button',
      name,
    });

    expect(sentRequest(fetchDomainKeywords, 1)).toMatchObject(expected);
  });

  it('disables Apply over the 8-condition budget', async () => {
    const user = await analyzeDomain();

    await user.type(screen.getAllByLabelText('Include terms')[0], 'a,b,c,d,e,f,g,h,i');

    expect(screen.getAllByRole('button', { name: 'Apply' })[0]).toBeDisabled();
  });

  it('shows the intent of a ranked keyword as a chip in the commercial tone', async () => {
    await analyzeDomain();

    expect(screen.getByText('Commercial')).toHaveClass('bg-purple-50', 'text-purple-700');
  });
});

describe('tabs', () => {
  it('shows top pages after "Load top pages"', async () => {
    await analyzeAndClick(...PAGES_CLICKS);

    expect(await screen.findByText('/blog/a')).toBeInTheDocument();
  });

  it('makes no pages call on opening the tab', async () => {
    await analyzeAndClick(PAGES_CLICKS[0]);

    expect(vi.mocked(fetchDomainPages).mock.calls).toHaveLength(0);
  });

  it('finds SERP competitors for the keywords on screen', async () => {
    await analyzeAndClick(...COMPETITORS_CLICKS);

    expect(sentRequest(fetchSerpCompetitors)).toStrictEqual({
      keywords: ['cheap flights'],
      market_id: SWISS_MARKET_ID,
    });
  });
});

describe('snapshot now', () => {
  it('is not offered to a user who is not an Admin', async () => {
    await analyzeDomain();

    expect(screen.queryByRole(SNAPSHOT_BUTTON.role, { name: SNAPSHOT_BUTTON.name })).not.toBeInTheDocument();
  });

  it('names the paid calls in the confirmation', async () => {
    mockDomainAnswers(true);

    await analyzeAndClick(SNAPSHOT_BUTTON);

    expect(screen.getByText(/This starts 2 paid DataForSEO calls\./)).toBeInTheDocument();
  });

  it('shows no price in the confirmation', async () => {
    mockDomainAnswers(true);

    await analyzeAndClick(SNAPSHOT_BUTTON);

    expect(screen.getByRole('dialog')).not.toHaveTextContent('$');
  });

  it('starts a snapshot of the analyzed host once the Admin confirms', async () => {
    mockDomainAnswers(true);

    await analyzeAndClick(SNAPSHOT_BUTTON, {
      role: 'button',
      name: 'Take snapshot',
    });

    expect(sentRequest(takeDomainSnapshot)).toStrictEqual({
      domain: 'example.com',
      market_id: 'global',
    });
  });
});

describe('stored snapshots', () => {
  it('lists the stored snapshots of the analyzed host on request', async () => {
    await analyzeAndClick(SHOW_SNAPSHOTS);

    expect(sentRequest(fetchDomainSnapshots)).toStrictEqual({
      domain: 'example.com',
      market_id: 'global',
    });
  });

  it('shows the estimated traffic of each snapshot', async () => {
    await analyzeAndClick(SHOW_SNAPSHOTS);

    expect(await screen.findByRole('row', { name: /2026-10-19/ })).toHaveTextContent('8,451');
  });
});

const SCREEN_ROW_EXPORT = 'Export the 1 rows on screen (free)';

describe('Export', () => {
  it.each([
    {
      table: 'ranked keywords',
      clicks: NO_CLICKS,
      params: {
        table: 'keywords',
        sort: 'traffic',
      },
    },
    {
      table: 'top pages',
      clicks: PAGES_CLICKS,
      params: {
        table: 'pages',
        sort: 'traffic',
      },
    },
  ])('queues the $table page on screen as a free server export', async ({
    clicks, params
  }) => {
    expect(await pagedExportVia(SCREEN_ROW_EXPORT, ...clicks)).toMatchObject({
      view: 'seo-domain',
      params: {
        ...params,
        target: 'example.com',
        page: '1',
        page_size: '50',
      },
    });
  });

  it.each([
    {
      table: 'SERP competitors',
      clicks: COMPETITORS_CLICKS,
      params: {
        keywords: JSON.stringify(buildDomainKeywords().items.map((row) => row.keyword)),
        market_id: buildSerpCompetitors().market_id,
        table: 'SERP competitors',
      },
    },
    {
      table: 'Traffic snapshots',
      clicks: [SHOW_SNAPSHOTS],
      params: {
        domain: buildDomainSnapshots().domain,
        market_id: buildDomainSnapshots().market_id,
        table: 'Traffic snapshots',
      },
    },
  ])('queues a server export of the $table on screen', async ({
    clicks, params
  }) => {
    await analyzeAndClick(...clicks);
    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'seo-domain-tables',
      params,
      format: 'xlsx',
    });
  });

  it.each([
    ['opening the ranked-keywords export dialog', () => openPagedExport()],
    ['exporting the ranked keywords on screen', () => pagedExportVia(SCREEN_ROW_EXPORT)],
    ['starting the paid ranked-keywords export', () => pagedExportVia('Start export')],
  ])('asks DataForSEO for no keywords beyond the page on screen when %s', async (_step, step) => {
    await step();

    expect(fetchDomainKeywords).toHaveBeenCalledTimes(1);
  });

  it('names the ranked keywords in the export dialog', async () => {
    await openPagedExport();

    expect(screen.getByRole('dialog', { name: 'Export ranked keywords' })).toHaveTextContent('Price: up to $0.03 · 1 DataForSEO request');
  });

  it('queues the ranked keywords with the sort, filters and market on screen at their confirmed price', async () => {
    const queued = await pagedExportVia('Start export', {
      role: 'button',
      name: 'Volume',
    });
    const page = sentRequest(fetchDomainKeywords, 1);

    expect(queued?.params).toMatchObject({
      table: 'keywords',
      target: page?.target,
      market_id: page?.market_id,
      sort: 'volume',
      order: 'desc',
      filters: JSON.stringify(page?.filters),
      rows: '120',
      price_usd: String(exportPlan(120, LABS_EXPORT).priceUsd),
    });
  });

  it('queues the top pages export without a page', async () => {
    const queued = await pagedExportVia('Start export', ...PAGES_CLICKS);

    expect(queued?.params).not.toHaveProperty('page');
  });

  it('labels the ranked-keywords export "Export"', async () => {
    await analyzeDomain();

    expect(screen.getByRole('button', { name: PAID_EXPORT_LABEL })).toHaveAttribute('title', 'Choose how many rows to export from DataForSEO');
  });

  it('disables the ranked-keywords export when the page has no keyword', async () => {
    vi.mocked(fetchDomainKeywords).mockResolvedValue(buildDomainKeywords({
      items: [],
      total_count: 0,
      has_more: false,
    }));

    await submitDomain();

    expect(await screen.findByRole('button', { name: PAID_EXPORT_LABEL })).toBeDisabled();
  });

  it('disables the SERP competitors export when none was found', async () => {
    vi.mocked(fetchSerpCompetitors).mockResolvedValue(buildSerpCompetitors({ items: [] }));

    await analyzeAndClick(...COMPETITORS_CLICKS);

    expect(await screen.findByRole('button', { name: /^Export all$/ })).toBeDisabled();
  });
});
