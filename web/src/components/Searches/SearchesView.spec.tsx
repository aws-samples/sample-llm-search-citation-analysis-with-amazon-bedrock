import {
  describe, it, expect, vi
} from 'vitest';
import {
  fireEvent, render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchesView } from './SearchesView';
import { labelledFieldIdentity } from '../../test/fieldIdentity';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';
import {
  answerSearchPages, NEWER_RUN, OLDER_RUN
} from '../../api/searchPages-fixtures';
import {
  buildKeywordRuns, queryLoadMoreElement, shownKeywordRows
} from './SearchesView-fixtures';
import {
  installIntersectionObserverMock, scrollSentinelIntoView
} from '../../test/intersectionObserverMock';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

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

/** The view over the first page, with the older page answered and the end of the list scrolled into view. */
function setupOlderPageLoad() {
  installIntersectionObserverMock();
  answerSearchPages({ older: [[OLDER_RUN], null] });
  render(<SearchesView searches={[NEWER_RUN]} nextToken="older" />);
  scrollSentinelIntoView();
}

describe('SearchesView', () => {
  it('renders the keyword table columns when there are no searches', () => {
    render(<SearchesView searches={[]} />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toStrictEqual([
      'Keyword', 'Providers', 'Runs', 'Citations', 'Avg / run', 'Last Run', 'Details',
    ]);
  });

  it('associates every filter with its searches-specific identity', () => {
    render(<SearchesView searches={mockSearches} />);

    expect(['Search Keyword', 'Provider', 'Query Prompt'].map(labelledFieldIdentity)).toStrictEqual([
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

  it('shows the first 25 keywords, then the next ones once the end of the list scrolls into view', () => {
    installIntersectionObserverMock();
    render(<SearchesView searches={buildKeywordRuns(30)} />);
    const before = shownKeywordRows().length;

    scrollSentinelIntoView();

    expect([before, shownKeywordRows().length, screen.getByText('All 30 keywords are shown.')]).toStrictEqual([25, 30, expect.anything()]);
  });

  it('shows the next keywords when "Load more" is pressed', () => {
    render(<SearchesView searches={buildKeywordRuns(30)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(shownKeywordRows()).toHaveLength(30);
  });

  it('renders keyword when searches exist', () => {
    render(<SearchesView searches={mockSearches} />);
    expect(screen.getByText('hotels')).toBeInTheDocument();
  });

  it('opens the keyword detail, which loads its runs, when Enter is pressed on the keyword', async () => {
    render(<SearchesView searches={mockSearches} />);

    screen.getByRole('button', { name: 'hotels' }).focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      expect.stringContaining('keyword=hotels'), expect.anything(),
    ));
  });

  it('shows empty state when no searches', () => {
    render(<SearchesView searches={[]} />);
    expect(screen.getByText(/No searches/i)).toBeInTheDocument();
  });

  it('offers no older searches when the first page is the last one', () => {
    render(<SearchesView searches={[NEWER_RUN]} />);

    expect(queryLoadMoreElement()).not.toBeInTheDocument();
  });

  it('loads the older page the token points at and keeps the first page', async () => {
    setupOlderPageLoad();

    expect(await screen.findByRole('option', { name: 'Google Gemini' })).toBeInTheDocument();
  });

  it('asks for the page after the first one when loading older searches', async () => {
    setupOlderPageLoad();

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/searches?limit=100&next_token=older', expect.anything(),
    ));
  });

  it('hides the button once the last page is loaded', async () => {
    setupOlderPageLoad();

    await waitFor(() => expect(queryLoadMoreElement()).not.toBeInTheDocument());
  });

  it('exports every run with the keyword text, provider and prompt filters', async () => {
    render(<SearchesView searches={mockSearches} />);
    fireEvent.change(screen.getByLabelText('Search Keyword'), { target: { value: ' hot ' } });
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'searches',
      params: {
        keyword_contains: 'hot',
        provider: 'openai',
      },
      format: 'xlsx',
    });
  });

  it('exports every run when no filter is set', async () => {
    render(<SearchesView searches={mockSearches} />);

    await chooseExportFormat('csv');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'searches',
      params: {},
      format: 'csv',
    });
  });
});
