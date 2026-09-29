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
  SORTABLE_KEYWORD_ROWS, ariaSortValues, bodyRowCells, clickButtonsInTurn, firstColumnCells, sortButtonLabels
} from './visibilityTables-fixtures';
import { KPI_DEFINITIONS } from '../../constants/kpiDefinitions';
import { buildKpis } from '../Reports/BrandVisibilityReport/groupKpiHistory-fixtures';

const TABLE_NAME = 'Keywords in this scope';
const NO_DATA = 'hotel sol beachNo analysis data yet';

describe('KeywordVisibilityTable', () => {
  it('heads the keyword column then the six KPI columns, sorted by visibility score first', () => {
    render(<KeywordVisibilityTable rows={[buildKeywordRow()]} />);

    expect(sortButtonLabels(screen.getByRole('table', { name: TABLE_NAME }))).toStrictEqual([
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
    render(<KeywordVisibilityTable rows={[buildKeywordRow()]} />);

    const {
      label, definition
    } = KPI_DEFINITIONS[id];

    expect(screen.getByRole('button', { name: `About ${label}` })).toHaveAccessibleDescription(definition);
  });

  it('formats every KPI of an analysed keyword by its unit', () => {
    render(<KeywordVisibilityTable rows={[buildKeywordRow()]} />);

    expect(bodyRowCells(screen.getByRole('table', { name: TABLE_NAME }))).toStrictEqual([
      ['hotel sol spa', '60.0%', '25.0%', '52.4', '1.80', '30.0%', '20'],
    ]);
  });

  it('shows dashes and a hint for a keyword without analysis data', () => {
    render(<KeywordVisibilityTable rows={[KEYWORD_WITHOUT_DATA]} />);

    expect(bodyRowCells(screen.getByRole('table', { name: TABLE_NAME }))).toStrictEqual([
      [NO_DATA, '—', '—', '—', '—', '—', '—'],
    ]);
  });

  it('says the scope has no keywords when there are no rows', () => {
    render(<KeywordVisibilityTable rows={[]} />);

    expect(firstColumnCells(screen.getByRole('table', { name: TABLE_NAME }))).toStrictEqual(['No keywords in this scope.']);
  });

  it.each([
    ['visibility score highest first, unknown scores last', [], ['Alpha', 'gamma', 'beta', NO_DATA]],
    ['visibility score lowest first after a second click, unknown scores last', ['Visibility score'], ['beta', 'gamma', 'Alpha', NO_DATA]],
    ['average position best first, unplaced keywords last', ['Average position'], ['gamma', 'beta', 'Alpha', NO_DATA]],
    ['average position worst first after a second click, unplaced keywords last', ['Average position', 'Average position'], ['beta', 'gamma', 'Alpha', NO_DATA]],
    ['keyword A to Z ignoring case', ['Keyword'], ['Alpha', 'beta', 'gamma', NO_DATA]],
    ['keyword Z to A after a second click', ['Keyword', 'Keyword'], [NO_DATA, 'gamma', 'beta', 'Alpha']],
  ])('orders rows by %s', async (_order, clicks, expected) => {
    render(<KeywordVisibilityTable rows={SORTABLE_KEYWORD_ROWS} />);

    await clickButtonsInTurn(clicks);

    expect(firstColumnCells(screen.getByRole('table', { name: TABLE_NAME }))).toStrictEqual(expected);
  });

  it('sorts a count highest first when it is picked', async () => {
    render(<KeywordVisibilityTable rows={[buildKeywordRow({ keyword: 'few answers' }), buildKeywordRow({
      keyword: 'many answers',
      kpis: buildKpis({ answers: 99 }),
    })]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Answers' }));

    expect(firstColumnCells(screen.getByRole('table', { name: TABLE_NAME }))).toStrictEqual(['many answers', 'few answers']);
  });

  it('announces the active sort column and direction', async () => {
    render(<KeywordVisibilityTable rows={SORTABLE_KEYWORD_ROWS} />);

    await userEvent.click(screen.getByRole('button', { name: 'Average position' }));

    expect(ariaSortValues(screen.getByRole('table', { name: TABLE_NAME }))).toStrictEqual([
      'none', 'none', 'none', 'none', 'ascending', 'none', 'none',
    ]);
  });
});
