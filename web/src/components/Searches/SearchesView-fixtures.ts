import { screen } from '@testing-library/react';

/** The "Load older searches" button, or `null` when the list offers none. */
export function queryLoadOlderSearchesElement(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Load older searches' });
}
