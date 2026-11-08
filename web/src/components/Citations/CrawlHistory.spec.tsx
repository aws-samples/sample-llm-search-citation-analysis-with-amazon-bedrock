import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { fetchCrawlHistory } from '../../api/dashboard';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';
import { CitationDetailModal } from './CitationDetailModal';
import { buildCrawledContent } from './CitationDetailModal-fixtures';

vi.mock('../../api/dashboard', () => ({ fetchCrawlHistory: vi.fn() }));
vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

const mockFetchCrawlHistory = vi.mocked(fetchCrawlHistory);

const NEWER = buildCrawledContent({
  crawled_at: '2026-03-02T10:00:00Z',
  summary: 'Newer crawl',
});
const OLDER = buildCrawledContent({
  crawled_at: '2026-01-02T10:00:00Z',
  summary: 'Older crawl',
});

describe('Citation crawl history', () => {
  it('appends the older crawls of the next page on Load older crawls', async () => {
    mockFetchCrawlHistory
      .mockResolvedValueOnce({
        items: [NEWER],
        nextToken: 'tok-2',
      })
      .mockResolvedValueOnce({
        items: [OLDER],
        nextToken: null,
      });
    render(<CitationDetailModal citation={buildCrawledContent()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Load older crawls' }));

    expect(await screen.findByText('Older crawl')).toBeInTheDocument();
  });

  it('asks the next page with the token of the first', async () => {
    mockFetchCrawlHistory
      .mockResolvedValueOnce({
        items: [NEWER],
        nextToken: 'tok-2',
      })
      .mockResolvedValueOnce({
        items: [OLDER],
        nextToken: null,
      });
    render(<CitationDetailModal citation={buildCrawledContent()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load older crawls' }));
    await screen.findByText('Older crawl');

    expect(mockFetchCrawlHistory).toHaveBeenLastCalledWith('example.com/rooms', 'tok-2');
  });

  it('offers no Load older crawls on the last page', async () => {
    mockFetchCrawlHistory.mockResolvedValueOnce({
      items: [NEWER],
      nextToken: null,
    });
    render(<CitationDetailModal citation={buildCrawledContent()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    await screen.findByText('Newer crawl');

    expect(screen.queryByRole('button', { name: 'Load older crawls' })).toBeNull();
  });

  it('exports every crawl of the page', async () => {
    mockFetchCrawlHistory.mockResolvedValueOnce({
      items: [NEWER],
      nextToken: 'tok-2',
    });
    render(<CitationDetailModal citation={buildCrawledContent()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    await screen.findByText('Newer crawl');

    await chooseExportFormat('csv');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'crawl-history',
      params: { url: 'example.com/rooms' },
      format: 'csv',
    });
  });
});
