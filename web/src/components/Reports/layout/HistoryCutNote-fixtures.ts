import { screen } from '@testing-library/react';

/** The run a bounded history read stopped at. */
export const CUT_RUN = '2026-10-05T06:50:33Z';

/** The `HistoryCutNote` on screen, which must exist. */
export function getCutNoteElement(): HTMLElement {
  return screen.getByRole('note');
}

/** What `HistoryCutNote` says after a read cut at `run`. */
export function cutNoteText(run: string): string {
  return `the report covers the runs after ${new Date(run).toLocaleString()}`;
}
