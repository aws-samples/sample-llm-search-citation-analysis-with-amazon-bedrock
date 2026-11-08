/**
 * `PaidExportModal` open on a Labs list of `totalCount` rows (ranked keywords of example.com, page 2 of 50 on
 * screen), its `onClose` a spy. Specs mock `api/exports` with `test/exportsApiMock`, so `mockStartExport` holds
 * what the dialog queued.
 */
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  render, screen
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { LABS_EXPORT } from '../../api/seoDomains-fixtures';
import {
  EXPORTS_CONTEXT, type ExportsCenter
} from '../../hooks/useExports';
import { buildExportsCenter } from '../Exports/ExportsView-fixtures';
import { PaidExportModal } from './PaidExportModal';

type Props = ComponentProps<typeof PaidExportModal>;

/** The list the dialog exports: example.com's ranked keywords by traffic, filtered to 10+ searches. */
export const KEYWORD_LIST = {
  table: 'keywords',
  target: 'example.com',
  sort: 'traffic',
  order: 'desc',
  filters: '{"min_volume":10}',
} as const;

/** Renders the open dialog, inside an Exports center whose `start` is `start` when one is given. */
export function renderPaidExportModal(overrides: Partial<Props> = {}, start?: ExportsCenter['start']) {
  const onClose = vi.fn<() => void>();
  const dialog = (
    <PaidExportModal open title="ranked keywords" pricing={LABS_EXPORT} totalCount={2500} onScreenRows={50}
      view="seo-domain" params={KEYWORD_LIST} screenPage={{
        page: 2,
        page_size: 50,
      }} onClose={onClose} {...overrides} />
  );
  render(start === undefined ? dialog : <EXPORTS_CONTEXT.Provider value={buildExportsCenter({ start })}>{dialog}</EXPORTS_CONTEXT.Provider>);
  return {
    user: userEvent.setup(),
    onClose,
  };
}

export function getRowsInputElement(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>('Rows to export');
}

export function getStartElement(): HTMLElement {
  return screen.getByRole('button', { name: 'Start export' });
}

export function getScreenExportElement(): HTMLElement {
  return screen.getByRole('button', { name: 'Export the 50 rows on screen (free)' });
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

/** Opens the dialog with `overrides`, asks for `rows` rows (the default when omitted) and presses Start export. */
export async function renderStartClicked(rows: string | null, overrides: Partial<Props> = {}) {
  const rendered = renderPaidExportModal(overrides);
  if (rows !== null) await typeRows(rendered.user, rows);
  await rendered.user.click(getStartElement());
  return rendered;
}

/** Keeps the console quiet about the failures a spec provokes. */
export function silenceExportFailures(): void {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
}
