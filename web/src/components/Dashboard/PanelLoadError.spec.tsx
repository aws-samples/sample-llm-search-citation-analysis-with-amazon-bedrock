import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, render, screen
} from '@testing-library/react';
import { PanelLoadError } from './PanelLoadError';
import {
  IDLE_PANEL_STATES, type DashboardPanelStates
} from '../../hooks/dashboardPanels';

const citationsTimedOut: DashboardPanelStates = {
  ...IDLE_PANEL_STATES,
  citations: {
    error: 'Request timed out',
    retrying: false,
  },
};

const citationsRetrying: DashboardPanelStates = {
  ...IDLE_PANEL_STATES,
  citations: {
    error: 'Request timed out',
    retrying: true,
  },
};

describe('PanelLoadError', () => {
  it('renders nothing when the panel loaded', () => {
    const { container } = render(<PanelLoadError panel="citations" panels={IDLE_PANEL_STATES} onRetry={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('names the panel and the reason when the panel failed', () => {
    render(<PanelLoadError panel="citations" panels={citationsTimedOut} onRetry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Citation and brand charts did not load: Request timed out.');
  });

  it('retries the failed panel when Retry is clicked', () => {
    const onRetry = vi.fn();
    render(<PanelLoadError panel="citations" panels={citationsTimedOut} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledWith('citations');
  });

  it('disables the button and says Retrying while the retry runs', () => {
    render(<PanelLoadError panel="citations" panels={citationsRetrying} onRetry={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });

  it('shows nothing for a panel other than the one that failed', () => {
    const { container } = render(<PanelLoadError panel="stats" panels={citationsTimedOut} onRetry={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
