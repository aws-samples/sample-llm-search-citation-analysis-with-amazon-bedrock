import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { fetchFirstAppearancesPage } from '../../api/brandMentions';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildAppearanceRow } from '../../api/brandMentions-fixtures';
import { ApiRequestError } from '../../infrastructure';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../test/scopedTestKit';
import {
  GROUP_APPEARANCES_REQUEST, previewedBrand, renderOverview
} from './BrandOverviewTab-fixtures';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));
vi.mock(import('../../api/brandMentions'), async (importOriginal) => ({
  ...await importOriginal(),
  fetchFirstAppearancesPage: vi.fn(),
}));

import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';

const FIRST_PAGE = {
  keyword: null,
  timestamp: null,
  brand: 'Hotel Coruña',
  appearances: ['openai', 'gemini', 'claude'].map((provider) => buildAppearanceRow({
    brand: 'Hotel Coruña',
    provider,
  })),
  total_appearances: 7,
  next_token: 'tok-2',
};
const LAST_PAGE = {
  ...FIRST_PAGE,
  appearances: [buildAppearanceRow({
    brand: 'Hotel Coruña',
    provider: 'perplexity',
  })],
  next_token: null,
};

/** The previewed brand on screen with "Show more appearances" clicked. */
async function setupShowMore() {
  renderOverview(previewedBrand());
  await userEvent.click(screen.getByRole('button', { name: 'Show more appearances' }));
}

/** The "show more" button, or `null` when the tab offers none. */
function queryShowMoreElement() {
  return screen.queryByRole('button', { name: 'Show more appearances' });
}

describe('BrandOverviewTab', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    vi.mocked(fetchFirstAppearancesPage).mockResolvedValue(FIRST_PAGE);
  });

  it('says how many appearances the preview leaves out', () => {
    renderOverview(previewedBrand());

    expect(screen.getByText('Best 2 of 7 appearances.')).toBeInTheDocument();
  });

  it('counts sentiments over every appearance, not only the preview', () => {
    renderOverview(previewedBrand());

    expect(screen.getByText('negative').previousElementSibling).toHaveTextContent('3');
    expect(screen.getByText('negative').nextElementSibling).toHaveTextContent('43%');
  });

  it('reads the first appearance page of the brand when asked for more', async () => {
    await setupShowMore();

    expect(fetchFirstAppearancesPage).toHaveBeenCalledWith({
      ...GROUP_APPEARANCES_REQUEST,
      brand: 'Hotel Coruña',
    }, expect.any(AbortSignal));
  });

  it('lists the first page in place of the preview and says how many are shown', async () => {
    await setupShowMore();

    expect(await screen.findByText('Anthropic Claude')).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 7 appearances')).toBeInTheDocument();
    expect(queryShowMoreElement()).not.toBeInTheDocument();
  });

  it('appends the next page of the brand with its cursor', async () => {
    answerFetchesInOrder([LAST_PAGE, 200]);
    await setupShowMore();

    await clickLoadMore('appearances');

    expect(await screen.findByText('Perplexity')).toBeInTheDocument();
    const { searchParams } = new URL(String(mockAuthenticatedFetch.mock.calls[0][0]));
    expect([searchParams.get('brand'), searchParams.get('view'), searchParams.get('next_token')]).toStrictEqual(['Hotel Coruña', 'appearances', 'tok-2']);
  });

  it('shows the error when the appearances cannot be read', async () => {
    vi.mocked(fetchFirstAppearancesPage).mockRejectedValue(new ApiRequestError('Server error', 500));
    await setupShowMore();

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load brand mentions');
  });

  it('offers no "show more" when the preview already holds every appearance', () => {
    renderOverview(previewedBrand(2));

    expect(queryShowMoreElement()).not.toBeInTheDocument();
  });

  it('offers no "show more" without a request to read them with', () => {
    renderOverview(previewedBrand(), null);

    expect(queryShowMoreElement()).not.toBeInTheDocument();
  });

  it('exports every appearance of the brand in the scope', async () => {
    renderOverview(previewedBrand());

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'brand-appearances',
      params: {
        brand: 'Hotel Coruña',
        group_id: 'group-coruna',
      },
      format: 'xlsx',
    });
  });
});
