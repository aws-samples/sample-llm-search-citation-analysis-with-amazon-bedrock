import {
  describe, it, expect, vi 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { CitationsView } from './CitationsView';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));

const mockCitations = [
  {
    url: 'https://example.com/article1',
    citation_count: 5,
    keywords: ['hotels'],
  },
];

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
});
