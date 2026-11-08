import {
  describe, expect, it
} from 'vitest';
import citationGaps from '../../../test-fixtures/scope-snapshots/citation-gaps.json';
import groupKpis from '../../../test-fixtures/scope-snapshots/group-kpis.json';
import recommendations from '../../../test-fixtures/scope-snapshots/recommendations.json';
import reportsCompetitor from '../../../test-fixtures/scope-snapshots/reports-competitor.json';
import trends from '../../../test-fixtures/scope-snapshots/trends.json';
import visibility from '../../../test-fixtures/scope-snapshots/visibility.json';
import { fixtureBody } from '../types/domain/scopeCoverage-fixtures';
import { isKeywordRunSummary } from '../types/domain/groupKpiHistory';
import {
  readListPage, type ListPaging
} from './scopedListPages';
import {
  GAP_SUMMARIES_PAGING,
  GROUP_KPI_KEYWORDS_PAGING,
  isGapSummary,
  isKeywordTrend,
  isKeywordVisibilityRow,
  isOutrankedKeyword,
  isRecommendation,
  KEYWORD_TRENDS_PAGING,
  OUTRANKED_KEYWORDS_PAGING,
  RECOMMENDATIONS_PAGING,
  VISIBILITY_KEYWORD_PAGING,
} from './scopedListPagings';

type RouteCase = readonly [route: string, fixturePaging: ListPaging, paging: ListPaging, isItem: (value: unknown) => value is unknown];

const ROUTES: readonly RouteCase[] = [
  ['visibility', visibility.paging, VISIBILITY_KEYWORD_PAGING, isKeywordVisibilityRow],
  ['trends', trends.paging, KEYWORD_TRENDS_PAGING, isKeywordTrend],
  ['group-kpis', groupKpis.paging, GROUP_KPI_KEYWORDS_PAGING, isKeywordRunSummary],
  ['citation-gaps', citationGaps.paging, GAP_SUMMARIES_PAGING, isGapSummary],
  ['recommendations', recommendations.paging, RECOMMENDATIONS_PAGING, isRecommendation],
  ['reports-competitor', reportsCompetitor.paging, OUTRANKED_KEYWORDS_PAGING, isOutrankedKeyword],
];

describe('scoped list pagings', () => {
  it.each(ROUTES)('matches the paging of the %s fixture', (_route, fixturePaging, paging) => {
    expect({
      list: fixturePaging.list,
      token: fixturePaging.token,
      total: fixturePaging.total,
      view: fixturePaging.view,
    }).toStrictEqual(paging);
  });

  it.each(ROUTES.flatMap((row) => [[...row, 'complete'], [...row, 'page']] as const))(
    'decodes every item of the %s list in its %s case',
    (route, _fixturePaging, paging, isItem, caseName) => {
      const page = readListPage(fixtureBody(route, caseName), paging, isItem, caseName === 'page');

      expect(page?.items.length).toBeGreaterThan(0);
    },
  );

  it.each(ROUTES)('rejects a %s list holding a non-item', (_route, _fixturePaging, paging, isItem) => {
    const body = paging.list.split('.').reduceRight<unknown>((inner, key) => ({ [key]: inner }), [{ keyword: 7 }]);

    expect(readListPage(body, paging, isItem)).toBeNull();
  });
});
