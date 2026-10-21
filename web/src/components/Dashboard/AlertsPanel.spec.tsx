import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatDate } from '../../formatting/dateFormatter';
import { buildAlertItem } from '../../types/domain/alerts-fixtures';
import { AlertsPanel } from './AlertsPanel';
import {
  buildAlertsPanelHookResult, buildAlertsPanelMembership, buildOpenAlertsOfRuns
} from './AlertsPanel-fixtures';
import { renderWithMarketSelection } from '../Markets/markets-fixtures';

vi.mock('../../hooks/useAlerts', () => ({ useOpenAlerts: vi.fn() }));
vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: vi.fn() }));

import { useOpenAlerts } from '../../hooks/useAlerts';
import { useIsAdmin } from '../../hooks/useIsAdmin';

const mockUseOpenAlerts = vi.mocked(useOpenAlerts);
const mockUseIsAdmin = vi.mocked(useIsAdmin);

beforeEach(() => {
  mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult());
  mockUseIsAdmin.mockReturnValue(buildAlertsPanelMembership());
});

async function renderPanelAndClick(buttonName: string) {
  render(<AlertsPanel />);
  await userEvent.click(screen.getByRole('button', { name: buttonName }));
}

describe('AlertsPanel', () => {
  it('shows the alert row skeleton while the first request is pending', () => {
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({
      items: [],
      count: 0,
      loading: true,
    }));

    render(<AlertsPanel />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading alerts');
  });

  it('shows the empty state when no open alerts exist', () => {
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({
      items: [],
      count: 0,
    }));

    render(<AlertsPanel />);

    expect(screen.getByText('0 open alerts')).toBeInTheDocument();
    expect(screen.getByText('No open alerts.')).toBeInTheDocument();
  });

  it('shows the exact group, message, and open count for an alert', () => {
    const alertItem = buildAlertItem();
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({
      items: [alertItem],
      count: 3,
    }));

    render(<AlertsPanel />);

    expect(screen.getByText('3 open alerts')).toBeInTheDocument();
    expect(screen.getByText('Group One')).toBeInTheDocument();
    expect(screen.getByText('Mention rate fell by 12.0 points.')).toBeInTheDocument();
  });

  it('labels an alert raised on the former citation rate as a keyword-coverage drop', () => {
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({ items: [buildAlertItem({ type: 'citation_rate_drop' })] }));

    render(<AlertsPanel />);

    expect(screen.getByText('Keyword-coverage drop (before 2.21)')).toBeInTheDocument();
  });

  it('shows severity, type, metric change, and timestamp details', () => {
    const alertItem = buildAlertItem();
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({ items: [alertItem] }));

    render(<AlertsPanel />);

    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Mention-rate drop')).toBeInTheDocument();
    expect(screen.getByLabelText('Metric change')).toHaveTextContent(/Previous:\s*64.*Current:\s*52/);
    expect(screen.getByText(formatDate(alertItem.run_timestamp))).toHaveAttribute('datetime', alertItem.run_timestamp);
  });

  it('preserves the newest-first order returned by the API', () => {
    const newest = buildAlertItem({
      id: 'alert-newest',
      message: 'Newest alert message.',
    });
    const older = buildAlertItem({
      id: 'alert-older',
      message: 'Older alert message.',
    });
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({
      items: [newest, older],
      count: 2,
    }));

    render(<AlertsPanel />);

    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toStrictEqual([
      expect.stringContaining('Newest alert message.'),
      expect.stringContaining('Older alert message.'),
    ]);
  });

  it('acknowledges the selected alert when an admin activates the action', async () => {
    const acknowledge = vi.fn().mockResolvedValue({
      success: true,
      message: 'Alert acknowledged.',
    });
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({ acknowledge }));

    await renderPanelAndClick('Acknowledge');

    expect(acknowledge).toHaveBeenCalledWith('alert-d9c3a09f6c91aeb393b663030c383310');
  });

  it('does not show acknowledge actions to non-admin users', () => {
    mockUseIsAdmin.mockReturnValue(buildAlertsPanelMembership({ isAdmin: false }));

    render(<AlertsPanel />);

    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
  });

  it('requests a manual refresh when refresh is activated', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({ refresh }));

    await renderPanelAndClick('Refresh');

    expect(refresh).toHaveBeenCalledWith();
  });

  it('announces the exact loading failure', () => {
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({
      items: [],
      count: 0,
      error: 'Failed to process alert request',
    }));

    render(<AlertsPanel />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to process alert request');
  });
});

describe('AlertsPanel markets', () => {
  it('names the market of an alert raised in one', () => {
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({ items: [buildAlertItem({ market_id: 'cl-es' })] }));

    renderWithMarketSelection(<AlertsPanel />);

    expect(screen.getByTitle('Market Chile (Spanish): Chile, Spanish')).toHaveTextContent('Market: Chile (Spanish)');
  });

  it.each([
    ['of keywords without one', { market_id: 'global' }],
    ['raised before markets existed', {}],
  ])('shows no market for an alert %s', (_description, overrides) => {
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({ items: [buildAlertItem(overrides)] }));

    renderWithMarketSelection(<AlertsPanel />);

    expect(screen.queryByText('Market:')).not.toBeInTheDocument();
  });
});

describe('AlertsPanel preview', () => {
  function renderOpenAlerts(count: number) {
    mockUseOpenAlerts.mockReturnValue(buildOpenAlertsOfRuns(count));
    render(<AlertsPanel />);
  }

  it('lists only the newest five of twenty open alerts, newest run first', () => {
    renderOpenAlerts(20);

    expect(screen.getAllByRole('listitem').map((row) => row.querySelector('p.text-gray-700')?.textContent)).toStrictEqual([
      'Alert of run 19.', 'Alert of run 18.', 'Alert of run 17.', 'Alert of run 16.', 'Alert of run 15.',
    ]);
  });

  it('keeps the total in the open-alert count', () => {
    renderOpenAlerts(20);

    expect(screen.getByText('20 open alerts')).toBeInTheDocument();
  });

  it.each([
    ['lists every open alert after "Show all" is pressed', ['Show all 20 alerts'], 20],
    ['goes back to the newest five when the list is collapsed again', ['Show all 20 alerts', 'Show the newest 5'], 5],
  ])('%s', async (_name, buttons, rows) => {
    renderOpenAlerts(20);

    for (const name of buttons) {
      await userEvent.click(screen.getByRole('button', { name }));
    }

    expect(screen.getAllByRole('listitem')).toHaveLength(rows);
  });

  it('offers no "Show all" when five or fewer alerts are open', () => {
    renderOpenAlerts(5);

    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });
});
