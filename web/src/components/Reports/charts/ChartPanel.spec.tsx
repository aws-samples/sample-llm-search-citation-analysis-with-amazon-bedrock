import type { ComponentProps } from 'react';
import {
  render, screen
} from '@testing-library/react';
import {
  describe, expect, it
} from 'vitest';
import { ChartPanel } from './ChartPanel';

/** A panel around a placeholder chart, titled "Top sources" unless `props` say otherwise. */
function renderPanel(props: Partial<Omit<ComponentProps<typeof ChartPanel>, 'children'>> = {}) {
  return render(<ChartPanel title="Top sources" {...props}><p>chart</p></ChartPanel>);
}

describe('ChartPanel', () => {
  it('names its region after the title', () => {
    renderPanel({ title: 'Share of voice' });

    expect(screen.getByRole('region', { name: 'Share of voice' })).toHaveTextContent('chart');
  });

  it('explains the chart behind an info button when given an explanation', () => {
    renderPanel({
      title: 'Share of voice',
      info: 'Your share of all brand mentions.',
    });

    expect(screen.getByRole('button', { name: 'About Share of voice' })).toHaveAccessibleDescription('Your share of all brand mentions.');
  });

  it('shows no info button without an explanation', () => {
    renderPanel();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the subtitle in its own paragraph under the title', () => {
    renderPanel({ subtitle: 'Most cited domains first.' });

    expect(screen.getByText('Most cited domains first.')).toBeInstanceOf(HTMLParagraphElement);
  });

  it('writes no stray space into the panel classes when the caller adds none', () => {
    renderPanel();

    expect(screen.getByRole('region').getAttribute('class')).not.toMatch(/\s$/);
  });

  it('keeps the panel on one printed page and adds the caller\'s classes', () => {
    renderPanel({ className: 'lg:col-span-2' });

    expect(screen.getByRole('region')).toHaveClass('avoid-break-inside', 'lg:col-span-2');
  });
});
