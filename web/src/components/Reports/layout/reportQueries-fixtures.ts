import {
  screen, within
} from '@testing-library/react';
import {
  KPI_DEFINITIONS, VISIBILITY_DEFINITIONS, type KpiId
} from '../../../constants/kpiDefinitions';

/** What the definitions block of every visibility report lists: each KPI, then the trend rule. */
export const VISIBILITY_DEFINITION_TERMS = VISIBILITY_DEFINITIONS.map((entry) => entry.label);

/**
 * DOM queries over a rendered report: its sections, headline cards, tables
 * and tooltips. Every report section is a `<section>` headed by an `<h2>`
 * (`ReportSection`); every headline card is a `ReportStatCard`.
 */

class MissingSectionError extends Error {
  constructor(title: string) {
    super(`No report section titled ${title}`);
    this.name = 'MissingSectionError';
  }
}

class MissingStatCardError extends Error {
  constructor(label: string) {
    super(`No stat card for ${label}`);
    this.name = 'MissingStatCardError';
  }
}

/** The report section headed `title`. */
export function sectionTitled(title: string): HTMLElement {
  const section = screen.getByRole('heading', { name: title }).closest('section');
  if (section === null) throw new MissingSectionError(title);
  return section;
}

function cardOf(element: HTMLElement, label: string): HTMLElement {
  const card = element.closest('div');
  if (card === null) throw new MissingStatCardError(label);
  return card;
}

/**
 * The headline card whose tooltip explains `label`. The KPI table under the
 * cards explains the same KPI again, so the card is the first such tooltip.
 */
export function statCard(label: string): HTMLElement {
  const [tooltip] = within(sectionTitled('Headline')).getAllByRole('button', { name: `About ${label}` });
  return cardOf(tooltip, label);
}

/** The headline card captioned `label` that has no tooltip, such as a keyword count. */
export function plainStatCard(label: string): HTMLElement {
  return cardOf(within(sectionTitled('Headline')).getByText(label, { selector: 'p' }), label);
}

/** The figure of a stat card. */
export function cardFigure(card: HTMLElement): HTMLElement {
  return within(card).getAllByText(/./, { selector: 'p' })[1];
}

/** The footnote under the figure of a stat card. */
export function cardFootnote(card: HTMLElement): string | null {
  return within(card).getAllByText(/./, { selector: 'p' })[2].textContent;
}

/** The headline figure element of the card explained as `label`. */
export function statFigure(label: string): HTMLElement {
  return cardFigure(statCard(label));
}

/** The footnote under the figure of the card explained as `label`. */
export function statFootnote(label: string): string | null {
  return cardFootnote(statCard(label));
}

/** The caption of every headline card, left to right. */
export function headlineCardLabels(): (string | null)[] {
  const grid = statCard('Mention rate').parentElement;
  return [...grid?.children ?? []].map((card) => card.querySelector('p')?.firstChild?.textContent ?? null);
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

/** What `headerTooltips` reads for KPI columns headed by their label: each KPI's label and definition, in the order given. */
export function kpiColumnTooltips(...ids: readonly KpiId[]): string[][] {
  return ids.map((id) => [KPI_DEFINITIONS[id].label, KPI_DEFINITIONS[id].definition]);
}

class MissingRowError extends Error {
  constructor(title: string, name: string) {
    super(`No row ${name} in the table of ${title}`);
    this.name = 'MissingRowError';
  }
}

/** The body row of the table in the section headed `title` whose first cell reads `name`. */
export function tableRow(title: string, name: string): HTMLElement {
  const row = within(sectionTitled(title)).getByRole('cell', { name }).closest('tr');
  if (row === null) throw new MissingRowError(title, name);
  return row;
}


/** The title of every report section, top to bottom. */
export function sectionTitles(): string[] {
  return [...document.querySelectorAll('section h2')].map((heading) => heading.textContent ?? '');
}

/** Every term of the definitions block, in order (the block is collapsed on screen, so hidden terms count). */
export function definitionTerms(): string[] {
  return within(sectionTitled('How these KPIs are measured')).getAllByRole('term', { hidden: true }).map((term) => term.textContent ?? '');
}

/** Every definition of the definitions block, in order (collapsed ones included). */
export function definitionTexts(): string[] {
  return within(sectionTitled('How these KPIs are measured')).getAllByRole('definition', { hidden: true }).map((entry) => entry.textContent ?? '');
}


class MissingColumnError extends Error {
  constructor(title: string) {
    super(`No mover column titled ${title}`);
    this.name = 'MissingColumnError';
  }
}

/** The movers column (`MoverColumn`) headed `title`. */
export function moverColumn(title: string): HTMLElement {
  const column = screen.getByRole('heading', { name: title }).closest('div');
  if (column === null) throw new MissingColumnError(title);
  return column;
}

/** Each keyword of the movers column headed `title`, top to bottom. */
export function moverKeywords(title: string): (string | null)[] {
  return within(moverColumn(title)).queryAllByRole('listitem').map((item) => item.firstChild?.textContent ?? null);
}


/** The tooltip text of the headline card explained as `label`. */
export function statCardInfo(label: string): string | null {
  return tooltipText(within(statCard(label)).getByRole('button'));
}
