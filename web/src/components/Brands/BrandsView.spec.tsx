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

  it('renders keyword selector title', () => {
    render(<BrandsView keywords={mockKeywords} />);
    expect(screen.getByText('Select a Keyword')).toBeInTheDocument();
  });

  it('renders keyword button', () => {
    render(<BrandsView keywords={mockKeywords} />);
    expect(screen.getByText('hotels')).toBeInTheDocument();
  });

  it('shows no keywords message when empty', () => {
    render(<BrandsView keywords={[]} />);
    expect(screen.getByText(/No keywords available/)).toBeInTheDocument();
  });
});
