import type { ComponentProps } from 'react';
import {
  render, screen 
} from '@testing-library/react';
import {
  describe, it, expect 
} from 'vitest';
import {
  APPROXIMATE_COUNT_NOTE, StatCard
} from './StatCard';
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

  it.each(['blue', 'violet', 'emerald', 'amber', undefined] as const)('draws the %s tone as the neutral icon badge', (tone) => {
    const { container } = renderStatCard(tone === undefined ? {} : { tone });

    expect(container.querySelector('.bg-gray-100.text-gray-600')).toBeInTheDocument();
  });

  it('prefixes an approximate value with ≈', () => {
    renderStatCard({
      value: 1234,
      approximate: true,
    });

    expect(screen.getByTitle(APPROXIMATE_COUNT_NOTE)).toHaveTextContent(`≈ ${APPROXIMATE_COUNT_NOTE} 1,234`);
  });

  it('hides the ≈ sign from screen readers and reads the explanation instead', () => {
    renderStatCard({ approximate: true });

    expect(screen.getByText('≈')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(APPROXIMATE_COUNT_NOTE)).toHaveClass('sr-only');
  });

  it('shows an exact value without ≈ or explanation', () => {
    renderStatCard({ value: 1234 });

    expect(screen.getByText('1,234')).not.toHaveAttribute('title');
    expect(screen.queryByText('≈')).not.toBeInTheDocument();
  });
});
