import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KeywordVisibilityRow } from '../../types';
import { HISTORY_TITLE } from './VisibilityHistory';
import { buildKpis } from '../Reports/BrandVisibilityReport/groupKpiHistory-fixtures';
import {
  KEYWORD_WITHOUT_DATA, buildKeywordRow
} from './visibilityOverview-fixtures';

/** The text of every body cell, row by row. */
export function bodyRowCells(table: HTMLElement): string[][] {
  return within(table).getAllByRole('row').slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''));
}

/** The first cell of every body row, top to bottom. */
export function firstColumnCells(table: HTMLElement): string[] {
  return bodyRowCells(table).map(([first]) => first);
}

/** Each column heading's own text, without its tooltip. */
export function columnHeadingTexts(table: HTMLElement): string[] {
  return within(table).getAllByRole('columnheader').map((heading) => heading.childNodes[0].textContent ?? '');
}

/** The label of each sortable column's sort button, arrow included. */
export function sortButtonLabels(table: HTMLElement): string[] {
  return within(table).getAllByRole('columnheader').map((heading) => within(heading).getAllByRole('button')[0].textContent ?? '');
}

/** Each column heading's `aria-sort`, left to right. */
export function ariaSortValues(table: HTMLElement): string[] {
  return within(table).getAllByRole('columnheader').map((heading) => heading.getAttribute('aria-sort') ?? '');
}

/** The Visibility tab panel headed `title`. */
export function panelTitled(title: string): HTMLElement {
  return screen.getByRole('region', { name: title });
}

/** Queries within the KPI history panel. */
export function historyPanel() {
  return within(panelTitled(HISTORY_TITLE));
}

/** The info button explaining `name` ("About <name>"). */
export function aboutButton(name: string): HTMLElement {
  return screen.getByRole('button', { name: `About ${name}` });
}

/** The line naming the scope, its keywords with data and the latest run. */
export function scopeLine(): HTMLElement {
  return screen.getByText(/keywords have analysis data/);
}

/** The one table in the panel headed `title`. */
export function panelTable(title: string): HTMLElement {
  return within(panelTitled(title)).getByRole('table');
}

/** Clicks the history range button of `days` days. */
export async function clickRangeButton(days: number): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: `${days} days` }));
}

/** Clicks the buttons named `names`, one after the other. */
export async function clickButtonsInTurn(names: readonly string[]): Promise<void> {
  for (const name of names) {
    await userEvent.click(screen.getByRole('button', { name }));
  }
}

/**
 * Four keywords whose visibility score and average position sort
 * differently: "Alpha" is never placed, "hotel sol beach" has no data.
 */
export const SORTABLE_KEYWORD_ROWS: readonly KeywordVisibilityRow[] = [
  buildKeywordRow({
    keyword: 'beta',
    kpis: buildKpis({
      visibility_score: 10,
      average_position: 3,
    }),
  }),
  buildKeywordRow({
    keyword: 'Alpha',
    kpis: buildKpis({
      visibility_score: 70,
      average_position: null,
    }),
  }),
  KEYWORD_WITHOUT_DATA,
  buildKeywordRow({
    keyword: 'gamma',
    kpis: buildKpis({
      visibility_score: 40,
      average_position: 1.5,
    }),
  }),
];
