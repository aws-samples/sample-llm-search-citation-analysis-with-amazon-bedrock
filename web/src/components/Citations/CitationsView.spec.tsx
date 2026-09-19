import {
  describe, it, expect, vi 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { CitationsView } from './CitationsView';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));

const mockCitations = [
  {
    url: 'https://example.com/article1',
    citation_count: 5,
    keywords: ['hotels'],
  },
];

describe('CitationsView', () => {
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
