"""Export sources S28-S33 (SEO views of stored data) against a fake SEO router.

The routes' own behaviour (cache-only reads, the Explorer's filters, the rank
order, ``audit_running``) is tested with their handlers in ``lambda/seo/``;
here: which route and parameters each list asks, how rows are shaped as the
tables show them, and that an answer the cache no longer holds fails the
export instead of paying.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared.audit_issues import ISSUE_TYPES
from shared.export_contract import EXPORT_VIEWS, ExportRow
from shared.export_source_routes import ExportSourceError, RouteSource
from shared.export_source_seo_stored import (
    DOMAIN_TABLES,
    KEYWORD_EXPLORER,
    LIGHTHOUSE,
    LOCAL,
    RANK_TRACKING,
    SEO_GEO,
    SITE_AUDIT,
    SOURCES_OF_SEO_STORED,
    issue_detail_text,
    rank_change,
)
from testing.export_source_fixtures import USER, all_rows, resumed_from_every_row
from testing.seo_stored_export_fixtures import (
    AUDIT_ID,
    JOB_ID,
    NOT_CACHED,
    RUN_ID,
    SeoRoutes,
    audit_detail_body,
    audit_issues_answer,
    grid_job_body,
    lighthouse_body,
    local_serp_body,
    over,
    rank_results_body,
    seo_geo_body,
)

_AUDIT = f'/api/seo/audits/{AUDIT_ID}'


def _cells(source: RouteSource, rows: list[ExportRow], *names: str) -> list[tuple[Any, ...]]:
    """The ``names`` cells of every row, by the header of its sheet."""
    headers = {sheet.name: sheet.columns for sheet in source.sheets}
    return [tuple(row.values[headers[row.sheet].index(name)] for name in names) for row in rows]


def _read(source: RouteSource, answers: dict[str, Any], params: dict[str, str]) -> tuple[list[ExportRow], SeoRoutes]:
    routes = SeoRoutes(answers)
    return all_rows(over(source, routes), params), routes


# --- every stored source -------------------------------------------------------------


def test_the_stored_sources_are_the_seven_registered_seo_views():
    assert [source.view for source in SOURCES_OF_SEO_STORED] == [
        'seo-geo', 'seo-rank-tracking', 'seo-site-audit', 'seo-lighthouse', 'seo-local', 'seo-keyword-explorer',
        'seo-domain-tables',
    ]


def test_every_stored_source_is_a_registered_export_view():
    assert {source.view for source in SOURCES_OF_SEO_STORED} <= set(EXPORT_VIEWS)


def test_every_stored_list_but_the_serp_competitors_reads_the_seo_router_with_a_get():
    methods = {
        (route_list.sheet, route_list.router, route_list.method)
        for source in SOURCES_OF_SEO_STORED for route_list in source.lists if route_list.method != 'GET'
    }

    assert methods == {('SERP competitors', 'seo', 'POST')}


# --- S28 SEO vs GEO -------------------------------------------------------------------


def test_seo_geo_keywords_ask_the_report_of_the_market_and_group():
    _rows, routes = _read(SEO_GEO, {'/api/seo/seo-geo': (200, seo_geo_body())},
                          {'table': 'Keywords', 'market_id': 'es', 'group_id': 'g1'})

    assert [dict(request.query) for request in routes.requests] == [{'market_id': 'es', 'group_id': 'g1'}]


def test_seo_geo_shows_beyond_ten_only_for_keywords_whose_results_were_read():
    rows, _routes = _read(SEO_GEO, {'/api/seo/seo-geo': (200, seo_geo_body())}, {'table': 'Keywords'})

    assert _cells(SEO_GEO, rows, 'keyword', 'organic_position') == [
        ('flights to vigo', 3), ('vigo airport', '>10'), ('unread keyword', None),
    ]


def test_seo_geo_traffic_share_lists_every_domain_of_the_table():
    rows, _routes = _read(SEO_GEO, {'/api/seo/seo-geo': (200, seo_geo_body())}, {'table': 'Traffic share'})

    assert _cells(SEO_GEO, rows, 'name', 'owned', 'traffic_share') == [
        ('example.com', True, 0.6), ('rival.example', False, 0.4),
    ]


def test_seo_geo_refuses_an_export_without_a_table():
    assert SEO_GEO.validate({'market_id': 'es'}, USER) == 'The seo-geo export needs: table'


# --- S29 Rank tracking ----------------------------------------------------------------


def test_rank_tracking_reads_the_trackers_results_for_the_period():
    _rows, routes = _read(RANK_TRACKING, {'/api/seo/rank-trackers/rt-1/results': (200, rank_results_body())},
                          {'tracker_id': 'rt-1', 'period': '30d'})

    assert [(request.resource, dict(request.query)) for request in routes.requests] == [
        ('/api/seo/rank-trackers/{id}/results', {'period': '30d'}),
    ]


def test_rank_tracking_lists_each_keywords_move_per_device_in_the_routes_order():
    rows, _routes = _read(RANK_TRACKING, {'/api/seo/rank-trackers/rt-1/results': (200, rank_results_body())},
                          {'tracker_id': 'rt-1'})

    assert _cells(RANK_TRACKING, rows, 'keyword', 'desktop_position', 'desktop_change', 'mobile_change') == [
        ('cheap flights', 3, 2, 'new'), ('vigo flights', None, 'lost', None),
    ]


@pytest.mark.parametrize(('cell', 'change'), [
    ({'position': 2, 'previous_position': 6}, 4),
    ({'position': 9, 'previous_position': 4}, -5),
    ({'position': 1, 'previous_position': None}, 'new'),
    ({'position': None, 'previous_position': 3}, 'lost'),
    ({'position': None, 'previous_position': None}, None),
    ({'status': 'not_checked', 'position': None, 'previous_position': 3}, None),
    (None, None),
])
def test_rank_change_is_previous_minus_current_new_lost_or_none(cell, change):
    assert rank_change(cell) == change


# --- S30 Site audit -------------------------------------------------------------------


def _audit_answers(pages: dict[str, list[str]], *, running: bool = False, with_robots: bool = True) -> dict[str, Any]:
    return {f'{_AUDIT}/issues': audit_issues_answer(pages, running=running),
            _AUDIT: (200, audit_detail_body(with_robots=with_robots))}


def test_site_audit_lists_its_sheets_once_each():
    assert [sheet.name for sheet in SITE_AUDIT.sheets] == ['Issue types', 'Affected pages', 'AI crawler access']


def test_site_audit_asks_the_pages_of_every_registered_issue_type():
    _rows, routes = _read(SITE_AUDIT, _audit_answers({}), {'audit_id': AUDIT_ID})
    asked = {request.query['issue_type'] for request in routes.requests if 'issue_type' in request.query}

    assert asked == set(ISSUE_TYPES)


def test_site_audit_pages_every_issue_type_to_its_end_tagged_with_the_issue():
    pages = {'missing-title': ['https://www.example.com/a', 'https://www.example.com/b', 'https://www.example.com/c']}
    rows, _routes = _read(SITE_AUDIT, _audit_answers(pages), {'audit_id': AUDIT_ID})
    affected = [row for row in rows if row.sheet == 'Affected pages']

    assert _cells(SITE_AUDIT, affected, 'issue', 'severity', 'page_url') == [
        ('Missing title tag', 'critical', 'https://www.example.com/a'),
        ('Missing title tag', 'critical', 'https://www.example.com/b'),
        ('Missing title tag', 'critical', 'https://www.example.com/c'),
    ]


def test_site_audit_resumes_after_every_row_without_repeating_or_skipping_one():
    pages = {'missing-title': ['https://www.example.com/a', 'https://www.example.com/b', 'https://www.example.com/c']}
    source = over(SITE_AUDIT, SeoRoutes(_audit_answers(pages)))
    rows = all_rows(source, {'audit_id': AUDIT_ID})

    assert all(rest == rows[index + 1:] for index, rest in resumed_from_every_row(source, {'audit_id': AUDIT_ID}, rows))


def test_site_audit_lists_the_ai_crawler_access_of_robots_txt():
    rows, _routes = _read(SITE_AUDIT, _audit_answers({}), {'audit_id': AUDIT_ID})

    assert _cells(SITE_AUDIT, [row for row in rows if row.sheet == 'AI crawler access'], 'token', 'access') == [
        ('GPTBot', 'blocked'),
    ]


def test_site_audit_without_robots_readiness_has_no_crawler_rows():
    rows, _routes = _read(SITE_AUDIT, _audit_answers({}, with_robots=False), {'audit_id': AUDIT_ID})

    assert [row for row in rows if row.sheet == 'AI crawler access'] == []


def test_site_audit_of_a_running_audit_fails_the_export():
    routes = SeoRoutes(_audit_answers({}, running=True))

    with pytest.raises(ExportSourceError, match='kept answering a partial page'):
        all_rows(over(SITE_AUDIT, routes), {'audit_id': AUDIT_ID})


def test_issue_details_read_as_key_value_pairs_with_lists_joined():
    assert issue_detail_text({'title_length': 72, 'duplicate_of': ['/a', '/b']}) == 'title length: 72 · duplicate of: /a, /b'


def test_issue_without_details_has_no_details_text():
    assert issue_detail_text({}) is None


# --- S31 Lighthouse -------------------------------------------------------------------


def _lighthouse_rows(params: dict[str, str]) -> list[ExportRow]:
    rows, _routes = _read(LIGHTHOUSE, {f'/api/seo/lighthouse/{RUN_ID}': (200, lighthouse_body())},
                          {'run_id': RUN_ID, **params})
    return rows


def test_lighthouse_lists_the_six_metrics_of_each_completed_result_in_the_reports_order():
    metrics = [row for row in _lighthouse_rows({}) if row.sheet == 'Metrics']

    assert _cells(LIGHTHOUSE, metrics, 'metric', 'value') == [
        ('lcp_ms', 2400), ('cls', 0.02), ('inp_ms', 180), ('ttfb_ms', 300), ('fcp_ms', 1200), ('tbt_ms', 90),
    ]


def test_lighthouse_lists_the_failed_audits_of_completed_results_only():
    opportunities = [row for row in _lighthouse_rows({}) if row.sheet == 'Opportunities']

    assert _cells(LIGHTHOUSE, opportunities, 'url', 'id', 'savings_ms') == [
        ('https://www.example.com/', 'render-blocking-resources', 450),
    ]


def test_lighthouse_narrowed_to_a_page_and_device_lists_only_that_results_rows():
    rows = _lighthouse_rows({'url': 'https://www.example.com/', 'device': 'mobile'})

    assert {(row.sheet, row.values[:2]) for row in rows} == {
        ('Metrics', ('https://www.example.com/', 'mobile')), ('Opportunities', ('https://www.example.com/', 'mobile')),
    }


def test_lighthouse_narrowed_to_a_device_the_run_did_not_measure_lists_no_rows():
    assert _lighthouse_rows({'url': 'https://www.example.com/', 'device': 'desktop'}) == []


# --- S32 Local SEO --------------------------------------------------------------------


def test_local_businesses_ask_the_cache_only_twin_of_the_search():
    params = {'table': 'Businesses', 'query': 'hotel', 'latitude': '43.36', 'longitude': '-8.41', 'count': '20',
              'sort_by': 'rating', 'keyword': 'not this list'}
    _rows, routes = _read(LOCAL, {'/api/seo/local/businesses': (200, {'businesses': []})}, params)

    assert [(request.method, dict(request.query)) for request in routes.requests] == [
        ('GET', {'query': 'hotel', 'latitude': '43.36', 'longitude': '-8.41', 'sort_by': 'rating', 'count': '20'}),
    ]


def test_local_results_mark_the_business_looked_for_and_rank_by_absolute_then_group():
    rows, _routes = _read(LOCAL, {'/api/seo/local/serp': (200, local_serp_body())},
                          {'table': 'Local results', 'keyword': 'hotel'})

    assert _cells(LOCAL, rows, 'rank', 'title', 'yours') == [(1, 'Hotel Mar', False), (2, 'Hotel Coruña', True)]


def test_local_results_no_longer_cached_fail_the_export_with_the_routes_message():
    routes = SeoRoutes({'/api/seo/local/serp': NOT_CACHED})

    with pytest.raises(ExportSourceError, match='no longer cached'):
        all_rows(over(LOCAL, routes), {'table': 'Local results', 'keyword': 'hotel'})


def test_rank_grid_points_count_rows_and_columns_from_one_and_say_where_the_business_was_found():
    rows, _routes = _read(LOCAL, {f'/api/seo/local/jobs/{JOB_ID}': (200, grid_job_body())},
                          {'table': 'Rank grid', 'job_id': JOB_ID})

    assert _cells(LOCAL, rows, 'row', 'col', 'found', 'top_result') == [
        (1, 1, True, 'Hotel Mar'), (1, 2, False, None), (2, 1, None, None),
    ]


# --- S33 Keyword Explorer -------------------------------------------------------------


def test_keyword_explorer_asks_the_cache_only_read_with_the_research_and_the_tables_filters():
    params = {'keyword': 'cheap flights', 'market_id': 'es', 'mode': 'ideas', 'count': '300', 'min_volume': '100',
              'intents': 'commercial', 'sort': 'cpc', 'direction': 'asc'}
    _rows, routes = _read(KEYWORD_EXPLORER, {'/api/seo/keywords/research': (200, {'rows': []})}, params)

    assert [(request.method, dict(request.query)) for request in routes.requests] == [('GET', params)]


def test_keyword_explorer_lists_the_rows_in_the_order_the_route_answers():
    body = {'rows': [{'keyword': 'b', 'search_volume': 10}, {'keyword': 'a', 'search_volume': 20}]}
    rows, _routes = _read(KEYWORD_EXPLORER, {'/api/seo/keywords/research': (200, body)}, {'keyword': 'flights'})

    assert _cells(KEYWORD_EXPLORER, rows, 'keyword', 'search_volume') == [('b', 10), ('a', 20)]


def test_keyword_explorer_no_longer_cached_fails_the_export_with_the_routes_message():
    routes = SeoRoutes({'/api/seo/keywords/research': NOT_CACHED})

    with pytest.raises(ExportSourceError, match='no longer cached'):
        all_rows(over(KEYWORD_EXPLORER, routes), {'keyword': 'cheap flights'})


# --- S36 Domain Overview tables --------------------------------------------------------

_COMPETITORS = '/api/seo/domains/competitors'
_COMPETITOR_PARAMS = {'table': 'SERP competitors', 'keywords': '["cheap flights", "vigo flights"]', 'market_id': 'es'}


def test_serp_competitors_ask_only_the_cached_answer_of_the_keywords_on_screen():
    _rows, routes = _read(DOMAIN_TABLES, {_COMPETITORS: (200, {'items': []})}, _COMPETITOR_PARAMS)

    assert [(request.method, request.body) for request in routes.requests] == [
        ('POST', {'keywords': ['cheap flights', 'vigo flights'], 'market_id': 'es', 'cached_only': True}),
    ]


def test_serp_competitors_list_each_domain_in_the_routes_order():
    answer = {'items': [
        {'domain': 'b.example', 'visibility': 0.2, 'avg_position': 3.5, 'median_position': 3, 'etv': 120.0, 'keywords_count': 2},
        {'domain': 'a.example', 'visibility': None, 'avg_position': None, 'median_position': None, 'etv': None, 'keywords_count': 1},
    ]}
    rows, _routes = _read(DOMAIN_TABLES, {_COMPETITORS: (200, answer)}, _COMPETITOR_PARAMS)

    assert _cells(DOMAIN_TABLES, rows, 'domain', 'visibility') == [('b.example', 0.2), ('a.example', None)]


def test_serp_competitors_no_longer_cached_fail_the_export_with_the_routes_message():
    routes = SeoRoutes({_COMPETITORS: NOT_CACHED})

    with pytest.raises(ExportSourceError, match='no longer cached'):
        all_rows(over(DOMAIN_TABLES, routes), _COMPETITOR_PARAMS)


def test_traffic_snapshots_list_every_stored_snapshot_of_the_domain_and_market():
    answer = {'snapshots': [
        {'snapshot_at': '2026-11-02T06:00:00Z', 'organic_keywords': 40, 'estimated_traffic': 900, 'traffic_cost': 12.5,
         'keywords_stored': 40},
        {'snapshot_at': '2026-10-26T06:00:00Z', 'organic_keywords': 35, 'estimated_traffic': 800, 'traffic_cost': 10.0,
         'keywords_stored': 35},
    ]}
    rows, routes = _read(DOMAIN_TABLES, {'/api/seo/domains/snapshots': (200, answer)},
                         {'table': 'Traffic snapshots', 'domain': 'example.com', 'market_id': 'es'})

    assert (_cells(DOMAIN_TABLES, rows, 'snapshot_at'), dict(routes.requests[0].query)) == (
        [('2026-11-02T06:00:00Z',), ('2026-10-26T06:00:00Z',)], {'domain': 'example.com', 'market_id': 'es'},
    )
