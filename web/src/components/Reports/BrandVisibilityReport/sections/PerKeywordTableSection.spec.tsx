import {
  describe, it, expect,
} from 'vitest';
import { render } from '@testing-library/react';
import type { KeywordTrend } from '../../../../types';
import { PerKeywordTableSection } from './PerKeywordTableSection';
import {
  buildKeywordTrend, movingKeyword, trendViewOf
} from '../../layout/reportPayload-fixtures';
import {
  headerTooltips, kpiColumnTooltips, sectionTable, tableRow
} from '../../layout/reportQueries-fixtures';
import { settledTrends } from '../../layout/reportSlice-fixtures';
import { TREND_DEFINITION } from '../../../../constants/kpiDefinitions';

const TITLE = 'Per-keyword leaderboard';

function renderTable(rows: KeywordTrend[]): void {
  render(<PerKeywordTableSection {...settledTrends(trendViewOf(rows))} />);
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

    expect(headerTooltips(TITLE)[3]).toStrictEqual([
      'Periods', 'The keyword\'s latest period with data, and the previous one its change is measured against.',
    ]);
  });

  it('explains each KPI column with its definition', () => {
    renderTable([buildKeywordTrend('shoes')]);

    expect([headerTooltips(TITLE)[0], ...headerTooltips(TITLE).slice(4)]).toStrictEqual(kpiColumnTooltips('visibility_score', 'mention_rate', 'share_of_voice'));
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
