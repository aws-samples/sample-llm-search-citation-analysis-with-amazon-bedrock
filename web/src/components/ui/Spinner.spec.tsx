import { render } from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('renders with default medium size when no size prop provided', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('h-6', 'w-6');
  });

  it('renders small size when size is sm', () => {
    const { container } = render(<Spinner size="sm" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('h-4', 'w-4');
  });

  it('renders large size when size is lg', () => {
    const { container } = render(<Spinner size="lg" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('h-8', 'w-8');
  });

  it('applies custom className when provided', () => {
    const { container } = render(<Spinner className="text-blue-500" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('text-blue-500');
  });

  it('has aria-hidden attribute for accessibility', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
