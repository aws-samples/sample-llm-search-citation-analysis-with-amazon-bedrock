import {
  describe, it, expect 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { SearchesView } from './SearchesView';

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

  it('renders keyword when searches exist', () => {
    render(<SearchesView searches={mockSearches} />);
    expect(screen.getByText('hotels')).toBeInTheDocument();
  });

  it('shows empty state when no searches', () => {
    render(<SearchesView searches={[]} />);
    expect(screen.getByText(/No searches/i)).toBeInTheDocument();
  });
});
