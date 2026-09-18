import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { BrandsView } from './BrandsView';

vi.mock('../../hooks/useBrandMentions', () => ({
  useBrandMentions: vi.fn(() => ({
    data: null,
    loading: false,
    error: null,
    fetchBrandMentions: vi.fn(),
  })),
}));

vi.mock('../../hooks/useBrandConfig', () => ({
  useBrandConfig: vi.fn(() => ({
    config: null,
    loading: false,
  })),
}));

vi.mock('../../hooks/useKeywordGroups', () => ({
  useKeywordGroups: vi.fn(() => ({
    groups: [{
      id: 'group-coruna',
      name: 'Hotel Coruña',
      description: '',
      keyword_count: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }],
    loading: false,
    error: null,
    refresh: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    removeGroup: vi.fn(),
    changeMemberships: vi.fn(),
  })),
}));

const mockKeywords = [
  {
    id: '1',
    keyword: 'hotels',
    created_at: '2024-01-01' 
  },
];

describe('BrandsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<BrandsView keywords={[]} />);
    expect(document.body).toBeTruthy();
  });

  it('renders the scope panel title', () => {
    render(<BrandsView keywords={mockKeywords} />);
    expect(screen.getByText('What to look at')).toBeInTheDocument();
  });

  it('offers the keyword, its group and all keywords as scopes', () => {
    render(<BrandsView keywords={mockKeywords} />);
    expect(screen.getByRole('option', { name: 'hotels' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Hotel Coruña (1)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All keywords' })).toBeInTheDocument();
  });

  it('asks to pick a scope before showing mentions', () => {
    render(<BrandsView keywords={mockKeywords} />);
    expect(screen.getByText('Pick a scope above to view brand mentions')).toBeInTheDocument();
  });

  it('shows no keywords message when empty', () => {
    render(<BrandsView keywords={[]} />);
    expect(screen.getByText(/No keywords available/)).toBeInTheDocument();
  });
});
