import { vi } from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import type { GroupKpiHistoryResponse } from '../../../types/domain/groupKpiHistory';
import { GroupKpiReport } from './GroupKpiReport';
import { buildHistory } from './groupKpiHistory-fixtures';

interface Options {
  readonly history?: GroupKpiHistoryResponse | null;
  readonly loading?: boolean;
  readonly error?: string | null;
}

/** Mount the per-hotel report (90 days) with `buildHistory()` unless told otherwise; returns the period callback. */
export function renderGroupKpiReport({
  history = buildHistory(), loading = false, error = null
}: Options = {}) {
  const onDaysChange = vi.fn<(days: number) => void>();
  render(<GroupKpiReport history={history} loading={loading} error={error} days={90} onDaysChange={onDaysChange} />);
  return { onDaysChange };
}


class MissingStatCardError extends Error {
  constructor(label: string) {
    super(`No stat card for ${label}`);
    this.name = 'MissingStatCardError';
  }
}

/** The headline card whose tooltip explains `label`. */
export function statCard(label: string): HTMLElement {
  const card = screen.getByRole('button', { name: `About ${label}` }).closest('div');
  if (card === null) throw new MissingStatCardError(label);
  return card;
}


class MissingSectionError extends Error {
  constructor(title: string) {
    super(`No report section titled ${title}`);
    this.name = 'MissingSectionError';
  }
}

/** The report section headed `title`. */
export function sectionTitled(title: string): HTMLElement {
  const section = screen.getByRole('heading', { name: title }).closest('section');
  if (section === null) throw new MissingSectionError(title);
  return section;
}

/** The "Hotel mentioned" cell of each body row of the keyword detail table, top to bottom. */
export function keywordDetailMentions(): (string | null)[] {
  const rows = within(sectionTitled('Keyword detail')).getAllByRole('row').slice(1);
  return rows.map((row) => row.querySelectorAll('td')[1]?.textContent ?? null);
}


/** Every row (header first) of the table in the section headed `title`, as cell texts. */
export function sectionTable(title: string): string[][] {
  return within(sectionTitled(title)).getAllByRole('row').map(
    (row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''),
  );
}

/** The headline figure element of the card explained as `label`. */
export function statFigure(label: string): HTMLElement {
  return within(statCard(label)).getAllByText(/./, { selector: 'p' })[1];
}
