import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it
} from 'vitest';
import { ChartPanel } from './ChartPanel';

describe('ChartPanel', () => {
  it('names its region after the title', () => {
    render(<ChartPanel title="Share of voice"><p>chart</p></ChartPanel>);

    expect(screen.getByRole('region', { name: 'Share of voice' })).toHaveTextContent('chart');
  });

  it('explains the chart behind an info button when given an explanation', () => {
    render(<ChartPanel title="Share of voice" info="Your share of all brand mentions."><p>chart</p></ChartPanel>);

    expect(screen.getByRole('button', { name: 'About Share of voice' })).toHaveAccessibleDescription('Your share of all brand mentions.');
  });

  it('shows no info button without an explanation', () => {
    render(<ChartPanel title="Top sources"><p>chart</p></ChartPanel>);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the subtitle in its own paragraph under the title', () => {
    render(<ChartPanel title="Top sources" subtitle="Most cited domains first."><p>chart</p></ChartPanel>);

    expect(screen.getByText('Most cited domains first.')).toBeInstanceOf(HTMLParagraphElement);
  });

  it('writes no stray space into the panel classes when the caller adds none', () => {
    render(<ChartPanel title="Top sources"><p>chart</p></ChartPanel>);

    expect(screen.getByRole('region').getAttribute('class')).not.toMatch(/\s$/);
  });

  it('keeps the panel on one printed page and adds the caller\'s classes', () => {
    render(<ChartPanel title="Top sources" className="lg:col-span-2"><p>chart</p></ChartPanel>);

    expect(screen.getByRole('region')).toHaveClass('avoid-break-inside', 'lg:col-span-2');
  });
});
