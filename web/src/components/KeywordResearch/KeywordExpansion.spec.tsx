import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordExpansion } from './KeywordExpansion';

function buildProps(overrides = {}) {
  return {
    onExpand: vi.fn(),
    loading: false,
    result: null,
    error: null,
    ...overrides,
  };
}

describe('KeywordExpansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial render', () => {
    it('renders seed keyword input', () => {
      render(<KeywordExpansion {...buildProps()} />);

      expect(screen.getByPlaceholderText(/e\.g\., best hotels/i)).toBeInTheDocument();
    });

    it('renders industry selector', () => {
      render(<KeywordExpansion {...buildProps()} />);

      expect(screen.getByText('General')).toBeInTheDocument();
    });

    it('renders expand button', () => {
      render(<KeywordExpansion {...buildProps()} />);

      expect(screen.getByRole('button', { name: /find keywords/i })).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('calls onExpand with input values', async () => {
      const onExpand = vi.fn();
      render(<KeywordExpansion {...buildProps({ onExpand })} />);

      const input = screen.getByPlaceholderText(/e\.g\., best hotels/i);
      await userEvent.type(input, 'hotels');

      const button = screen.getByRole('button', { name: /find keywords/i });
      await userEvent.click(button);

      expect(onExpand).toHaveBeenCalledWith('hotels', 'general', 20);
    });

    it('disables button when loading', () => {
      render(<KeywordExpansion {...buildProps({ loading: true })} />);

      expect(screen.getByRole('button', { name: /expanding/i })).toBeDisabled();
    });

    it('does not call onExpand when seed keyword is empty', async () => {
      const onExpand = vi.fn();
      render(<KeywordExpansion {...buildProps({ onExpand })} />);

      // Button should be disabled when empty
      const button = screen.getByRole('button', { name: /find keywords/i });
      expect(button).toBeDisabled();
    });
  });

  describe('with results', () => {
    it('renders keyword results table', () => {
      render(<KeywordExpansion {...buildProps({
        result: {
          seed_keyword: 'hotels',
          keywords: [
            {
              keyword: 'luxury hotels',
              search_volume: 1000,
              difficulty: 50,
              relevance: 0.9 
            },
          ],
        },
      })} />);

      expect(screen.getByText('luxury hotels')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      render(<KeywordExpansion {...buildProps({ error: 'Failed to expand keywords' })} />);

      expect(screen.getByText('Failed to expand keywords')).toBeInTheDocument();
    });
  });
});
