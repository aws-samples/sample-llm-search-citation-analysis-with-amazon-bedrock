import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Presses the shared viewer-header `DownloadButton`. */
export async function clickDownloadButton(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /download/i }));
}
