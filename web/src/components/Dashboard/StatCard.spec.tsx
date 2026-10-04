import type { ComponentProps } from 'react';
import {
  render, screen 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import { StatCard } from './StatCard';
import { SearchIcon } from '../ui';

function renderStatCard(overrides: Partial<ComponentProps<typeof StatCard>> = {}) {
  return render(<StatCard title="Test" value={5} icon={<SearchIcon />} {...overrides} />);
}

describe('StatCard', () => {
  it('displays title and formatted value', () => {
    renderStatCard({
      title: 'Total Searches',
      value: 1234,
    });

    expect(screen.getByText('Total Searches')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('formats large numbers with locale separators', () => {
    renderStatCard({
      title: 'Citations',
      value: 1000000,
    });

    expect(screen.getByText('1,000,000')).toBeInTheDocument();
  });

  it('renders 0 when value is zero', () => {
    renderStatCard({
      title: 'Empty',
      value: 0,
    });

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders the provided SVG icon component', () => {
    const { container } = renderStatCard();

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('applies blue tone classes when tone prop is "blue"', () => {
    const { container } = renderStatCard({ tone: 'blue' });

    const badge = container.querySelector('.bg-blue-50');
    expect(badge).toBeInTheDocument();
  });

  it('falls back to gray tone classes when tone prop is omitted', () => {
    const { container } = renderStatCard();

    const badge = container.querySelector('.bg-gray-50');
    expect(badge).toBeInTheDocument();
  });
});
