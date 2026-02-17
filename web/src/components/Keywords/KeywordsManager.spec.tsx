import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { KeywordsManager } from './KeywordsManager';

vi.mock('../../infrastructure', () => ({
  API_BASE_URL: 'https://api.test.com',
  authenticatedFetch: vi.fn(),
}));

const mockKeywords = [
  {
    id: '1',
    keyword: 'hotels',
    created_at: '2024-01-01',
    enabled: true 
  },
];

describe('KeywordsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<KeywordsManager keywords={[]} setKeywords={vi.fn()} />);
    expect(document.body).toBeTruthy();
  });

  it('renders keyword when keywords exist', () => {
    render(<KeywordsManager keywords={mockKeywords} setKeywords={vi.fn()} />);
    expect(screen.getByText('hotels')).toBeInTheDocument();
  });

  it('shows empty state when no keywords', () => {
    render(<KeywordsManager keywords={[]} setKeywords={vi.fn()} />);
    expect(screen.getByText(/No keywords/i)).toBeInTheDocument();
  });

  it('renders add keyword input', () => {
    render(<KeywordsManager keywords={[]} setKeywords={vi.fn()} />);
    expect(screen.getByPlaceholderText(/keyword/i)).toBeInTheDocument();
  });
});
