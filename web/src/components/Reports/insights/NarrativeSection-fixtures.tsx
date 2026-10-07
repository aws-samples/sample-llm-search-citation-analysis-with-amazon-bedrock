import {
  act, fireEvent, render, screen, within, type RenderResult
} from '@testing-library/react';
import type { ReportScope } from '../../../types';
import type { InsightsNarrative } from '../../../types/domain/insightsNarrative';
import { buildNarrative } from '../../../types/domain/insightsNarrative-fixtures';
import { buildInsightsWithNarrative } from '../../../hooks/useNarrativeRegeneration-fixtures';
import { settledSlice } from '../layout/reportSlice-fixtures';
import { sectionTitled } from '../layout/reportQueries-fixtures';
import {
  NARRATIVE_TITLE, NarrativeSection
} from './NarrativeSection';

export const GROUP_SCOPE: ReportScope = {
  kind: 'group',
  groupId: 'group-coruna',
};

/** The section over the insights of a group carrying `narrative` (none when `null`), for `scope`. */
export function renderNarrative(narrative: InsightsNarrative | null = buildNarrative(), scope: ReportScope = GROUP_SCOPE): RenderResult {
  return render(<NarrativeSection {...settledSlice(buildInsightsWithNarrative(narrative))} scope={scope} days={90} />);
}

/** The items of the section's list headed `heading`, each item's text in full. */
export function narrativeItems(heading: string): string[] {
  const list = within(sectionTitled(NARRATIVE_TITLE)).getByRole('list', { name: heading });
  return Array.from(list.children, (item) => item.textContent ?? '');
}

/** The "Based on" lines under the item at `index` of the list headed `heading`. */
export function citedInsightLines(heading: string, index: number): string[] {
  const item = screen.getByRole('list', { name: heading }).children[index];
  return within(within(item as HTMLElement).getByRole('list', { name: 'Based on' })).getAllByRole('listitem')
    .map((line) => line.textContent ?? '');
}

/** The admin's Regenerate button, or `null` when the section offers none. */
export function queryRegenerateButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Regenerate' });
}

/** Clicks the admin's Regenerate button, opening its confirmation dialog. */
export function openRegenerateDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
}

/** Opens the confirmation dialog and confirms it, letting the regenerate request settle. */
export async function confirmRegenerate(): Promise<void> {
  openRegenerateDialog();
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }));
  });
}
