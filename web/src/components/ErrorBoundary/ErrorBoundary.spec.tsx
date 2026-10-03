import type { ComponentProps } from 'react';
import {
  render, screen, fireEvent 
} from '@testing-library/react';
import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import {
  TestError, ThrowingComponent
} from './ErrorBoundary-fixtures';

/** Mounts a boundary around a child that throws `Test error message` on render. */
function renderThrowingChild(boundaryProps: Omit<ComponentProps<typeof ErrorBoundary>, 'children'> = {}) {
  return render(
    <ErrorBoundary {...boundaryProps}>
      <ThrowingComponent shouldThrow={true} />
    </ErrorBoundary>
  );
}

describe('ErrorBoundary', () => {
  // Suppress console.error for expected errors in tests
  const originalError = console.error;
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());
  });
  afterEach(() => {
    console.error = originalError;
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Normal content</div>
      </ErrorBoundary>
    );
    
    expect(screen.getByText('Normal content')).toBeInTheDocument();
  });

  it('renders default error UI when child throws', () => {
    renderThrowingChild();
    
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('renders custom fallback when provided and child throws', () => {
    renderThrowingChild({ fallback: <div>Custom error fallback</div> });
    
    expect(screen.getByText('Custom error fallback')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('calls onError callback when child throws', () => {
    const onError = vi.fn();
    renderThrowingChild({ onError });
    
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TestError);
    expect((onError.mock.calls[0][0] as TestError).message).toBe('Test error message');
  });

  it('attempts to re-render children when Try Again button clicked', () => {
    const shouldThrowRef = { current: true };
    const ConditionalThrower = () => {
      if (shouldThrowRef.current) {
        throw new TestError('Test error');
      }
      return <div>Recovered content</div>;
    };

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>
    );
    
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    
    // Stop throwing before clicking retry
    shouldThrowRef.current = false;
    fireEvent.click(screen.getByText('Try Again'));
    
    expect(screen.getByText('Recovered content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('displays error message in UI when error has message', () => {
    renderThrowingChild();
    
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });
});
