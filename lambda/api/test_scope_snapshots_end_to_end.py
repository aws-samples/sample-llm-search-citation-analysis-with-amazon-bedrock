"""End to end (design 2.45.0 §5): the real writer, the real build and the real handlers answer every large scope completely.

One generated tenant (40 keywords, 2 personas x 4 engines, 3 daily runs, a
16-keyword group, 3 markets) is written through the Deduplication writer
(KeywordRunKpis, KeywordRunBrands, KeywordLatest), the scope snapshots are
built (and the citation rollup, row 16), and every route of design §1
rows 1-14 and 16 is asked for ``scope=all``, the large group and a market
(row 17, GenerateInsights, is ``report-insights/test_report_insights_end_to_end.py``). The live budget is lowered so those scopes are
served from the snapshot (or a view job); the oracle is the same handler with
the budget raised, which reads every keyword live (no keyword cap since
2.45.0). Every answer must equal the oracle, cover every keyword
(``coverage.complete``) and never say ``keywords_truncated``.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
from unittest.mock import patch

import pytest

from shared.citation_rollup import BUILD_ACTION as CITATION_ROLLUP_ACTION
from shared.citation_rollup import REBUILD_MARKER_KEY as CITATION_REBUILD_MARKER
from shared.citation_rollup_serve import RollupReader
from shared.prompt_classification import LIST_KEYS
from shared.scope_snapshot import SNAPSHOT_PREFIX
from testing.end_to_end_tenant import FUNCTION_NAME, EndToEndTenant, built_tenant, without_envelope
from testing.scale_data import BRAND_CONFIG, ScaleSpec, group_id, keyword_text, market_id
from testing.scope_snapshot_fixtures import SNAPSHOT_BUCKET

SPEC = ScaleSpec()

SCOPES: Mapping[str, dict[str, str]] = {
    'scope=all': {'scope': 'all'},
    'large group': {'group_id': group_id(0)},
    'market': {'market_id': market_id(0)},
}


@dataclass(frozen=True)
class Route:
    """One route of design §1: its handler, its path, the query it is asked with and what its answers may differ in."""

    name: str
    handler: str
    path: str
    query: Mapping[str, str]
    volatile: tuple[str, ...] = ()
    """Fields that say when or how to page, not what (``since`` moves with the clock, tokens name builds)."""
    scopes: tuple[str, ...] = tuple(SCOPES)


_TOKENS = (
    'next_token', 'keywords_next_token', 'keyword_trends_next_token', 'keyword_summaries_next_token',
    'brands_next_token', 'sources_next_token', 'latest_brands_next_token', 'gaps_next_token',
    'outranked_keywords_next_token', 'outreach_targets_next_token', 'pages_next_token', 'keywords_next_token',
)

ROUTES = [
    Route('visibility', 'get-visibility-metrics.py', '/api/visibility', {}, _TOKENS),
    Route('sentiment-examples', 'get-sentiment-examples.py', '/api/visibility/sentiment-examples', {'sentiment': 'positive'}, _TOKENS),
    Route('brand-mentions', 'get-brand-mentions.py', '/api/brand-mentions', {}, _TOKENS),
    Route('brand-mentions-appearances', 'get-brand-mentions.py', '/api/brand-mentions', {'view': 'appearances'}, _TOKENS),
    Route('trends', 'get-historical-trends.py', '/api/trends', {}, ('since', *_TOKENS)),
    Route('reports-overview', 'get-reports-overview.py', '/api/reports/overview', {}),
    Route('group-kpis', 'get-group-kpi-history.py', '/api/reports/group-kpis', {'days': '30'}, ('since', *_TOKENS)),
    Route('group-kpis-drivers', 'get-group-kpi-history.py', '/api/reports/group-kpis', {'days': '30', 'view': 'drivers'}, ('since', *_TOKENS)),
    Route('reports-insights', 'get-reports-insights.py', '/api/reports/insights', {}),
    Route('reports-competitor', 'get-reports-competitor.py', '/api/reports/competitor', {}, _TOKENS),
    Route('citation-gaps', 'get-citation-gaps.py', '/api/citation-gaps', {}, _TOKENS),
    Route('prompt-insights', 'get-prompt-insights.py', '/api/prompt-insights', {}, tuple(f'{key}_next_token' for key in LIST_KEYS.values())),
    Route('recommendations', 'get-recommendations.py', '/api/recommendations', {}, _TOKENS),
    Route('content-studio-ideas', 'content-studio.py', '/api/content-studio/ideas', {}, ('next_token', 'ideas_next_token')),
    # total_crawled: a snapshot's crawled count is recounted only every CRAWLED_RECOUNT_DAYS (PERF-6,
    # shared.keyword_counts), so over three daily runs it lags the live COUNT by design.
    Route('stats-market', 'get-stats.py', '/api/stats', {}, ('timestamp', 'total_crawled'), scopes=('market',)),
]

CASES = [(route, scope) for route in ROUTES for scope in route.scopes]

#: Design §1 row 16: served from the citation rollup (no ``coverage``; ``source: rollup``).
CITATIONS = Route('citations', 'get-citations.py', '/api/citations', {}, ('next_token', 'matched_urls', 'top_urls'))


def _without_ids(value: Any) -> Any:
    """Content ideas get a fresh id per request: compared without it."""
    if isinstance(value, list):
        return [_without_ids(item) for item in value]
    if isinstance(value, dict):
        return {key: _without_ids(item) for key, item in value.items() if key != 'id'}
    return value


def _without_keys(value: Any, keys: tuple[str, ...]) -> Any:
    """``value`` without the fields ``keys`` at any depth (a cursor nested in a list item names its build too)."""
    if isinstance(value, list):
        return [_without_keys(item, keys) for item in value]
    if isinstance(value, dict):
        return {key: _without_keys(item, keys) for key, item in value.items() if key not in keys}
    return value


def _comparable(route: Route, body: Mapping[str, Any]) -> Any:
    kept = _without_keys(without_envelope(dict(body)), route.volatile)
    return _without_ids(kept) if route.name == 'content-studio-ideas' else kept


@pytest.fixture(scope='module')
def tenant() -> EndToEndTenant:
    return built_tenant(SPEC)


#: View jobs one answer may wait for in turn (the overview: its trend job, then its recommendations job).
_JOB_HOPS = 2


def answered(tenant: EndToEndTenant, route: Route, query: Mapping[str, str]) -> tuple[int, dict[str, Any]]:
    """The route's answer once the view jobs it started have run (202, job, the same GET again, as a client polls)."""
    status, body = tenant.call(route.handler, route.path, query)
    for _ in range(_JOB_HOPS):
        if status != 202:
            break
        tenant.run_jobs()
        status, body = tenant.call(route.handler, route.path, query)
    return status, body


def _query(route: Route, scope: str, **extra: str) -> dict[str, str]:
    return {**SCOPES[scope], **route.query, **extra}


def first_served_and_live(tenant: EndToEndTenant, route: Route, query: Mapping[str, str]) -> tuple[int, Any, Any]:
    """The first GET's status, then the answer once its view job ran and the live answer, both comparable."""
    first_status, _first = tenant.call(route.handler, route.path, query)
    _status, served = answered(tenant, route, query)
    _live_status, live = tenant.call_live(route.handler, route.path, query)
    return first_status, _comparable(route, served), _comparable(route, live)


class TestBuild:
    def test_every_builder_wrote_its_artifacts(self, tenant):
        assert (tenant.last_build['status'], tenant.last_build['skipped_artifacts']) == ('built', [])

    def test_every_keyword_latest_object_was_folded(self, tenant):
        assert tenant.last_build['keyword_latest_found'] == SPEC.keywords

    def test_scope_all_the_large_group_and_every_market_are_built(self, tenant):
        current = json.loads(tenant.bucket.objects[f'{SNAPSHOT_PREFIX}current.json'][0])
        expected = {'all', f'group:{group_id(0)}', *(f'market:{market_id(index)}' for index in range(SPEC.markets))}
        assert expected <= set(current['scopes'])


@pytest.mark.parametrize(('route', 'scope'), CASES, ids=[f'{route.name}-{scope}' for route, scope in CASES])
class TestEveryRouteEveryLargeScope:
    def test_answers_200_from_the_snapshot(self, tenant, route, scope):
        status, body = answered(tenant, route, _query(route, scope))
        assert (status, body['source']) == (200, 'snapshot')

    def test_covers_every_keyword_of_the_scope(self, tenant, route, scope):
        _status, body = answered(tenant, route, _query(route, scope))
        assert (body['coverage']['complete'], body.get('keywords_truncated', False)) == (True, False)

    def test_equals_the_uncapped_live_answer(self, tenant, route, scope):
        _first_status, served, live = first_served_and_live(tenant, route, _query(route, scope))
        assert served == live


def drain(call: Callable[[str | None], Mapping[str, Any]], items: str, token: str = 'next_token') -> list[Any]:
    """Every item of a paged list: the first page, then each ``token`` until there is none."""
    page = call(None)
    collected = list(page[items])
    for _ in range(1_000):
        next_token = page.get(token)
        if not next_token:
            return collected
        page = call(next_token)
        collected.extend(page[items])
    raise AssertionError(f'{items}: more than 1,000 pages')


@dataclass(frozen=True)
class PagedList:
    """A paged list of a route: the page size asked, the list field, the oracle's whole-list query."""

    route: Route
    items: str
    page: Mapping[str, str]
    whole: Mapping[str, str]
    token: str = 'next_token'


PAGED = [
    PagedList(ROUTES[12], 'recommendations', {'limit': '5'}, {'limit': '200'}),
    PagedList(ROUTES[10], 'keyword_summaries', {'limit': '5'}, {'limit': '100'}),
    PagedList(ROUTES[3], 'appearances', {'limit': '25'}, {'limit': '2000'}),
    PagedList(ROUTES[1], 'examples', {'limit': '3'}, {'limit': '50'}),
]


@pytest.mark.parametrize('listed', PAGED, ids=[listed.items for listed in PAGED])
def test_snapshot_pages_concatenate_to_the_whole_live_list(tenant, listed):
    route = listed.route

    def page(token: str | None) -> Mapping[str, Any]:
        _status, body = answered(tenant, route, _query(route, 'scope=all', **listed.page, **({'next_token': token} if token else {})))
        return body

    whole = drain(lambda token: tenant.call_live(route.handler, route.path, _query(route, 'scope=all', **listed.whole, **({'next_token': token} if token else {})))[1], listed.items, listed.token)
    assert drain(page, listed.items, listed.token) == whole


# ---------------------------------------------------------------------------
# 202, the view job, then 200: one parameter no build precomputes, per route kind
# ---------------------------------------------------------------------------

NON_PRESET = [
    (ROUTES[4], {'days': '45'}),
    (ROUTES[6], {'days': '45'}),
    (ROUTES[7], {'days': '45'}),
    (ROUTES[8], {'days': '45'}),
]


@pytest.mark.parametrize(('route', 'extra'), NON_PRESET, ids=[f'{route.name}-days-45' for route, _ in NON_PRESET])
class TestViewJobOfAWindowNoBuildHolds:
    def test_the_first_get_answers_202_computing(self, tenant, route, extra):
        status, body = tenant.call(route.handler, route.path, _query(route, 'large group', **extra))
        assert (status, body['status']) == (202, 'computing')

    def test_after_the_job_the_same_get_equals_the_live_answer(self, tenant, route, extra):
        _first_status, served, live = first_served_and_live(tenant, route, _query(route, 'large group', **extra))
        assert served == live


def test_an_older_run_of_a_large_scope_is_a_view_job_equal_to_the_live_answer(tenant):
    first_status, served, live = first_served_and_live(tenant, ROUTES[2], _query(ROUTES[2], 'scope=all', timestamp=tenant.run_timestamp(0)))
    assert (first_status, served) == (202, live)


@pytest.fixture
def no_build(tenant):
    """The bucket without its pointer for the test: no build holds any scope."""
    key = f'{SNAPSHOT_PREFIX}current.json'
    saved = tenant.bucket.objects.pop(key)
    yield tenant
    tenant.bucket.objects[key] = saved


#: Every route a build serves (``/stats`` reads a market live when no build holds it), each asking its own view job
#: (the drivers of group-kpis share the summary's job: one job's artifacts answer every view of a window).
JOB_ROUTES = [route for route in ROUTES if route.name not in ('stats-market', 'group-kpis-drivers')]


@pytest.mark.parametrize('route', JOB_ROUTES, ids=[route.name for route in JOB_ROUTES])
def test_without_a_build_every_route_is_a_view_job_equal_to_the_live_answer(no_build, route):
    first_status, served, live = first_served_and_live(no_build, route, _query(route, 'scope=all'))
    assert (first_status, served) == (202, live)


def test_group_kpi_drivers_without_a_build_are_served_from_the_summary_view_job(no_build):
    summary, drivers = ROUTES[[route.name for route in ROUTES].index('group-kpis')], ROUTES[[route.name for route in ROUTES].index('group-kpis-drivers')]
    first_served_and_live(no_build, summary, _query(summary, 'scope=all'))
    jobs_before = len(no_build.view_jobs())

    first_status, served, live = first_served_and_live(no_build, drivers, _query(drivers, 'scope=all'))

    assert (first_status, served, len(no_build.view_jobs())) == (200, live, jobs_before)


# ---------------------------------------------------------------------------
# Staleness: a membership change and a brand-config change
# ---------------------------------------------------------------------------

@pytest.fixture
def fresh_debounce(tenant):
    """No rebuild requested yet in this test (the debounce marker and the recorded calls cleared)."""
    tenant.bucket.objects.pop(f'{SNAPSHOT_PREFIX}rebuild-requested.json', None)
    tenant.bucket.objects.pop(CITATION_REBUILD_MARKER, None)
    tenant.invoked.invocations.clear()
    citations = tenant.handler(CITATIONS.handler)
    reader = RollupReader(tenant.bucket, SNAPSHOT_BUCKET, lambda_client=tenant.invoked, function_name=FUNCTION_NAME)
    with patch.object(citations, 'rollup_reader', reader):
        yield tenant


@pytest.fixture
def grown_group(fresh_debounce):
    """A keyword outside the large group joins it for the test."""
    table = fresh_debounce.table('e2e-keywords')
    joining = next(row for row in table.rows.values() if row['keyword'] == keyword_text(SPEC.keywords - 1))
    before = set(joining.get('group_ids') or set())
    joining['group_ids'] = {*before, group_id(0)}
    yield fresh_debounce
    joining['group_ids'] = before


@pytest.fixture
def edited_brand_config(fresh_debounce):
    """The brand config saved again after the build."""
    fresh_debounce.brand_config['updated_at'] = '2099-01-01T00:00:00Z'
    yield fresh_debounce
    fresh_debounce.brand_config['updated_at'] = BRAND_CONFIG['updated_at']


def _stale_answers(tenant: EndToEndTenant, query: Mapping[str, str], times: int = 3) -> list[tuple[bool, bool]]:
    route = ROUTES[0]
    return [(body['stale'], body['refreshing']) for _status, body in (tenant.call(route.handler, route.path, query) for _ in range(times))]


def test_a_membership_change_serves_the_build_as_stale_and_refreshing(grown_group):
    assert _stale_answers(grown_group, SCOPES['large group']) == [(True, True)] * 3


def test_a_membership_change_requests_one_rebuild_however_often_it_is_read(grown_group):
    _stale_answers(grown_group, SCOPES['large group'])
    assert len(grown_group.rebuild_requests()) == 1


def test_a_brand_config_change_serves_the_build_as_stale_and_refreshing(edited_brand_config):
    assert _stale_answers(edited_brand_config, SCOPES['scope=all']) == [(True, True)] * 3


def test_a_brand_config_change_requests_one_rebuild_however_often_it_is_read(edited_brand_config):
    _stale_answers(edited_brand_config, SCOPES['scope=all'])
    assert len(edited_brand_config.rebuild_requests()) == 1



# ---------------------------------------------------------------------------
# Row 16: /citations from the citation rollup, and a stale large scope
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('scope', list(SCOPES))
class TestCitationsOfEveryLargeScope:
    def test_answers_from_the_current_rollup(self, tenant, scope):
        _status, body = tenant.call(CITATIONS.handler, CITATIONS.path, _query(CITATIONS, scope))
        assert (body['source'], body['stale'], body['truncated']) == ('rollup', False, False)

    def test_totals_equal_the_live_read(self, tenant, scope):
        _status, served = tenant.call(CITATIONS.handler, CITATIONS.path, _query(CITATIONS, scope))
        _live_status, live = tenant.call_live(CITATIONS.handler, CITATIONS.path, _query(CITATIONS, scope))
        assert _comparable(CITATIONS, served) == _comparable(CITATIONS, live)

    def test_pages_concatenate_to_the_whole_live_list(self, tenant, scope):
        def page(token: str | None) -> Mapping[str, Any]:
            return tenant.call(CITATIONS.handler, CITATIONS.path, _query(CITATIONS, scope, limit='7', **({'next_token': token} if token else {})))[1]

        whole = tenant.call_live(CITATIONS.handler, CITATIONS.path, _query(CITATIONS, scope, limit='1000'))[1]
        assert (drain(page, 'top_urls'), whole['next_token']) == (whole['top_urls'], None)


def _citation_answers(tenant: EndToEndTenant, query: Mapping[str, str], times: int = 3) -> list[tuple[str, bool, bool]]:
    return [
        (body['source'], body['stale'], body.get('refreshing', False))
        for _status, body in (tenant.call(CITATIONS.handler, CITATIONS.path, query) for _ in range(times))
    ]


def test_citations_of_a_grown_large_group_serve_the_stale_rollup_while_it_rebuilds(grown_group):
    assert _citation_answers(grown_group, SCOPES['large group']) == [('rollup', True, True)] * 3


def test_citations_of_a_grown_large_group_request_one_rollup_rebuild(grown_group):
    _citation_answers(grown_group, SCOPES['large group'])
    assert len(grown_group.rebuild_requests(CITATION_ROLLUP_ACTION)) == 1


def test_citations_after_a_brand_config_change_serve_the_stale_rollup_while_it_rebuilds(edited_brand_config):
    assert _citation_answers(edited_brand_config, SCOPES['scope=all']) == [('rollup', True, True)] * 3
