import {
  describe, it, expect, vi
} from 'vitest';
import {
  fireEvent, render, screen, waitFor
} from '@testing-library/react';
import { SearchesView } from './SearchesView';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import { exportToExcel } from '../../exporters/excelGenerator';
import {
  answerSearchPages, NEWER_RUN, OLDER_RUN
} from '../../api/searchPages-fixtures';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../exporters/excelGenerator', () => ({ exportToExcel: vi.fn() }));

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

    expect(screen.queryByRole('button', { name: 'Load older searches' })).not.toBeInTheDocument();
  });

  it('loads the older page the token points at and keeps the first page', async () => {
    answerSearchPages({ older: [[OLDER_RUN], null] });
    render(<SearchesView searches={[NEWER_RUN]} nextToken="older" />);

    fireEvent.click(screen.getByRole('button', { name: 'Load older searches' }));

    expect(await screen.findByRole('option', { name: 'gemini' })).toBeInTheDocument();
  });

  it('asks for the page after the first one when loading older searches', async () => {
    answerSearchPages({ older: [[OLDER_RUN], null] });
    render(<SearchesView searches={[NEWER_RUN]} nextToken="older" />);

    fireEvent.click(screen.getByRole('button', { name: 'Load older searches' }));

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/searches?limit=100&next_token=older', expect.anything(),
    ));
  });

  it('hides the button once the last page is loaded', async () => {
    answerSearchPages({ older: [[OLDER_RUN], null] });
    render(<SearchesView searches={[NEWER_RUN]} nextToken="older" />);

    fireEvent.click(screen.getByRole('button', { name: 'Load older searches' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load older searches' })).not.toBeInTheDocument());
  });

  it('exports the runs of every page', async () => {
    answerSearchPages({
      '': [[NEWER_RUN], 'older'],
      older: [[OLDER_RUN], null],
    });
    render(<SearchesView searches={[NEWER_RUN]} />);

    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await waitFor(() => expect(vi.mocked(exportToExcel).mock.lastCall?.[0].data.map((row) => row.Provider)).toStrictEqual([
      'openai', 'gemini',
    ]));
  });
});
