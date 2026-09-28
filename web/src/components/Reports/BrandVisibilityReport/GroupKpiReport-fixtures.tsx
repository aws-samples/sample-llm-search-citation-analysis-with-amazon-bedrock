import { vi } from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import type { GroupKpiHistoryResponse } from '../../../types/domain/groupKpiHistory';
import userEvent from '@testing-library/user-event';
import { GroupKpiReport } from './GroupKpiReport';
import { GroupKpiExportButton } from './GroupKpiExportButton';
import { buildHistory } from './groupKpiHistory-fixtures';

/** The keyword group every report fixture covers. */
export const HOTEL_SOL_SCOPE = {
  kind: 'group',
  groupId: 'hotel-sol',
} as const;

interface Options {
  readonly history?: GroupKpiHistoryResponse | null;
  readonly loading?: boolean;
  readonly error?: string | null;
}

/** Mount the per-group report (90 days) with `buildHistory()` unless told otherwise; returns the period callback. */
export function renderGroupKpiReport({
  history = buildHistory(), loading = false, error = null
}: Options = {}) {
  const onDaysChange = vi.fn<(days: number) => void>();
  render(
    <GroupKpiReport
      scope={HOTEL_SOL_SCOPE}
      scopeLabel="Hotel Sol"
      history={history}
      loading={loading}
      error={error}
      days={90}
      onDaysChange={onDaysChange}
    />,
  );
  return { onDaysChange };
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

class MissingStatCardError extends Error {
  constructor(label: string) {
    super(`No stat card for ${label}`);
    this.name = 'MissingStatCardError';
  }
}

/**
 * The headline card whose tooltip explains `label`. The KPI table under the
 * cards explains the same KPI again, so the card is the first such tooltip.
 */
export function statCard(label: string): HTMLElement {
  const [tooltip] = within(sectionTitled('Headline')).getAllByRole('button', { name: `About ${label}` });
  const card = tooltip.closest('div');
  if (card === null) throw new MissingStatCardError(label);
  return card;
}

/** The headline figure element of the card explained as `label`. */
export function statFigure(label: string): HTMLElement {
  return within(statCard(label)).getAllByText(/./, { selector: 'p' })[1];
}

/** The caption of every headline card, left to right. */
export function headlineCardLabels(): (string | null)[] {
  const grid = statCard('Mention rate').parentElement;
  return [...grid?.children ?? []].map((card) => card.querySelector('p')?.firstChild?.textContent ?? null);
}

/** The footnote under the figure of the card explained as `label`. */
export function statFootnote(label: string): string | null {
  return within(statCard(label)).getAllByText(/./, { selector: 'p' })[2].textContent;
}

/**
 * Every row (header first) of the table in the section headed `title`, as
 * the leading text of each cell: a heading or KPI name without its tooltip.
 */
export function sectionTable(title: string): string[][] {
  return within(sectionTitled(title)).getAllByRole('row').map(
    (row) => [...row.querySelectorAll('th, td')].map((cell) => cell.firstChild?.textContent ?? ''),
  );
}

/** The text of the tooltip an "i" button opens. */
function tooltipText(button: Element): string | null {
  return document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? null;
}

/** Every column heading of the table in the section headed `title` that has a tooltip, with the tooltip's text. */
export function headerTooltips(title: string): (string | null)[][] {
  return [...sectionTitled(title).querySelectorAll('th')].flatMap((header) => {
    const button = header.querySelector('button');
    return button === null ? [] : [[header.firstChild?.textContent ?? null, tooltipText(button)]];
  });
}

/** The label and tooltip text of every KPI row of the headline table, in row order. */
export function kpiRowTooltips(): (string | null)[][] {
  return [...sectionTitled('Headline').querySelectorAll('td button')].map((button) => [
    button.getAttribute('aria-label'),
    tooltipText(button),
  ]);
}

/** The "Brand mentioned" cell of each body row of the keyword detail table, top to bottom. */
export function keywordDetailMentions(): string[] {
  return sectionTable('Keyword detail').slice(1).map((row) => row[1]);
}

/** Mount the export button on the second run of `buildHistory()` and click it. */
export async function clickGroupKpiExport(): Promise<void> {
  const history = buildHistory();
  render(<GroupKpiExportButton scope={HOTEL_SOL_SCOPE} scopeLabel="Hotel Sol" history={history} run={history.runs[1]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
}
