import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  useAlertSettings as alertSettingsHook,
  useContentChanges as contentChangesHook,
  useKeywordGroups as keywordGroupsHook,
} from './AlertsConfigHookMocks-fixtures';
import { AlertsConfig } from './AlertsConfig';
import {
  buildAlertsConfigContentHookResult,
  buildAlertsConfigGroupsHookResult,
  buildAlertsConfigSettingsHookResult,
} from './AlertsConfig-fixtures';

vi.mock('../../hooks/useAlerts', () => import('./AlertsConfigHookMocks-fixtures'));
vi.mock('../../hooks/useKeywordGroups', () => import('./AlertsConfigHookMocks-fixtures'));

beforeEach(() => {
  alertSettingsHook.mockReturnValue(buildAlertsConfigSettingsHookResult());
  contentChangesHook.mockReturnValue(buildAlertsConfigContentHookResult());
  keywordGroupsHook.mockReturnValue(buildAlertsConfigGroupsHookResult());
});

describe('AlertsConfig outcomes', () => {
  it('requests a settings refresh when Refresh is selected', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    alertSettingsHook.mockReturnValue(buildAlertsConfigSettingsHookResult({ refresh }));
    render(<AlertsConfig isAdmin />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));

    expect(refresh).toHaveBeenCalledWith();
  });

  it('renders no warning list when a test outcome has no warnings', () => {
    alertSettingsHook.mockReturnValue(buildAlertsConfigSettingsHookResult({
      testOutcome: {
        success: true,
        message: 'Test notification accepted for delivery.',
      },
    }));
    render(<AlertsConfig isAdmin />);

    const outcome = screen.getByText('Test notification accepted for delivery.');

    expect(outcome.parentElement?.querySelector('ul')).toBeNull();
  });
});
