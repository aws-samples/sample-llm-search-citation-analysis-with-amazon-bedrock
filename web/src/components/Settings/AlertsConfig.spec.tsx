import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  buildAlertSettings, buildContentChangeMarker
} from '../../types/domain/alerts-fixtures';
import {
  ACCEPTED_TEST_OUTCOME,
  buildAlertsConfigContentHookResult,
  mockAlertsConfigHooks,
  recordContentChangeMock,
  renderAlertsConfig,
  sendTestNotificationMock,
} from './AlertsConfig-fixtures';
import { useContentChanges as contentChangesHook } from './AlertsConfigHookMocks-fixtures';

vi.mock('../../hooks/useAlerts', () => import('./AlertsConfigHookMocks-fixtures'));
vi.mock('../../hooks/useKeywordGroups', () => import('./AlertsConfigHookMocks-fixtures'));

beforeEach(() => {
  mockAlertsConfigHooks();
});

/** Settings with no notification address and so no subscription to test. */
const UNCONFIGURED_SETTINGS = buildAlertSettings({
  notification_emails: [],
  subscription_statuses: [],
});

describe('AlertsConfig', () => {
  it('shows every configured threshold with its server value', () => {
    renderAlertsConfig();

    expect(screen.getByRole('spinbutton', { name: /Mention-rate drop/ })).toHaveValue(10);
    expect(screen.getByRole('spinbutton', { name: /Position loss/ })).toHaveValue(3);
    expect(screen.getByRole('spinbutton', { name: /Competitor top N/ })).toHaveValue(5);
    expect(screen.getByRole('spinbutton', { name: /Improvement after content change/ })).toHaveValue(8);
  });

  it('exposes exact threshold constraints to browser validation', () => {
    renderAlertsConfig();
    const thresholdNames = [
      /Mention-rate drop/,
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
    renderAlertsConfig();

    expect(screen.getByLabelText('Notification emails')).toHaveValue(
      'alerts@example.com\nops@example.com'
    );
  });

  it('shows confirmed, pending, and not-subscribed delivery states', () => {
    renderAlertsConfig();

    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Pending confirmation')).toBeInTheDocument();
    expect(screen.getByText('Not subscribed')).toBeInTheDocument();
  });

  it('explains the Amazon SNS confirmation step', () => {
    renderAlertsConfig();

    expect(screen.getByText(/Amazon SNS sends a confirmation email to each address/)).toHaveTextContent(
      'Each recipient must choose Confirm subscription before alert emails can be delivered.'
    );
  });

  it('enables the test action when an admin has a persisted confirmed subscription', () => {
    renderAlertsConfig();

    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeEnabled();
  });

  it('does not render the test action when the caller is not an admin', () => {
    renderAlertsConfig({}, false);

    expect(screen.queryByRole('button', { name: 'Send test notification' })).not.toBeInTheDocument();
  });

  it.each([
    ['pending confirmation', buildAlertSettings({
      subscription_statuses: [{
        email: 'alerts@example.com',
        status: 'pending_confirmation',
      }],
    })],
    ['not subscribed', buildAlertSettings({
      subscription_statuses: [{
        email: 'alerts@example.com',
        status: 'not_subscribed',
      }],
    })],
    ['not configured', UNCONFIGURED_SETTINGS],
  ])('disables the test action when persisted delivery is %s', (_condition, settings) => {
    renderAlertsConfig({ settings });

    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeDisabled();
  });

  it('keeps the test action disabled when only an unsaved email is entered', async () => {
    renderAlertsConfig({ settings: UNCONFIGURED_SETTINGS });
    const testButton = screen.getByRole('button', { name: 'Send test notification' });

    await userEvent.type(screen.getByLabelText('Notification emails'), 'new@example.com');

    expect(screen.getByLabelText('Notification emails')).toHaveValue('new@example.com');
    expect(testButton).toBeDisabled();
  });

  it('requests a test notification without form values when the admin selects the action', async () => {
    renderAlertsConfig();

    await userEvent.click(screen.getByRole('button', { name: 'Send test notification' }));

    expect(sendTestNotificationMock.mock.calls).toStrictEqual([[]]);
  });

  it.each([
    ['loading', { loading: true }],
    ['saving', { saving: true }],
    ['testing', { testing: true }],
  ])('disables every settings action while %s', (_condition, busyState) => {
    renderAlertsConfig(busyState);

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save alert settings|Saving…/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeDisabled();
  });

  it('shows the exact accepted outcome when the test request succeeds', () => {
    renderAlertsConfig({ testOutcome: ACCEPTED_TEST_OUTCOME });

    expect(screen.getByText(ACCEPTED_TEST_OUTCOME.message)).toBeInTheDocument();
  });

  it('announces the exact failure when the test request is rejected', () => {
    renderAlertsConfig({
      testOutcome: {
        success: false,
        message: 'Confirm an email subscription before testing delivery.',
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Confirm an email subscription before testing delivery.'
    );
  });

  it('prevents non-admin users from saving settings or recording markers', () => {
    renderAlertsConfig({}, false);

    expect(screen.getByRole('button', { name: 'Save alert settings' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record content change' })).toBeDisabled();
    expect(screen.getByText('Only administrators can change or save alert settings.')).toBeInTheDocument();
  });

  it('keeps refresh enabled while alert settings are idle', () => {
    renderAlertsConfig();

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('shows loading status while initial settings are pending', () => {
    renderAlertsConfig({
      settings: null,
      loading: true,
    });

    expect(screen.getByText('Loading alert settings…')).toBeInTheDocument();
  });

  it.each([
    ['while persisted settings refresh in place', { loading: true }],
    ['when no settings request is pending', {
      settings: null,
      loading: false,
    }],
  ])('hides loading status %s', (_condition, settingsState) => {
    renderAlertsConfig(settingsState);

    expect(screen.queryByText('Loading alert settings…')).not.toBeInTheDocument();
  });

  it('disables refresh while settings are being saved', () => {
    renderAlertsConfig({ saving: true });

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('sends the full deduplicated settings object when an admin saves', async () => {
    const saveSettings = vi.fn().mockResolvedValue({
      success: true,
      message: 'Alert settings saved.',
      warnings: [],
    });
    renderAlertsConfig({ saveSettings });
    const emailInput = screen.getByLabelText('Notification emails');

    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, 'owner@example.com,OWNER@example.com,ops@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save alert settings' }));

    expect(saveSettings).toHaveBeenCalledWith({
      enabled: true,
      notification_emails: ['owner@example.com', 'ops@example.com'],
      thresholds: {
        mention_rate_drop: 10,
        position_loss: 3,
        competitor_top_n: 5,
        improvement_after_content_change: 8,
      },
    });
  });

  it('shows the exact save outcome and every server warning', () => {
    renderAlertsConfig({
      saveOutcome: {
        success: true,
        message: 'Alert settings saved.',
        warnings: [
          'owner@example.com must confirm the subscription.',
          'ops@example.com is not subscribed.',
        ],
      },
    });

    expect(screen.getByText('Alert settings saved.')).toBeInTheDocument();
    expect(screen.getByText('owner@example.com must confirm the subscription.')).toBeInTheDocument();
    expect(screen.getByText('ops@example.com is not subscribed.')).toBeInTheDocument();
  });

  it('announces the exact settings loading failure', () => {
    renderAlertsConfig({
      settings: null,
      error: 'Failed to process alert request',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to process alert request');
  });

  async function renderAndSelectNorthGroup() {
    renderAlertsConfig();
    await userEvent.selectOptions(screen.getByLabelText('Keyword group'), 'group-north');
  }

  async function recordContentChange() {
    await userEvent.click(screen.getByRole('button', { name: 'Record content change' }));
  }

  async function renderAndRecordContentChange(description: string, url: string) {
    await renderAndSelectNorthGroup();
    await userEvent.type(screen.getByLabelText('Description'), description);
    await userEvent.type(screen.getByLabelText('URL (optional)'), url);
    await recordContentChange();
  }

  it('requires a description before recording a content change', async () => {
    await renderAndSelectNorthGroup();
    await recordContentChange();

    expect(screen.getByRole('alert')).toHaveTextContent('Describe the content change');
    expect(recordContentChangeMock.mock.calls).toStrictEqual([]);
  });

  it('rejects a content change URL outside HTTP and HTTPS', async () => {
    await renderAndRecordContentChange('Published revised guidance', 'ftp://example.com/guidance');

    expect(screen.getByRole('alert')).toHaveTextContent('URL must start with http:// or https://');
  });

  it('records a trimmed marker for the selected group', async () => {
    await renderAndRecordContentChange('  Published revised guidance  ', '  https://example.com/guidance  ');

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
    contentChangesHook.mockReturnValue(buildAlertsConfigContentHookResult({ latestMarker: marker }));

    renderAlertsConfig();

    expect(screen.getByText('Published revised guidance')).toBeInTheDocument();
    expect(screen.getByText(/Marker change-latest/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/guidance' })).toHaveAttribute(
      'href',
      'https://example.com/guidance'
    );
  });

  it('explains that attribution requires a prior content-change marker', () => {
    renderAlertsConfig();

    expect(screen.getByText(/This marker is required before an improvement alert/)).toHaveTextContent(
      'can attribute a visibility gain to that content change.'
    );
  });
});

describe('AlertsConfig outcomes', () => {
  it('requests a settings refresh when Refresh is selected', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderAlertsConfig({ refresh });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));

    expect(refresh).toHaveBeenCalledWith();
  });

  it('renders no warning list when a test outcome has no warnings', () => {
    renderAlertsConfig({ testOutcome: ACCEPTED_TEST_OUTCOME });

    const outcome = screen.getByText(ACCEPTED_TEST_OUTCOME.message);

    expect(outcome.parentElement?.querySelector('ul')).toBeNull();
  });
});
