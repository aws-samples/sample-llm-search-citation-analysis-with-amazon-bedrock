import {
  describe, it, expect, vi 
} from 'vitest';
import {
  fireEvent, render, screen 
} from '@testing-library/react';
import { CitationsView } from './CitationsView';
import type { TopUrl } from '../../types';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));

const mockCitations = [
  {
    url: 'https://example.com/article1',
    citation_count: 5,
    keywords: ['hotels'],
  },
];

/** Renders the view over `citations` and sets its Type filter to videos. */
function renderFilteredToVideos(citations: TopUrl[]) {
  render(<CitationsView citations={citations} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'video' } });
}

describe('CitationsView', () => {
  it('shows the empty state when there are no citations', () => {
    render(<CitationsView citations={[]} />);
    expect(screen.getByText('No citations yet')).toBeInTheDocument();
  });

  it('renders export button', () => {
    render(<CitationsView citations={mockCitations} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('summarises the URL count, the citation total and the citations per URL', () => {
    render(<CitationsView citations={[...mockCitations, {
      url: 'https://example.org/guide',
      citation_count: 2,
      keywords: ['hotels'],
    }]} />);

    const statCards = [...(screen.getByText('Total URLs').parentElement?.parentElement?.children ?? [])];

    expect(statCards.map((card) => card.textContent)).toStrictEqual(['Total URLs2', 'Citations7', 'Avg/URL3.5']);
  });

  it('renders citation domain', () => {
    render(<CitationsView citations={mockCitations} />);
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('lists only the video citations when the Type filter is set to videos', () => {
    renderFilteredToVideos([...mockCitations, {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      citation_count: 1,
      content_type: 'video',
    }]);

    expect(screen.queryByText('example.com')).not.toBeInTheDocument();
    expect(screen.getByText('www.youtube.com')).toBeInTheDocument();
  });

  it('reports that no citation matches when the Type filter excludes them all', () => {
    renderFilteredToVideos(mockCitations);

    expect(screen.getByText('No citations match your filters')).toBeInTheDocument();
  });
});
