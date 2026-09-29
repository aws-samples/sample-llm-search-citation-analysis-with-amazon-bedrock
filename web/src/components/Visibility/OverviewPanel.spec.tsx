import {
  describe, it, expect
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { OverviewPanel } from './OverviewPanel';

describe('OverviewPanel', () => {
  it('explains the panel in an info tooltip named after its title when info is given', () => {
    render(<OverviewPanel title="Engines" info="Each KPI per AI engine.">content</OverviewPanel>);

    expect(screen.getByRole('button', { name: 'About Engines' })).toHaveAccessibleDescription('Each KPI per AI engine.');
  });

  it('shows no info button when no info is given', () => {
    render(<OverviewPanel title="Headline">content</OverviewPanel>);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
