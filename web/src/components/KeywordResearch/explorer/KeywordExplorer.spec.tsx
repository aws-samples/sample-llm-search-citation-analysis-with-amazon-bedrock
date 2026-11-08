import { promoteKeywords } from '../../../api/keywords';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fetchSerp, isSeoApiConfigured, researchKeywords
} from '../../../api/seo';
import { fetchKeywordGroups } from '../../../api/keywordGroups';
import { buildGroup } from '../../../api/keywordGroups-fixtures';
import {
  screen, waitFor
} from '@testing-library/react';
import {
  buildOrganicItem, buildResearchResponse, buildSerpResponse
} from '../../../api/seo-fixtures';
import { useMarketKeywords } from '../../../hooks/useSeoSettings';
import {
  chooseExportFormat, mockStartExport
} from '../../../test/exportsApiMock';
import {
  BRAZIL_MARKET_ID, buildMarketKeywordsRead, buildPromotionOutcome, openSerpFor, renderExplorer, searchAndWaitForRows,
  searchFor, trackKeyword
} from './KeywordExplorer-fixtures';

vi.mock('../../../hooks/useSeoSettings');

vi.mock('../../../api/seo', () => ({
  isSeoApiConfigured: vi.fn(),
  researchKeywords: vi.fn(),
  fetchSerp: vi.fn(),
  seoErrorMessage: (failure: unknown) => (failure instanceof Error ? failure.message : 'failed'),
}));
vi.mock('../../../api/keywords', () => ({ promoteKeywords: vi.fn() }));
vi.mock('../../../api/exports', () => import('../../../test/exportsApiMock'));
vi.mock('../../../api/keywordGroups', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/keywordGroups')>(),
  fetchKeywordGroups: vi.fn(),
}));

class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

const GROUP = buildGroup({
  id: 'group-1',
  name: 'Lisbon hotel',
});

beforeEach(() => {
  vi.mocked(isSeoApiConfigured).mockReturnValue(true);
  vi.mocked(researchKeywords).mockResolvedValue(buildResearchResponse({ market_id: BRAZIL_MARKET_ID }));
  vi.mocked(fetchSerp).mockResolvedValue(buildSerpResponse());
  vi.mocked(promoteKeywords).mockResolvedValue(buildPromotionOutcome());
  vi.mocked(fetchKeywordGroups).mockResolvedValue([GROUP]);
  vi.mocked(useMarketKeywords).mockReturnValue(buildMarketKeywordsRead());
});

describe('KeywordExplorer setup', () => {
  it('shows the not-set-up state when the SEO API URL is missing', () => {
    vi.mocked(isSeoApiConfigured).mockReturnValue(false);

    renderExplorer();

    expect(screen.getByRole('heading', { name: 'SEO data is not set up' })).toBeInTheDocument();
  });

  it('requests nothing before Search is pressed', () => {
    renderExplorer();

    expect(researchKeywords).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });
});

describe('KeywordExplorer search', () => {
  it('researches the seed once in the header market with the default options', async () => {
    renderExplorer();
    await searchAndWaitForRows('boutique hotel');

    expect(researchKeywords).toHaveBeenCalledTimes(1);
    expect(researchKeywords).toHaveBeenCalledWith({
      keyword: 'boutique hotel',
      mode: 'auto',
      limit: 150,
      group_keywords: false,
      clickstream: false,
      market_id: BRAZIL_MARKET_ID,
    }, { signal: expect.any(AbortSignal) });
  });

  it('shows no cost note after a fresh search', async () => {
    renderExplorer();
    await searchAndWaitForRows('boutique hotel');

    expect(screen.queryByText(/search cost/i)).not.toBeInTheDocument();
  });

  it('shows the cache note when the research came from cache', async () => {
    vi.mocked(researchKeywords).mockResolvedValue(buildResearchResponse({ cached: true }));
    renderExplorer();
    await searchAndWaitForRows('boutique hotel');

    expect(screen.getByText('From cache (refreshes daily)')).toBeInTheDocument();
  });

  it('shows the Google Ads note when the country has no Labs data', async () => {
    vi.mocked(researchKeywords).mockResolvedValue(buildResearchResponse({ data_source: 'google_ads' }));
    renderExplorer();
    await searchAndWaitForRows('boutique hotel');

    expect(screen.getByText('Difficulty and intent are not available for this country')).toBeInTheDocument();
  });

  it('shows the API message when the research fails', async () => {
    vi.mocked(researchKeywords).mockRejectedValue(new UpstreamError('The DataForSEO account balance is too low'));
    renderExplorer();
    await searchFor('boutique hotel');

    expect(await screen.findByRole('alert')).toHaveTextContent('The DataForSEO account balance is too low');
  });
});

describe('KeywordExplorer export', () => {
  it('offers Export all beside the filters and no CSV-only export', async () => {
    renderExplorer();
    await searchAndWaitForRows('boutique hotel');

    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export all' })).toBeEnabled();
  });

  it('exports the researched seed with the default sort from the server cache', async () => {
    renderExplorer();
    await searchAndWaitForRows('boutique hotel');

    await chooseExportFormat('xlsx');

    expect(mockStartExport.mock.lastCall?.[0].params).toStrictEqual({
      clickstream: 'false',
      count: '150',
      direction: 'desc',
      group_keywords: 'false',
      keyword: 'boutique hotel',
      market_id: BRAZIL_MARKET_ID,
      mode: 'auto',
      sort: 'search_volume',
    });
  });

  it('exports with the filters the table applies', async () => {
    renderExplorer();
    const user = await searchAndWaitForRows('boutique hotel');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.type(screen.getByLabelText('Min volume'), '100');
    await user.type(screen.getByLabelText('Include terms'), 'hotel');

    await chooseExportFormat('csv');

    expect(mockStartExport.mock.lastCall?.[0].params).toStrictEqual({
      clickstream: 'false',
      count: '150',
      direction: 'desc',
      group_keywords: 'false',
      include: 'hotel',
      keyword: 'boutique hotel',
      market_id: BRAZIL_MARKET_ID,
      min_volume: '100',
      mode: 'auto',
      sort: 'search_volume',
    });
  });

  it('disables the export when the filters keep no keyword', async () => {
    renderExplorer();
    const user = await searchAndWaitForRows('boutique hotel');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.type(screen.getByLabelText('Include terms'), 'no such term');

    expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled();
  });
});

describe('KeywordExplorer tracking', () => {
  it('creates the selected keywords in the header market and the chosen group', async () => {
    renderExplorer();
    const user = await searchAndWaitForRows('boutique hotel');
    await screen.findByRole('option', { name: 'Lisbon hotel' });
    await user.selectOptions(screen.getByLabelText('Keyword group'), 'group-1');
    await trackKeyword(user, 'boutique hotel');

    await waitFor(() => {
      expect(promoteKeywords).toHaveBeenCalledWith(expect.objectContaining({
        keywords: [expect.objectContaining({ keyword: 'boutique hotel' })],
        marketId: BRAZIL_MARKET_ID,
        groupIds: ['group-1'],
      }));
    });
  });

  it('makes no further paid SEO call after the keywords are tracked', async () => {
    renderExplorer();
    await trackKeyword(await searchAndWaitForRows('boutique hotel'), 'boutique hotel');
    await screen.findByText('1 keyword added');

    expect(researchKeywords).toHaveBeenCalledTimes(1);
    expect(fetchSerp).toHaveBeenCalledTimes(0);
  });
});

describe('KeywordExplorer SERP panel', () => {
  it('loads the top 20 results of a clicked keyword in the header market', async () => {
    await openSerpFor('boutique hotel');

    expect(fetchSerp).toHaveBeenCalledWith({
      keyword: 'boutique hotel',
      depth: 20,
      market_id: BRAZIL_MARKET_ID,
    }, { signal: expect.any(AbortSignal) });
  });

  it('shows the AI Overview badge when the results page has one', async () => {
    await openSerpFor('boutique hotel');

    expect(await screen.findByText('AI Overview shown')).toBeInTheDocument();
  });

  it('requests depth 50 when Load top 50 is pressed', async () => {
    const user = await openSerpFor('boutique hotel');
    await user.click(await screen.findByRole('button', { name: 'Load top 50' }));

    expect(fetchSerp).toHaveBeenLastCalledWith({
      keyword: 'boutique hotel',
      depth: 50,
      market_id: BRAZIL_MARKET_ID,
    }, { signal: expect.any(AbortSignal) });
  });

  it('shows the no-results text when the results page has no organic items', async () => {
    vi.mocked(fetchSerp).mockResolvedValue(buildSerpResponse({ items: [] }));
    await openSerpFor('boutique hotel');

    expect(await screen.findByText('No organic results for this keyword.')).toBeInTheDocument();
  });

  it('renders a result title as plain text when its URL is not http', async () => {
    vi.mocked(fetchSerp).mockResolvedValue(buildSerpResponse({ items: [buildOrganicItem({ url: 'javascript:alert(1)' })] }));
    await openSerpFor('boutique hotel');

    expect(await screen.findByText('Example Air hotels')).not.toHaveAttribute('href');
  });

  it('links a result title to its http URL', async () => {
    await openSerpFor('boutique hotel');

    expect(await screen.findByRole('link', { name: 'Example Air hotels' })).toHaveAttribute('href', 'https://www.example.com/hotels');
  });
});
