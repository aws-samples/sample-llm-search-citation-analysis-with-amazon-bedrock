import {
  describe, it, expect
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordVisibilityTable } from './KeywordVisibilityTable';
import {
  KEYWORD_WITHOUT_DATA, buildKeywordRow
} from './visibilityOverview-fixtures';
import {
  SORTABLE_KEYWORD_ROWS, aboutButton, ariaSortValues, bodyRowCells, clickButtonsInTurn, firstColumnCells, sortButtonLabels
} from './visibilityTables-fixtures';
import { KPI_DEFINITIONS } from '../../constants/kpiDefinitions';
import { buildKpis } from '../Reports/BrandVisibilityReport/groupKpiHistory-fixtures';
import type { KeywordVisibilityRow } from '../../types';

const NO_DATA = 'hotel sol beachNo analysis data yet';

function renderTable(rows: readonly KeywordVisibilityRow[] = [buildKeywordRow()]) {
  return render(<KeywordVisibilityTable rows={rows} />);
}

/** Renders the sortable rows, then clicks the column buttons named `clicks` in turn. */
async function renderSortedBy(clicks: readonly string[]) {
  renderTable(SORTABLE_KEYWORD_ROWS);
  await clickButtonsInTurn(clicks);
}

function getKeywordTableElement(): HTMLElement {
  return screen.getByRole('table', { name: 'Keywords in this scope' });
}

describe('KeywordVisibilityTable', () => {
  it('heads the keyword column then the six KPI columns, sorted by visibility score first', () => {
    renderTable();

    expect(sortButtonLabels(getKeywordTableElement())).toStrictEqual([
      'Keyword',
      'Mention rate',
      'Share of voice',
      'Visibility score ↓',
      'Average position',
      'Citation rate',
      'Answers',
    ]);
  });

  it.each([
    ['mention_rate'],
    ['share_of_voice'],
    ['visibility_score'],
    ['average_position'],
    ['citation_rate'],
    ['answers'],
  ] as const)('explains the %s column heading with its KPI definition', (id) => {
    renderTable();

    const {
      label, definition
    } = KPI_DEFINITIONS[id];

    expect(aboutButton(label)).toHaveAccessibleDescription(definition);
  });

  it.each([
    ['formats every KPI of an analysed keyword by its unit', buildKeywordRow(), ['hotel sol spa', '60.0%', '25.0%', '52.4', '1.80', '30.0%', '20']],
    ['shows dashes and a hint for a keyword without analysis data', KEYWORD_WITHOUT_DATA, [NO_DATA, '—', '—', '—', '—', '—', '—']],
  ])('%s', (_outcome, row, cells) => {
    renderTable([row]);

    expect(bodyRowCells(getKeywordTableElement())).toStrictEqual([cells]);
  });

  it('says the scope has no keywords when there are no rows', () => {
    renderTable([]);

    expect(firstColumnCells(getKeywordTableElement())).toStrictEqual(['No keywords in this scope.']);
  });

  it.each([
    ['visibility score highest first, unknown scores last', [], ['Alpha', 'gamma', 'beta', NO_DATA]],
    ['visibility score lowest first after a second click, unknown scores last', ['Visibility score'], ['beta', 'gamma', 'Alpha', NO_DATA]],
    ['average position best first, unplaced keywords last', ['Average position'], ['gamma', 'beta', 'Alpha', NO_DATA]],
    ['average position worst first after a second click, unplaced keywords last', ['Average position', 'Average position'], ['beta', 'gamma', 'Alpha', NO_DATA]],
    ['keyword A to Z ignoring case', ['Keyword'], ['Alpha', 'beta', 'gamma', NO_DATA]],
    ['keyword Z to A after a second click', ['Keyword', 'Keyword'], [NO_DATA, 'gamma', 'beta', 'Alpha']],
  ])('orders rows by %s', async (_order, clicks, expected) => {
    await renderSortedBy(clicks);

    expect(firstColumnCells(getKeywordTableElement())).toStrictEqual(expected);
  });

  it('sorts a count highest first when it is picked', async () => {
    renderTable([buildKeywordRow({ keyword: 'few answers' }), buildKeywordRow({
      keyword: 'many answers',
      kpis: buildKpis({ answers: 99 }),
    })]);

    await userEvent.click(screen.getByRole('button', { name: 'Answers' }));

    expect(firstColumnCells(getKeywordTableElement())).toStrictEqual(['many answers', 'few answers']);
  });

  it.each([
    ['falling visibility score by default', [], 'Visibility score ↓'],
    ['rising average position once it is picked', ['Average position'], 'Average position ↑'],
    ['falling average position after a second click', ['Average position', 'Average position'], 'Average position ↓'],
  ])('arrows only the sort column, showing the %s', async (_sort, clicks, label) => {
    await renderSortedBy(clicks);

    expect(sortButtonLabels(getKeywordTableElement()).filter((text) => /[↑↓]$/u.test(text))).toStrictEqual([label]);
  });

  it('gives the keyword column no definition tooltip', () => {
    renderTable();

    expect(screen.queryByRole('button', { name: 'About Keyword' })).not.toBeInTheDocument();
  });

  it.each([
    ['hotel', 'Hotel'],
    ['Hotel', 'hotel'],
  ])('keeps "%s" before "%s" when sorting by keyword, since case is ignored', async (first, second) => {
    renderTable([buildKeywordRow({ keyword: first }), buildKeywordRow({ keyword: second })]);

    await userEvent.click(screen.getByRole('button', { name: 'Keyword' }));

    expect(firstColumnCells(getKeywordTableElement())).toStrictEqual([first, second]);
  });

  it.each([
    ['visibility score falling by default', [], ['none', 'none', 'none', 'descending', 'none', 'none', 'none']],
    ['average position rising once it is picked', ['Average position'], ['none', 'none', 'none', 'none', 'ascending', 'none', 'none']],
  ])('announces the %s as the only sorted column', async (_sort, clicks, expected) => {
    await renderSortedBy(clicks);

    expect(ariaSortValues(getKeywordTableElement())).toStrictEqual(expected);
  });
});
