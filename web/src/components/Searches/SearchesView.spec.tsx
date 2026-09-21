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
});
