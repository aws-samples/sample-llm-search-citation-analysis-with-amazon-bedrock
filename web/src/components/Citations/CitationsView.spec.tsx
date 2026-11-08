import {
  describe, it, expect, vi 
} from 'vitest';
import {
  render, screen, waitFor
} from '@testing-library/react';
import { CitationsView } from './CitationsView';
import {
  mockAuthenticatedFetch, stallAuthenticatedFetch
} from '../../test/infrastructureMock';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';
import { buildCitationsPage } from '../../hooks/useMarketCitations-fixtures';
import {
  renderCitationsView, setupVideoFilter
} from './CitationsView-fixtures';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

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
    expect(screen.getByRole('button', { name: 'Export all' })).toBeInTheDocument();
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
    stallAuthenticatedFetch();

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

  it('exports every citation of the list with its filters', async () => {
    renderCitationsView();
    await screen.findByText('example.com');
    setupVideoFilter();

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'citations',
      params: { content_type: 'video' },
      format: 'xlsx',
    });
  });

  it('says the figures cover part of the scope when the API hit its read cap', async () => {
    renderCitationsView(buildCitationsPage({ truncated: true }));

    expect(await screen.findByRole('status')).toHaveTextContent(/cover part of it/);
  });
});
