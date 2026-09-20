import {
  describe, expect, it, vi
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  VALID_SUBSCRIPTION_STATUSES,
  buildAlertSettings,
} from '../../types/domain/alerts-fixtures';
import { AlertSettingsForm } from './AlertSettingsForm';
import {
  buildAlertSettingsFormProps,
  getAlertSettingsForm,
  renderAlertSettingsForm,
  submitEmptyCitationRate,
  thresholdValues,
} from './AlertSettingsForm-fixtures';

describe('AlertSettingsForm', () => {
  it('submits the exact settings represented by every edited control', async () => {
    const { props } = renderAlertSettingsForm();
    const user = userEvent.setup();
    const edits = [
      [/Citation-rate drop/u, '12.5'],
      [/Position loss/u, '4.5'],
      [/Competitor top N/u, '7'],
      [/Improvement after content change/u, '9.5'],
    ] satisfies ReadonlyArray<readonly [RegExp, string]>;

    await user.click(screen.getByRole('checkbox', { name: /Enable alerts/u }));
    for (const [name, value] of edits) {
      const input = screen.getByRole('spinbutton', { name });
      await user.clear(input);
      await user.type(input, value);
    }
    await user.clear(screen.getByLabelText('Notification emails'));
    await user.type(screen.getByLabelText('Notification emails'), 'owner@example.com');
    await user.click(screen.getByRole('button', { name: 'Save alert settings' }));

    expect(props.onSave).toHaveBeenCalledWith({
      enabled: false,
      notification_emails: ['owner@example.com'],
      thresholds: {
        citation_rate_drop: 12.5,
        position_loss: 4.5,
        competitor_top_n: 7,
        improvement_after_content_change: 9.5,
      },
    });
  });

  it('replaces threshold controls when persisted settings change', () => {
    const { rerender } = renderAlertSettingsForm();
    const nextProps = buildAlertSettingsFormProps({
      settings: buildAlertSettings({
        thresholds: {
          citation_rate_drop: 0.5,
          position_loss: 6,
          competitor_top_n: 10,
          improvement_after_content_change: 100,
        },
      }),
    });

    rerender(<AlertSettingsForm {...nextProps} />);

    expect(thresholdValues()).toStrictEqual(['0.5', '6', '10', '100']);
  });

  it('replaces delivery controls when persisted settings change', () => {
    const { rerender } = renderAlertSettingsForm();
    const nextProps = buildAlertSettingsFormProps({
      settings: buildAlertSettings({
        enabled: false,
        notification_emails: ['new@example.com'],
      }),
    });

    rerender(<AlertSettingsForm {...nextProps} />);

    expect(screen.getByRole('checkbox', { name: /Enable alerts/u })).not.toBeChecked();
    expect(screen.getByLabelText('Notification emails')).toHaveValue('new@example.com');
  });

  it('shows the exact validation failure without saving invalid settings', async () => {
    const { props } = renderAlertSettingsForm();

    await submitEmptyCitationRate();

    expect(screen.getByRole('alert')).toHaveTextContent('Citation-rate drop must be a number');
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('clears a validation failure when persisted settings change', async () => {
    const { rerender } = renderAlertSettingsForm();
    await submitEmptyCitationRate();
    expect(screen.getByRole('alert')).toHaveTextContent('Citation-rate drop must be a number');

    rerender(<AlertSettingsForm {...buildAlertSettingsFormProps()} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('removes the validation failure after valid settings are submitted', async () => {
    const { props } = renderAlertSettingsForm();
    const {
      citationRate, user
    } = await submitEmptyCitationRate();

    await user.type(citationRate, '1');
    await user.click(screen.getByRole('button', { name: 'Save alert settings' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it('prevents browser submission when settings are submitted', () => {
    renderAlertSettingsForm();
    const submitEvent = new Event('submit', {
      bubbles: true,
      cancelable: true
    });
    const preventDefaultSpy = vi.spyOn(submitEvent, 'preventDefault');

    fireEvent(getAlertSettingsForm(), submitEvent);

    expect(preventDefaultSpy).toHaveBeenCalledWith();
    preventDefaultSpy.mockRestore();
  });

  it('shows every exact subscription status label', () => {
    renderAlertSettingsForm({
      settings: buildAlertSettings({
        subscription_statuses: VALID_SUBSCRIPTION_STATUSES.map((status) => ({
          email: `${status}@example.com`,
          status,
        })),
      }),
    });

    expect(screen.getAllByRole('status').map((status) => status.textContent)).toStrictEqual([
      'Confirmed',
      'Pending confirmation',
      'Not subscribed',
      'Unknown',
    ]);
  });

  it('shows the empty subscription outcome when no delivery status exists', () => {
    const settings = buildAlertSettings({ subscription_statuses: [] });

    renderAlertSettingsForm({ settings });

    expect(screen.getByText('No subscription status is available.')).toBeInTheDocument();
  });
});
