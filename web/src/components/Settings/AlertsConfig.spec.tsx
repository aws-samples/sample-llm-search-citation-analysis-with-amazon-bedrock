import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildContentChangeMarker } from '../../types/domain/alerts-fixtures';
import { AlertsConfig } from './AlertsConfig';
import {
  buildAlertsConfigContentHookResult,
  buildAlertsConfigGroupsHookResult,
  buildAlertsConfigSettingsHookResult,
  recordContentChangeMock,
} from './AlertsConfig-fixtures';

vi.mock('../../hooks/useAlerts', () => ({
  useAlertSettings: vi.fn(),
  useContentChanges: vi.fn(),
}));
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import {
  useAlertSettings, useContentChanges
} from '../../hooks/useAlerts';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';

const mockUseAlertSettings = vi.mocked(useAlertSettings);
const mockUseContentChanges = vi.mocked(useContentChanges);
const mockUseKeywordGroups = vi.mocked(useKeywordGroups);

beforeEach(() => {
  mockUseAlertSettings.mockReturnValue(buildAlertsConfigSettingsHookResult());
  mockUseContentChanges.mockReturnValue(buildAlertsConfigContentHookResult());
  mockUseKeywordGroups.mockReturnValue(buildAlertsConfigGroupsHookResult());
});

describe('AlertsConfig', () => {
  it('shows every configured threshold with its server value', () => {
    render(<AlertsConfig isAdmin />);

    expect(screen.getByRole('spinbutton', { name: /Citation-rate drop/ })).toHaveValue(10);
    expect(screen.getByRole('spinbutton', { name: /Position loss/ })).toHaveValue(3);
    expect(screen.getByRole('spinbutton', { name: /Competitor top N/ })).toHaveValue(5);
    expect(screen.getByRole('spinbutton', { name: /Improvement after content change/ })).toHaveValue(8);
  });

  it('exposes exact threshold constraints to browser validation', () => {
    render(<AlertsConfig isAdmin />);
    const thresholdNames = [
      /Citation-rate drop/,
      /Position loss/,
      /Competitor top N/,
      /Improvement after content change/,
    ];

    const constraints = thresholdNames.map((thresholdName) => {
      const input = screen.getByRole('spinbutton', { name: thresholdName });
      return {
        minimum: input.getAttribute('min'),
        maximum: input.getAttribute('max'),
        step: input.getAttribute('step'),
      };
    });

    expect(constraints).toStrictEqual([
      {
        minimum: '0.1',
        maximum: '100',
        step: '0.1',
      },
      {
        minimum: '0.1',
        maximum: '100',
        step: '0.1',
      },
      {
        minimum: '1',
        maximum: '10',
        step: '1',
      },
      {
        minimum: '0.1',
        maximum: '100',
        step: '0.1',
      },
    ]);
  });

  it('shows a deduplicated editable notification email list', () => {
    render(<AlertsConfig isAdmin />);

    expect(screen.getByLabelText('Notification emails')).toHaveValue(
      'alerts@example.com\nops@example.com'
    );
  });

  it('shows confirmed, pending, and not-subscribed delivery states', () => {
    render(<AlertsConfig isAdmin />);

    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Pending confirmation')).toBeInTheDocument();
    expect(screen.getByText('Not subscribed')).toBeInTheDocument();
  });

  it('explains the Amazon SNS confirmation step', () => {
    render(<AlertsConfig isAdmin />);

    expect(screen.getByText(/Amazon SNS sends a confirmation email to each address/)).toHaveTextContent(
      'Each recipient must choose Confirm subscription before alert emails can be delivered.'
    );
  });

  it('prevents non-admin users from saving settings or recording markers', () => {
    render(<AlertsConfig isAdmin={false} />);

    expect(screen.getByRole('button', { name: 'Save alert settings' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record content change' })).toBeDisabled();
    expect(screen.getByText('Only administrators can change or save alert settings.')).toBeInTheDocument();
  });

  it('disables refresh while settings are being saved', () => {
    mockUseAlertSettings.mockReturnValue(buildAlertsConfigSettingsHookResult({ saving: true }));

    render(<AlertsConfig isAdmin />);

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('sends the full deduplicated settings object when an admin saves', async () => {
    const saveSettings = vi.fn().mockResolvedValue({
      success: true,
      message: 'Alert settings saved.',
      warnings: [],
    });
    mockUseAlertSettings.mockReturnValue(buildAlertsConfigSettingsHookResult({ saveSettings }));
    render(<AlertsConfig isAdmin />);
    const emailInput = screen.getByLabelText('Notification emails');

    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, 'owner@example.com,OWNER@example.com,ops@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save alert settings' }));

    expect(saveSettings).toHaveBeenCalledWith({
      enabled: true,
      notification_emails: ['owner@example.com', 'ops@example.com'],
      thresholds: {
        citation_rate_drop: 10,
        position_loss: 3,
        competitor_top_n: 5,
        improvement_after_content_change: 8,
      },
    });
  });

  it('shows the exact save outcome and every server warning', () => {
    mockUseAlertSettings.mockReturnValue(buildAlertsConfigSettingsHookResult({
      saveOutcome: {
        success: true,
        message: 'Alert settings saved.',
        warnings: [
          'owner@example.com must confirm the subscription.',
          'ops@example.com is not subscribed.',
        ],
      },
    }));

    render(<AlertsConfig isAdmin />);

    expect(screen.getByText('Alert settings saved.')).toBeInTheDocument();
    expect(screen.getByText('owner@example.com must confirm the subscription.')).toBeInTheDocument();
    expect(screen.getByText('ops@example.com is not subscribed.')).toBeInTheDocument();
  });

  it('announces the exact settings loading failure', () => {
    mockUseAlertSettings.mockReturnValue(buildAlertsConfigSettingsHookResult({
      settings: null,
      error: 'Failed to process alert request',
    }));

    render(<AlertsConfig isAdmin />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to process alert request');
  });

  it('requires a description before recording a content change', async () => {
    render(<AlertsConfig isAdmin />);

    await userEvent.selectOptions(screen.getByLabelText('Keyword group'), 'group-north');
    await userEvent.click(screen.getByRole('button', { name: 'Record content change' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Describe the content change');
    expect(recordContentChangeMock.mock.calls).toStrictEqual([]);
  });

  it('rejects a content change URL outside HTTP and HTTPS', async () => {
    render(<AlertsConfig isAdmin />);

    await userEvent.selectOptions(screen.getByLabelText('Keyword group'), 'group-north');
    await userEvent.type(screen.getByLabelText('Description'), 'Published revised guidance');
    await userEvent.type(screen.getByLabelText('URL (optional)'), 'ftp://example.com/guidance');
    await userEvent.click(screen.getByRole('button', { name: 'Record content change' }));

    expect(screen.getByRole('alert')).toHaveTextContent('URL must start with http:// or https://');
  });

  it('records a trimmed marker for the selected group', async () => {
    render(<AlertsConfig isAdmin />);

    await userEvent.selectOptions(screen.getByLabelText('Keyword group'), 'group-north');
    await userEvent.type(screen.getByLabelText('Description'), '  Published revised guidance  ');
    await userEvent.type(screen.getByLabelText('URL (optional)'), '  https://example.com/guidance  ');
    await userEvent.click(screen.getByRole('button', { name: 'Record content change' }));

    expect(recordContentChangeMock).toHaveBeenCalledWith({
      group_id: 'group-north',
      description: 'Published revised guidance',
      url: 'https://example.com/guidance',
    });
  });

  it('shows the latest marker response with its exact values', () => {
    const marker = buildContentChangeMarker({
      id: 'change-latest',
      description: 'Published revised guidance',
      url: 'https://example.com/guidance',
    });
    mockUseContentChanges.mockReturnValue(buildAlertsConfigContentHookResult({ latestMarker: marker }));

    render(<AlertsConfig isAdmin />);

    expect(screen.getByText('Published revised guidance')).toBeInTheDocument();
    expect(screen.getByText(/Marker change-latest/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/guidance' })).toHaveAttribute(
      'href',
      'https://example.com/guidance'
    );
  });

  it('explains that attribution requires a prior content-change marker', () => {
    render(<AlertsConfig isAdmin />);

    expect(screen.getByText(/This marker is required before an improvement alert/)).toHaveTextContent(
      'can attribute a visibility gain to that content change.'
    );
  });
});
