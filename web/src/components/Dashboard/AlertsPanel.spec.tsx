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
  buildAlertsPanelHookResult, buildAlertsPanelMembership
} from './AlertsPanel-fixtures';

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

describe('AlertsPanel', () => {
  it('shows a loading status while the first request is pending', () => {
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({
      items: [],
      count: 0,
      loading: true,
    }));

    render(<AlertsPanel />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading alerts…');
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
    expect(screen.getByText('Citation coverage fell by 12.0 percentage points.')).toBeInTheDocument();
  });

  it('shows severity, type, metric change, and timestamp details', () => {
    const alertItem = buildAlertItem();
    mockUseOpenAlerts.mockReturnValue(buildAlertsPanelHookResult({ items: [alertItem] }));

    render(<AlertsPanel />);

    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Citation-rate drop')).toBeInTheDocument();
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

    render(<AlertsPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

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

    render(<AlertsPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

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
