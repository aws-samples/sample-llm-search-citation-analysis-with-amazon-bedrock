import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { CitationsView } from './CitationsView';

vi.mock('../../infrastructure', () => ({
  API_BASE_URL: 'https://api.test.com',
  authenticatedFetch: vi.fn(),
}));

const mockCitations = [
  {
    url: 'https://example.com/article1',
    citation_count: 5,
    keywords: ['hotels'],
  },
];

describe('CitationsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<CitationsView citations={[]} />);
    expect(document.body).toBeTruthy();
  });

  it('renders export button', () => {
    render(<CitationsView citations={mockCitations} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('renders citation domain', () => {
    render(<CitationsView citations={mockCitations} />);
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });
});
