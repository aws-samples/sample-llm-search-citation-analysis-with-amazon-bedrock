import {
  describe, it, expect, vi 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { BrandsView } from './BrandsView';
import { renderedScopeOptionLabels } from '../ui/KeywordScopeSelector-fixtures';

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

vi.mock('../../hooks/useKeywordGroups', async () => {
  const { buildKeywordGroupsHookResult } = await import('../../hooks/useKeywordGroups-fixtures');
  return { useKeywordGroups: vi.fn(() => buildKeywordGroupsHookResult()) };
});

const mockKeywords = [
  {
    id: '1',
    keyword: 'hotels',
    created_at: '2024-01-01' 
  },
];

describe('BrandsView', () => {
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
    expect(renderedScopeOptionLabels()).toStrictEqual(['All keywords', 'Hotel Coruña (1)', 'hotels']);
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
