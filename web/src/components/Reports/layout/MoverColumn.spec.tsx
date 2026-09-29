import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { MoverColumn } from './MoverColumn';

describe('MoverColumn', () => {
  it('lists each keyword with its visibility score and its change in points', () => {
    render(
      <MoverColumn
        title="Wins"
        accent="positive"
        rows={[{
          keyword: 'best running shoes',
          visibility_score: 61.25,
          change: 8,
        }]}
        emptyMessage="None"
      />,
    );

    expect(screen.getByRole('listitem')).toHaveTextContent('best running shoesScore 61.3+8.0 pts');
  });

  it('writes a fall without a plus sign, in the negative colour', () => {
    render(
      <MoverColumn
        title="Gaps"
        accent="negative"
        rows={[{
          keyword: 'best hiking boots',
          visibility_score: 30,
          change: -10,
        }]}
        emptyMessage="None"
      />,
    );

    expect(screen.getByText('-10.0 pts')).toHaveClass('text-red-700');
  });

  it('shows an unknown visibility score as a dash', () => {
    render(
      <MoverColumn
        title="Gaps"
        accent="negative"
        rows={[{
          keyword: 'k',
          visibility_score: null,
          change: -3,
        }]}
        emptyMessage="None"
      />,
    );

    expect(screen.getByText('Score —')).toBeInTheDocument();
  });

  it('says so instead of a list when no keyword moved this way', () => {
    render(<MoverColumn title="Wins" accent="positive" rows={[]} emptyMessage="No keyword improved." />);

    expect(screen.getByText('No keyword improved.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
