import {
  render, screen 
} from '@testing-library/react';
import {
  describe, it, expect, vi 
} from 'vitest';
import { BrandChart } from './BrandChart';

vi.mock('chart.js', () => ({
  Chart: Object.assign(vi.fn().mockImplementation(() => ({ destroy: vi.fn() })), {register: vi.fn(),}),
  registerables: [],
}));

describe('BrandChart', () => {
  it('displays title', () => {
    render(<BrandChart data={[]} />);
    expect(screen.getByText('Brand Mentions')).toBeInTheDocument();
  });

  it('shows empty state when data is empty', () => {
    render(<BrandChart data={[]} />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.getByText('Run an analysis to see brand stats')).toBeInTheDocument();
  });

  it('hides empty state when data is provided', () => {
    render(<BrandChart data={[{
      brand: 'TestBrand',
      mention_count: 5 
    }]} />);
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
  });
});
