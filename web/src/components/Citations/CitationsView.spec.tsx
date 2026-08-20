import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { CitationsView } from './CitationsView';

// The barrel is stubbed to keep config/auth side effects out of the test;
// urlSafety is pure, so its real exports are spread in unchanged.
vi.mock('../../infrastructure', async () => ({
  API_BASE_URL: 'https://api.test.com',
  authenticatedFetch: vi.fn(),
  ...(await vi.importActual<typeof import('../../infrastructure/urlSafety')>(
    '../../infrastructure/urlSafety'
  )),
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
