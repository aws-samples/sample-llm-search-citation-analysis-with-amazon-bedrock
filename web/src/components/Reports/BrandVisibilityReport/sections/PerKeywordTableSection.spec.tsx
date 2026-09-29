import {
  describe, it, expect,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import type { KeywordTrend } from '../../../../types';
import { expectRendersNothing } from '../../../../test/renderNothing';
import {
  PerKeywordTableSection, PERIODS_INFO
} from './PerKeywordTableSection';
import {
  buildKeywordTrend, movingKeyword, trendViewOf
} from '../../layout/reportPayload-fixtures';
import {
  headerTooltips, sectionTable, tableRow
} from '../../layout/reportQueries-fixtures';
import {
  KPI_DEFINITIONS, TREND_DEFINITION
} from '../../../../constants/kpiDefinitions';

const TITLE = 'Per-keyword leaderboard';

function renderTable(rows: KeywordTrend[]): void {
  render(<PerKeywordTableSection trends={trendViewOf(rows)} loading={false} error={null} />);
}

describe('PerKeywordTableSection columns', () => {
  it('heads the table with the keyword, its visibility score, change and trend, the periods compared and two rates', () => {
    renderTable([buildKeywordTrend('shoes')]);

    expect(sectionTable(TITLE)[0]).toStrictEqual([
      'Keyword', 'Visibility score', 'Visibility change', 'Trend', 'Periods', 'Mention rate', 'Share of voice',
    ]);
  });

  it('writes a keyword that moved with its score, change, trend and the two periods compared', () => {
    renderTable([movingKeyword('shoes', 3, 'improving', 62)]);

    expect(sectionTable(TITLE)[1]).toStrictEqual(['shoes', '62.0', '+3.0 pts', 'improving', '2026-09-01 → 2026-09-08', '60.0%', '25.0%']);
  });

  it('writes a keyword without an earlier period with dashes for its change and trend', () => {
    renderTable([buildKeywordTrend('new')]);

    expect(sectionTable(TITLE)[1]).toStrictEqual(['new', '52.4', '—', '—', '2026-09-08', '60.0%', '25.0%']);
  });

  it('keeps the API order of the keywords, best visibility score first', () => {
    renderTable([movingKeyword('high', 0, 'stable', 80), movingKeyword('low', 0, 'stable', 20), movingKeyword('mid', 0, 'stable', 50)]);

    expect(sectionTable(TITLE).slice(1).map(([keyword]) => keyword)).toStrictEqual(['high', 'low', 'mid']);
  });
});

describe('PerKeywordTableSection tooltips', () => {
  it('explains the visibility change and the trend with the trend rule', () => {
    renderTable([buildKeywordTrend('shoes')]);

    expect(headerTooltips(TITLE).slice(1, 3)).toStrictEqual([
      ['Visibility change', TREND_DEFINITION.definition],
      ['Trend', TREND_DEFINITION.definition],
    ]);
  });

  it('explains which periods are compared', () => {
    renderTable([buildKeywordTrend('shoes')]);

    expect(headerTooltips(TITLE)[3]).toStrictEqual(['Periods', PERIODS_INFO]);
  });

  it('explains each KPI column with its definition', () => {
    renderTable([buildKeywordTrend('shoes')]);

    expect([headerTooltips(TITLE)[0], ...headerTooltips(TITLE).slice(4)]).toStrictEqual(
      (['visibility_score', 'mention_rate', 'share_of_voice'] as const).map((id) => [KPI_DEFINITIONS[id].label, KPI_DEFINITIONS[id].definition]),
    );
  });
});

describe('PerKeywordTableSection mover highlight', () => {
  it.each([
    ['an improving', 'bg-emerald-50 dark:bg-emerald-950/20', movingKeyword('k', 2, 'improving')],
    ['a declining', 'bg-red-50 dark:bg-red-950/20', movingKeyword('k', -2, 'declining')],
    ['a stable', '', movingKeyword('k', 1.9, 'stable')],
    ['no', '', buildKeywordTrend('k')],
  ])('gives the row of a keyword with %s visibility trend the class "%s"', (_label, tint, row) => {
    renderTable([row]);

    expect(tableRow(TITLE, 'k').className).toBe(tint);
  });
});

describe('PerKeywordTableSection states', () => {
  it('drops out of the report when there is no keyword', () => {
    expectRendersNothing(<PerKeywordTableSection trends={trendViewOf([])} loading={false} error={null} />);
  });

  it('shows the loading state', () => {
    render(<PerKeywordTableSection trends={null} loading error={null} />);

    expect(screen.getByText('Loading per-keyword rankings…')).toBeInTheDocument();
  });

  it('shows the error', () => {
    render(<PerKeywordTableSection trends={null} loading={false} error="Network down" />);

    expect(screen.getByText('Network down')).toBeInTheDocument();
  });
});
