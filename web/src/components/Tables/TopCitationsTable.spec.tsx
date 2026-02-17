import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { TopCitationsTable } from './TopCitationsTable';
import type { TopUrl } from '../../types';

vi.mock('../../infrastructure', () => ({
  API_BASE_URL: 'https://api.test.com',
  authenticatedFetch: vi.fn(),
}));

function buildCitation(overrides: Partial<TopUrl> = {}): TopUrl {
  return {
    url: 'https://example.com/page',
    citation_count: 5,
    keyword_count: 2,
    ...overrides,
  };
}

describe('TopCitationsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('header', () => {
    it('displays Top Cited URLs title', () => {
      render(<TopCitationsTable citations={[]} />);

      expect(screen.getByText('Top Cited URLs')).toBeInTheDocument();
    });
  });

  describe('with citations', () => {
    it('displays citation URL', () => {
      render(<TopCitationsTable citations={[buildCitation()]} />);

      expect(screen.getByText('https://example.com/page')).toBeInTheDocument();
    });
  });

  describe('table headers', () => {
    it('displays URL column header', () => {
      render(<TopCitationsTable citations={[buildCitation()]} />);

      expect(screen.getByText('URL')).toBeInTheDocument();
    });
  });
});
