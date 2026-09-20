import type { ComponentProps } from 'react';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { buildAlertSettings } from '../../types/domain/alerts-fixtures';
import { AlertSettingsForm } from './AlertSettingsForm';

export function buildAlertSettingsFormProps(
  overrides: Partial<ComponentProps<typeof AlertSettingsForm>> = {}
): ComponentProps<typeof AlertSettingsForm> {
  return {
    settings: buildAlertSettings(),
    isAdmin: true,
    loading: false,
    saving: false,
    testing: false,
    onSave: vi.fn().mockResolvedValue({
      success: true,
      message: 'Alert settings saved.',
      warnings: [],
    }),
    onSendTestNotification: vi.fn().mockResolvedValue({
      success: true,
      message: 'Test notification accepted for delivery.',
    }),
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

export async function submitEmptyCitationRate() {
  const user = userEvent.setup();
  const citationRate = screen.getByRole('spinbutton', { name: /Citation-rate drop/u });
  await user.clear(citationRate);
  await user.click(screen.getByRole('button', { name: 'Save alert settings' }));
  return {
    citationRate,
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
    'Citation-rate drop',
    'Position loss',
    'Competitor top N',
    'Improvement after content change',
  ].map((name) => screen.getByRole('spinbutton', { name: new RegExp(name, 'u') }))
    .map((input) => input.getAttribute('value') ?? '');
}
