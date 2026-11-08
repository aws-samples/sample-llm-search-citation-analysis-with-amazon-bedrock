/**
 * `PaidExportModal` open on a Labs list of `totalCount` rows (numbered from 0), its callbacks spies: `fetchChunk`
 * answers each chunk with the rows the list holds there, the downloads resolve.
 */
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  render, screen
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { fakeList } from '../../exporters/paidExport-fixtures';
import { LABS_EXPORT } from '../../api/seoDomains-fixtures';
import { PaidExportModal } from './PaidExportModal';

type Props = ComponentProps<typeof PaidExportModal<number>>;

export function renderPaidExportModal(overrides: Partial<Props> = {}) {
  const spies = {
    onClose: vi.fn<() => void>(),
    fetchChunk: fakeList(overrides.totalCount ?? 2500),
    onDownload: vi.fn<(rows: readonly number[]) => Promise<void>>().mockResolvedValue(),
    onDownloadScreen: vi.fn<() => Promise<void>>().mockResolvedValue(),
  };
  render(
    <PaidExportModal open title="ranked keywords" pricing={LABS_EXPORT} totalCount={2500} onScreenRows={50}
      {...spies} {...overrides} />,
  );
  return {
    user: userEvent.setup(),
    ...spies,
  };
}

export function getRowsInputElement(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>('Rows to export');
}

export function getDownloadElement(): HTMLElement {
  return screen.getByRole('button', { name: 'Download' });
}

/** The live "Price: …" line. */
export function getPriceLineElement(): HTMLElement {
  return screen.getByText(/^Price:/);
}

/** Replaces the row count with `rows`. */
export async function typeRows(user: ReturnType<typeof userEvent.setup>, rows: string): Promise<void> {
  await user.clear(getRowsInputElement());
  if (rows !== '') await user.type(getRowsInputElement(), rows);
}

/** Opens the dialog with `overrides`, asks for `rows` rows (the default when omitted) and presses Download. */
export async function renderDownloadClicked(rows: string | null, overrides: Partial<Props> = {}) {
  const rendered = renderPaidExportModal(overrides);
  if (rows !== null) await typeRows(rendered.user, rows);
  await rendered.user.click(getDownloadElement());
  return rendered;
}

/** Presses the dialog's Cancel. */
export async function clickCancel(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
}

/** Lets pending promises and timers of the export settle. */
export function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Keeps the console quiet about the failures a spec provokes. */
export function silenceExportFailures(): void {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
}
