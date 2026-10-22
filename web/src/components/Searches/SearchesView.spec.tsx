import {
  describe, it, expect, vi
} from 'vitest';
import {
  fireEvent, render, screen, waitFor
} from '@testing-library/react';
import { SearchesView } from './SearchesView';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import { lastExportedColumn } from '../../test/excelExportMock';
import {
  answerSearchPages, NEWER_RUN, OLDER_RUN, TWO_SEARCH_PAGES
} from '../../api/searchPages-fixtures';
import { queryLoadOlderSearchesElement } from './SearchesView-fixtures';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../exporters/excelGenerator', () => import('../../test/excelExportMock'));

const mockSearches = [
  {
    keyword: 'hotels',
    provider: 'openai',
    timestamp: '2024-01-01T00:00:00Z',
    response: 'Test response',
    citations: [],
    brand_mentions: [],
  },
];

/** The view over the first page, with the older page answered and "Load older searches" clicked. */
function setupOlderPageLoad() {
  answerSearchPages({ older: [[OLDER_RUN], null] });
  render(<SearchesView searches={[NEWER_RUN]} nextToken="older" />);
  fireEvent.click(screen.getByRole('button', { name: 'Load older searches' }));
}

describe('SearchesView', () => {
  it('renders the keyword table columns when there are no searches', () => {
    render(<SearchesView searches={[]} />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toStrictEqual([
      'Keyword', 'Providers', 'Runs', 'Citations', 'Avg', 'Last Run', 'Details',
    ]);
  });

  it('associates every filter with its searches-specific identity', () => {
    render(<SearchesView searches={mockSearches} />);

    const filters = ['Search Keyword', 'Provider', 'Query Prompt'].map((label) => (
      screen.getByLabelText<HTMLInputElement | HTMLSelectElement>(label)
    ));

    expect(filters.map((filter) => ({
      id: filter.id,
      labelFor: filter.labels?.[0]?.htmlFor,
      name: filter.name,
    }))).toStrictEqual([
      {
        id: 'searches-keyword-filter',
        labelFor: 'searches-keyword-filter',
        name: 'searches-keyword-filter',
      },
      {
        id: 'searches-provider-filter',
        labelFor: 'searches-provider-filter',
        name: 'searches-provider-filter',
      },
      {
        id: 'searches-prompt-filter',
        labelFor: 'searches-prompt-filter',
        name: 'searches-prompt-filter',
      },
    ]);
  });

  it('exposes the page-size selector with a searches-specific identity', () => {
    render(<SearchesView searches={[]} />);

    const selector = screen.getByLabelText<HTMLSelectElement>('Show:');

    expect({
      id: selector.id,
      labelFor: selector.labels?.[0]?.htmlFor,
      name: selector.name,
    }).toStrictEqual({
      id: 'searches-items-per-page',
      labelFor: 'searches-items-per-page',
      name: 'searches-items-per-page',
    });
  });

  it('renders keyword when searches exist', () => {
    render(<SearchesView searches={mockSearches} />);
    expect(screen.getByText('hotels')).toBeInTheDocument();
  });

  it('shows empty state when no searches', () => {
    render(<SearchesView searches={[]} />);
    expect(screen.getByText(/No searches/i)).toBeInTheDocument();
  });

  it('offers no older searches when the first page is the last one', () => {
    render(<SearchesView searches={[NEWER_RUN]} />);

    expect(queryLoadOlderSearchesElement()).not.toBeInTheDocument();
  });

  it('loads the older page the token points at and keeps the first page', async () => {
    setupOlderPageLoad();

    expect(await screen.findByRole('option', { name: 'gemini' })).toBeInTheDocument();
  });

  it('asks for the page after the first one when loading older searches', async () => {
    setupOlderPageLoad();

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/searches?limit=100&next_token=older', expect.anything(),
    ));
  });

  it('hides the button once the last page is loaded', async () => {
    setupOlderPageLoad();

    await waitFor(() => expect(queryLoadOlderSearchesElement()).not.toBeInTheDocument());
  });

  it('exports the runs of every page', async () => {
    answerSearchPages(TWO_SEARCH_PAGES);
    render(<SearchesView searches={[NEWER_RUN]} />);

    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await waitFor(() => expect(lastExportedColumn('Provider')).toStrictEqual([
      'openai', 'gemini',
    ]));
  });
});
