import type { ComponentProps } from 'react';
import {
  render, screen
} from '@testing-library/react';
import { vi } from 'vitest';
import { RefreshTextButton } from './RefreshTextButton';

/** Renders the button, idle and enabled unless `overrides` say otherwise; returns the `onRefresh` spy. */
export function renderRefreshButton(overrides: Partial<ComponentProps<typeof RefreshTextButton>> = {}) {
  const onRefresh = vi.fn();
  render(<RefreshTextButton onRefresh={onRefresh} {...overrides} />);
  return onRefresh;
}

export function getRefreshButtonElement(): HTMLElement {
  return screen.getByRole('button', { name: 'Refresh' });
}
