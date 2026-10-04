import type { ComponentProps } from 'react';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildAlertSettings } from '../../types/domain/alerts-fixtures';
import { buildAlertSettingsHookResult } from '../../hooks/useAlerts-fixtures';
import { AlertSettingsForm } from './AlertSettingsForm';

export function buildAlertSettingsFormProps(
  overrides: Partial<ComponentProps<typeof AlertSettingsForm>> = {}
): ComponentProps<typeof AlertSettingsForm> {
  const hook = buildAlertSettingsHookResult();
  return {
    settings: buildAlertSettings(),
    isAdmin: true,
    loading: false,
    saving: false,
    testing: false,
    onSave: hook.saveSettings,
    onSendTestNotification: hook.sendTestNotification,
    ...overrides,
  };
}

export function renderAlertSettingsForm(
  overrides: Partial<ComponentProps<typeof AlertSettingsForm>> = {}
) {
  const props = buildAlertSettingsFormProps(overrides);
  return {
    ...render(<AlertSettingsForm {...props} />),
    props,
  };
}

export async function submitEmptyMentionRate() {
  const user = userEvent.setup();
  const mentionRate = screen.getByRole('spinbutton', { name: /Mention-rate drop/u });
  await user.clear(mentionRate);
  await user.click(screen.getByRole('button', { name: 'Save alert settings' }));
  return {
    mentionRate,
    user,
  };
}

class AlertSettingsFormFixtureError extends Error {
  constructor() {
    super('Alert settings form was not rendered');
    this.name = 'AlertSettingsFormFixtureError';
  }
}

export function getAlertSettingsForm(): HTMLFormElement {
  const form = document.querySelector<HTMLFormElement>('form');
  if (form === null) throw new AlertSettingsFormFixtureError();
  return form;
}

export function thresholdValues(): string[] {
  return [
    'Mention-rate drop',
    'Position loss',
    'Competitor top N',
    'Improvement after content change',
  ].map((name) => screen.getByRole('spinbutton', { name: new RegExp(name, 'u') }))
    .map((input) => input.getAttribute('value') ?? '');
}
