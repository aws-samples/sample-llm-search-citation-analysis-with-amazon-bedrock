import {
  describe, it, expect, vi 
} from 'vitest';
import {
  fireEvent, render, screen, waitFor
} from '@testing-library/react';
import { CitationsView } from './CitationsView';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import { exportToExcel } from '../../exporters/excelGenerator';
import {
  answerTwoCitationPages, buildCitationsPage, FIRST_OF_TWO, SECOND_OF_TWO
} from '../../hooks/useMarketCitations-fixtures';
import {
  ARTICLE_PAGE, renderCitationsView, setupVideoFilter
} from './CitationsView-fixtures';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../exporters/excelGenerator', () => ({ exportToExcel: vi.fn() }));

describe('CitationsView', () => {
  it('shows the empty state when the API has no citations', async () => {
    renderCitationsView(buildCitationsPage({
      top_urls: [],
      total_urls: 0,
      matched_urls: 0,
    }));

    expect(await screen.findByText('No citations yet')).toBeInTheDocument();
  });

  it('renders export button', () => {
    renderCitationsView();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('summarises the scope URL count, citation total and citations per URL from the API totals', async () => {
    renderCitationsView();

    await screen.findByText('example.com');
    const statCards = [...(screen.getByText('Total URLs').parentElement?.parentElement?.children ?? [])];

    expect(statCards.map((card) => card.textContent)).toStrictEqual(['Total URLs2', 'Citations7', 'Avg/URL3.5']);
  });

  it('renders the domain of each citation on the page', async () => {
    renderCitationsView();

    expect(await screen.findByText('example.com')).toBeInTheDocument();
  });

  it('shows the placeholder rows until the first page arrives', () => {
    mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));

    render(<CitationsView placeholder={[{
      url: 'https://placeholder.example/x',
      citation_count: 1,
    }]} />);

    expect(screen.getByText('placeholder.example')).toBeInTheDocument();
  });

  it('asks the API for videos only when the Type filter is set to videos', async () => {
    renderCitationsView();
    setupVideoFilter();

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/citations?content_type=video&limit=25&offset=0', expect.anything(),
    ));
  });

  it('reports that no citation matches when the filtered page is empty', async () => {
    renderCitationsView(buildCitationsPage({
      top_urls: [],
      matched_urls: 0,
    }));
    setupVideoFilter();

    expect(await screen.findByText('No citations match your filters')).toBeInTheDocument();
  });

  it('exports every page of the list with its keyword texts', async () => {
    renderCitationsView(ARTICLE_PAGE);
    await screen.findByText('example.com');
    answerTwoCitationPages();

    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await waitFor(() => expect(vi.mocked(exportToExcel).mock.lastCall?.[0].data.map((row) => row.URL)).toStrictEqual([
      FIRST_OF_TWO.url, SECOND_OF_TWO.url,
    ]));
  });

  it('asks for the keyword texts when exporting', async () => {
    renderCitationsView(ARTICLE_PAGE);
    await screen.findByText('example.com');
    answerTwoCitationPages();

    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(
      'https://api.test.com/citations?limit=1000&include_keywords=true', expect.anything(),
    ));
  });
});
