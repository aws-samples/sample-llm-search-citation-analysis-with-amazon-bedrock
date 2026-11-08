import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen, waitFor
} from '@testing-library/react';
import { KeywordDetail } from './KeywordDetail';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import { createMockJsonResponse } from '../../test/fetchResponses';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';
import {
  buildSearch, NEWEST, UNSORTED_RUNS
} from '../../formatting/searchSummary-fixtures';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));
vi.mock('react-chartjs-2', () => ({
  Line: vi.fn(() => null),
  Bar: vi.fn(() => null),
}));

const OLDEST_EXTRA_RUN = buildSearch({
  provider: 'claude',
  timestamp: '2026-01-02T09:00:00Z',
});

/** A whole first batch (500 runs, one per minute on 2026-02-01): the detail offers the older ones. */
const FULL_BATCH = Array.from({ length: 500 }, (_, minute) => buildSearch({ timestamp: new Date(Date.UTC(2026, 1, 1, 0, minute)).toISOString() }));

/** Mounts the detail once the API has answered with the three runs, newest one in the middle. */
async function renderLoadedDetail(): Promise<void> {
  mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
    searches: UNSORTED_RUNS,
    next_token: null,
  }));
  render(<KeywordDetail keyword="altiplano air flights to cusco" onClose={vi.fn()} />);
  await screen.findByText('Run History');
}

/** The value shown next to the `label` stat in the header. */
function getStatValueElement(label: string): Element | null {
  return screen.getByText(`${label}:`).nextElementSibling;
}

describe('KeywordDetail', () => {
  it('shows the newest run as the last run even when it is not first in the response', async () => {
    await renderLoadedDetail();

    expect(getStatValueElement('Last Run')?.textContent).toBe(new Date(NEWEST.timestamp).toLocaleDateString());
  });

  it('summarises the runs, their citations and the average per run', async () => {
    await renderLoadedDetail();

    expect(['Total Runs', 'Citations', 'Avg/Run'].map((label) => getStatValueElement(label)?.textContent))
      .toStrictEqual(['3', '3', '1.0']);
  });

  it('lists the runs newest-first', async () => {
    await renderLoadedDetail();

    expect(screen.getAllByText(/^(openai|perplexity|gemini)$/).map((badge) => badge.textContent))
      .toStrictEqual(['openai', 'perplexity', 'gemini']);
  });

  it('asks for the keyword runs with their answer text', async () => {
    await renderLoadedDetail();

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/searches?keyword=altiplano+air+flights+to+cusco&include_response=true&limit=500',
      expect.anything(),
    );
  });

  it('adds the older runs to the totals on Load older runs', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({
        searches: FULL_BATCH,
        next_token: 'older',
      }))
      .mockResolvedValueOnce(createMockJsonResponse({
        searches: [OLDEST_EXTRA_RUN],
        next_token: null,
      }));
    render(<KeywordDetail keyword="altiplano air flights to cusco" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Load older runs' }));

    await waitFor(() => expect(getStatValueElement('Total Runs')?.textContent).toBe('501'));
  });

  it('offers no Load older runs once every run is read', async () => {
    await renderLoadedDetail();

    expect(screen.queryByRole('button', { name: 'Load older runs' })).toBeNull();
  });

  it('exports every run of the keyword', async () => {
    await renderLoadedDetail();

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'searches',
      params: { keyword: 'altiplano air flights to cusco' },
      format: 'xlsx',
    });
  });
});
