/**
 * The scoped-response examples of `test-fixtures/scope-snapshots/` (one file per route), shared with the
 * Python suite `lambda/shared/test_scope_snapshot_fixtures.py`, which pins them to the backend helpers.
 */
import brandMentionsAppearances from '../../../../test-fixtures/scope-snapshots/brand-mentions-appearances.json';
import brandMentions from '../../../../test-fixtures/scope-snapshots/brand-mentions.json';
import citationGaps from '../../../../test-fixtures/scope-snapshots/citation-gaps.json';
import citations from '../../../../test-fixtures/scope-snapshots/citations.json';
import contentStudioIdeas from '../../../../test-fixtures/scope-snapshots/content-studio-ideas.json';
import groupKpisKeywords from '../../../../test-fixtures/scope-snapshots/group-kpis-keywords.json';
import groupKpis from '../../../../test-fixtures/scope-snapshots/group-kpis.json';
import promptInsights from '../../../../test-fixtures/scope-snapshots/prompt-insights.json';
import recommendations from '../../../../test-fixtures/scope-snapshots/recommendations.json';
import reportsCompetitor from '../../../../test-fixtures/scope-snapshots/reports-competitor.json';
import reportsInsights from '../../../../test-fixtures/scope-snapshots/reports-insights.json';
import reportsOverview from '../../../../test-fixtures/scope-snapshots/reports-overview.json';
import sentimentExamples from '../../../../test-fixtures/scope-snapshots/sentiment-examples.json';
import statsMarket from '../../../../test-fixtures/scope-snapshots/stats-market.json';
import trends from '../../../../test-fixtures/scope-snapshots/trends.json';
import visibility from '../../../../test-fixtures/scope-snapshots/visibility.json';

/** One example response of a route. */
interface ScopeFixtureCase {
  description: string;
  status: number;
  body: unknown;
}

/** One route's examples by case: `complete`, `live`, `stale`, `computing`, `failed`, and per route `partial`, `page`, `cursor_expired`. */
interface ScopeFixtureDocument {
  route: string;
  cases: Record<string, ScopeFixtureCase>;
}

const DOCUMENTS: Record<string, ScopeFixtureDocument> = {
  'brand-mentions-appearances': brandMentionsAppearances,
  'brand-mentions': brandMentions,
  'citation-gaps': citationGaps,
  citations,
  'content-studio-ideas': contentStudioIdeas,
  'group-kpis-keywords': groupKpisKeywords,
  'group-kpis': groupKpis,
  'prompt-insights': promptInsights,
  recommendations,
  'reports-competitor': reportsCompetitor,
  'reports-insights': reportsInsights,
  'reports-overview': reportsOverview,
  'sentiment-examples': sentimentExamples,
  'stats-market': statsMarket,
  trends,
  visibility,
};

/** The scoped `200` bodies (the cases that carry `coverage` and the source envelope). */
const SCOPED_CASES: ReadonlySet<string> = new Set(['complete', 'live', 'stale', 'partial', 'page']);

/** `[route file, case, body]` of every example whose case name is in `cases`. */
export function fixtureBodies(cases: ReadonlySet<string>): Array<[string, string, unknown]> {
  return Object.entries(DOCUMENTS).flatMap(([name, document]) => Object.entries(document.cases)
    .filter(([caseName]) => cases.has(caseName))
    .map(([caseName, example]): [string, string, unknown] => [name, caseName, example.body]));
}

export const scopedBodies = fixtureBodies(SCOPED_CASES);
export const computingBodies = fixtureBodies(new Set(['computing']));
export const failedBodies = fixtureBodies(new Set(['failed']));
export const cursorExpiredBodies = fixtureBodies(new Set(['cursor_expired']));

/** `[route file, case, coverage]` of every scoped body (`undefined` when a body has none). */
export const scopedCoverages = scopedBodies.map(([route, caseName, body]): [string, string, unknown] => [
  route, caseName, typeof body === 'object' && body !== null ? Reflect.get(body, 'coverage') : undefined,
]);

/** One route's example body; throws when the route or case has none (a fixture file was renamed). */
export function fixtureBody(route: string, caseName: string): unknown {
  if (!(route in DOCUMENTS) || !(caseName in DOCUMENTS[route].cases)) {
    throw new RangeError(`no ${caseName} example for ${route}`);
  }
  return DOCUMENTS[route].cases[caseName].body;
}
