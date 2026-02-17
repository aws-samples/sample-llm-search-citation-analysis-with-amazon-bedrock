import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { RecentSearchesTable } from './RecentSearchesTable';
import type { Search } from '../../types';

vi.mock('../Keywords/KeywordDetail', () => ({KeywordDetail: () => <div data-testid="keyword-detail">Keyword Detail</div>,}));

function buildSearch(overrides: Partial<Search> = {}): Search {
  const search: Search = {
    keyword: 'hotels',
    provider: 'openai',
    timestamp: '2024-01-15T10:30:00Z',
    citations: ['https://example.com'],
    ...overrides,
  };
  return search;
}

describe('RecentSearchesTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('header', () => {
    it('displays Recent Searches title', () => {
      render(<RecentSearchesTable searches={[]} />);

      expect(screen.getByText('Recent Searches')).toBeInTheDocument();
    });
  });

  describe('with searches', () => {
    it('displays keyword from search', () => {
      render(<RecentSearchesTable searches={[buildSearch()]} />);

      expect(screen.getByText('hotels')).toBeInTheDocument();
    });

    it('groups searches by keyword', () => {
      const searches = [
        buildSearch({
          keyword: 'hotels',
          provider: 'openai' 
        }),
        buildSearch({
          keyword: 'hotels',
          provider: 'perplexity' 
        }),
        buildSearch({
          keyword: 'resorts',
          provider: 'openai' 
        }),
      ];
      render(<RecentSearchesTable searches={searches} />);

      expect(screen.getByText('hotels')).toBeInTheDocument();
      expect(screen.getByText('resorts')).toBeInTheDocument();
    });
  });

  describe('table headers', () => {
    it('displays Keyword column header', () => {
      render(<RecentSearchesTable searches={[buildSearch()]} />);

      expect(screen.getByText('Keyword')).toBeInTheDocument();
    });
  });
});
