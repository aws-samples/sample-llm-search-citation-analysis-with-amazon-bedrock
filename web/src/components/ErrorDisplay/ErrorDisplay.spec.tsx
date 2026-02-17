import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { ErrorDisplay } from './ErrorDisplay';

vi.mock('../../infrastructure/errors', () => ({
  parseApiError: vi.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : error,
    category: 'unknown' as const,
    recoverable: true,
    suggestion: 'Try again'
  }))
}));

describe('ErrorDisplay', () => {
  it('renders nothing when error is null', () => {
    const { container } = render(<ErrorDisplay error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders inline error by default', () => {
    render(<ErrorDisplay error="Test error" />);
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('renders banner variant', () => {
    render(<ErrorDisplay error="Test error" variant="banner" />);
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('renders card variant', () => {
    render(<ErrorDisplay error="Test error" variant="card" />);
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('calls onRetry when retry button clicked', () => {
    const mockRetry = vi.fn();
    render(<ErrorDisplay error="Test error" onRetry={mockRetry} variant="banner" />);
    
    fireEvent.click(screen.getByText('Retry'));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when dismiss button clicked', () => {
    const mockDismiss = vi.fn();
    render(<ErrorDisplay error="Test error" onDismiss={mockDismiss} variant="banner" />);
    
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('handles Error objects', () => {
    class DisplayTestError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'DisplayTestError';
      }
    }
    const error = new DisplayTestError('Test error object');
    render(<ErrorDisplay error={error} />);
    expect(screen.getByText('Test error object')).toBeInTheDocument();
  });
});