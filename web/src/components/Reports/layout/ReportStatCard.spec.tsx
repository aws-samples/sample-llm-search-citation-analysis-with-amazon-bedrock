import {
  describe, expect, it
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { ReportStatCard } from './ReportStatCard';

describe('ReportStatCard', () => {
  it('writes a plain figure in the neutral colour', () => {
    render(<ReportStatCard label="Keywords" value={12} />);

    expect(screen.getByText('12')).toHaveClass('text-gray-900');
  });

  it('adds no footnote or tooltip when none is given', () => {
    const { container } = render(<ReportStatCard label="Keywords" value={12} />);

    expect([container.querySelectorAll('p').length, screen.queryByRole('button')]).toStrictEqual([2, null]);
  });

  it('explains the figure in a tooltip when told how it is measured', () => {
    render(<ReportStatCard label="Citation rate" value="60.0%" info="Share of keywords mentioning the hotel." />);

    expect(screen.getByRole('button', { name: 'About Citation rate' })).toHaveAccessibleDescription('Share of keywords mentioning the hotel.');
  });

  it('shows the footnote under the figure', () => {
    render(<ReportStatCard label="Citation rate" value="60.0%" footnote="+5.0 pts" />);

    expect(screen.getByText('+5.0 pts')).toBeInTheDocument();
  });
});
