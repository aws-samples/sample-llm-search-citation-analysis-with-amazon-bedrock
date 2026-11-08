"""The SEO stack's tools in the MCP catalogue: free reads, the ``seo`` spend family's requests, the engine filter."""

from __future__ import annotations

import pytest
from catalogue import InvalidArguments, Route, build_route, find_operation, listed_operations

SEO_READ_TOOLS = [
    'get_keyword_metrics', 'get_seo_geo_comparison', 'get_seo_recommendations', 'get_rank_tracking',
    'get_domain_snapshots', 'get_backlink_snapshots', 'get_site_audits', 'get_local_job',
]
SEO_SPEND_TOOLS = [
    'estimate_seo_keywords', 'run_seo_keywords', 'estimate_seo_domain', 'run_seo_domain', 'estimate_seo_backlinks',
    'run_seo_backlinks', 'estimate_seo_local', 'run_seo_local', 'estimate_seo_job', 'start_seo_job',
]
AUDIT_ID = '0123456789abcdef0123456789abcdef'


def _built(name: str, arguments: dict) -> Route:
    """The API request a call of ``name`` with ``arguments`` makes, after argument validation."""
    _valid, route = build_route(find_operation(name), arguments)
    return route


def _request(name: str, arguments: dict) -> tuple:
    """The method, path, query and body of the request a call makes."""
    route = _built(name, arguments)
    return route.method, route.path, route.query, route.body


@pytest.mark.parametrize('name', SEO_READ_TOOLS)
def test_offers_seo_read_as_read_only_catalogue_entry(name):
    tool = find_operation(name)

    assert (tool.scope, tool.read_only, tool.admin, tool.spend, tool.direct) == ('read', True, False, None, False)


@pytest.mark.parametrize('name', SEO_READ_TOOLS)
def test_states_free_when_seo_read_makes_no_dataforseo_call(name):
    assert find_operation(name).description.startswith('Free (no DataForSEO call). ')


@pytest.mark.parametrize('name', SEO_READ_TOOLS + SEO_SPEND_TOOLS)
def test_keeps_seo_tool_out_of_direct_listing_when_not_pinned(name):
    assert name not in [tool.name for tool in listed_operations()]


@pytest.mark.parametrize('name', SEO_SPEND_TOOLS)
def test_routes_seo_spend_tool_to_seo_router(name):
    tool = find_operation(name)

    assert (tool.spend.family if tool.spend else None, tool.route(dict(tool.examples[0])).router) == ('seo', 'seo')


@pytest.mark.parametrize('name', SEO_SPEND_TOOLS)
def test_states_a_dollar_price_when_seo_spend_tool_is_described(name):
    assert '$' in find_operation(name).description


def test_looks_up_stored_metrics_through_seo_router_when_keyword_ids_given():
    route = find_operation('get_keyword_metrics').route({'keyword_ids': ['kw_1'], 'market_id': 'cl-es'})

    assert (route.router, route.method, route.path, route.body) == (
        'seo', 'POST', '/api/seo/keywords/metrics/lookup', {'keyword_ids': ['kw_1'], 'market_id': 'cl-es'},
    )


def test_requires_keyword_ids_when_looking_up_metrics():
    assert find_operation('get_keyword_metrics').input_schema['required'] == ['keyword_ids']


def test_reads_seo_geo_comparison_through_seo_router_when_group_given():
    route = find_operation('get_seo_geo_comparison').route({'group_id': 'grp_1', 'market_id': 'global'})

    assert (route.router, route.method, route.path, route.query) == (
        'seo', 'GET', '/api/seo/seo-geo', {'market_id': 'global', 'group_id': 'grp_1'},
    )


def test_accepts_google_ai_overviews_as_engine_filter():
    engines = find_operation('get_dashboard_stats').input_schema['properties']['provider']['enum']

    assert engines == ['openai', 'perplexity', 'gemini', 'claude', 'google_ai_overview']


class TestReadRoutes:
    def test_reads_recommendations_of_market_and_group(self):
        assert _request('get_seo_recommendations', {'market_id': 'cl-es', 'group_id': 'grp_1'}) == (
            'GET', '/api/seo/insights', {'market_id': 'cl-es', 'group_id': 'grp_1'}, None,
        )

    def test_lists_active_trackers_when_view_is_trackers(self):
        assert _request('get_rank_tracking', {'view': 'trackers'}) == ('GET', '/api/seo/rank-trackers', None, None)

    def test_reads_tracker_results_over_period_when_view_is_results(self):
        assert _request('get_rank_tracking', {'view': 'results', 'tracker_id': 'trk-1', 'period': '30d'}) == (
            'GET', '/api/seo/rank-trackers/trk-1/results', {'period': '30d'}, None,
        )

    def test_names_tracker_id_as_path_parameter_when_reading_history(self):
        route = _built('get_rank_tracking', {'view': 'history', 'tracker_id': 'trk-1', 'keyword_id': 'kw_1'})

        assert (route.resource, route.path_params, route.query) == (
            '/api/seo/rank-trackers/{trackerId}/history', {'trackerId': 'trk-1'}, {'keyword_id': 'kw_1'},
        )

    def test_refuses_history_when_keyword_id_is_missing(self):
        with pytest.raises(InvalidArguments, match='history needs keyword_id'):
            _built('get_rank_tracking', {'view': 'history', 'tracker_id': 'trk-1'})

    @pytest.mark.parametrize('tracker_id', ['../audits', 'trk/1', 'trk 1', '-' * 65])
    def test_refuses_tracker_id_that_would_leave_its_path_segment(self, tracker_id):
        with pytest.raises(InvalidArguments, match='tracker_id must be an id of letters, digits, - or _'):
            _built('get_rank_tracking', {'view': 'tracker', 'tracker_id': tracker_id})

    def test_reads_domain_snapshots_of_domain_and_market(self):
        assert _request('get_domain_snapshots', {'domain': 'example.com', 'market_id': 'cl-es'}) == (
            'GET', '/api/seo/domains/snapshots', {'domain': 'example.com', 'market_id': 'cl-es'}, None,
        )

    def test_reads_backlink_snapshots_without_parameters(self):
        assert _request('get_backlink_snapshots', {}) == ('GET', '/api/seo/backlinks/snapshots', None, None)

    def test_reads_pages_of_one_issue_type_when_view_is_issues(self):
        assert _request('get_site_audits', {'view': 'issues', 'audit_id': AUDIT_ID, 'issue_type': 'missing_title'}) == (
            'GET', f'/api/seo/audits/{AUDIT_ID}/issues', {'issue_type': 'missing_title'}, None,
        )

    def test_reads_audit_summary_when_view_is_summary(self):
        assert _request('get_site_audits', {'view': 'summary', 'audit_id': AUDIT_ID})[1] == f'/api/seo/audits/{AUDIT_ID}'

    def test_reads_local_job_by_id_with_job_id_path_parameter(self):
        route = _built('get_local_job', {'job_id': AUDIT_ID})

        assert (route.path, route.path_params) == (f'/api/seo/local/jobs/{AUDIT_ID}', {'job_id': AUDIT_ID})


class TestSpendRoutes:
    def test_posts_research_options_when_lookup_is_research(self):
        arguments = {'lookup': 'research', 'keyword': 'hotel', 'mode': 'ideas', 'limit': 300, 'clickstream': True}

        assert _request('estimate_seo_keywords', arguments) == ('POST', '/api/seo/keywords/research', None, {
            'keyword': 'hotel', 'mode': 'ideas', 'limit': 300, 'clickstream': True,
        })

    def test_drops_research_options_when_lookup_is_serp(self):
        arguments = {'lookup': 'serp', 'keyword': 'hotel', 'limit': 300, 'depth': 50}

        assert _request('estimate_seo_keywords', arguments) == ('POST', '/api/seo/serp', None, {'keyword': 'hotel', 'depth': 50})

    def test_refuses_research_limit_outside_its_choices(self):
        with pytest.raises(InvalidArguments, match='limit must be one of: 150, 300, 500'):
            _built('estimate_seo_keywords', {'lookup': 'research', 'keyword': 'hotel', 'limit': 100})

    def test_posts_paging_and_filters_when_lookup_is_ranked_keywords(self):
        arguments = {'lookup': 'ranked_keywords', 'target': 'example.com', 'page': 2, 'filters': {'min_volume': 10}}

        assert _request('estimate_seo_domain', arguments) == ('POST', '/api/seo/domains/keywords', None, {
            'target': 'example.com', 'page': 2, 'filters': {'min_volume': 10},
        })

    def test_posts_link_mode_when_lookup_is_links(self):
        arguments = {'lookup': 'links', 'target': 'example.com', 'mode': 'as_is', 'page_size': 100}

        assert _request('estimate_seo_backlinks', arguments) == ('POST', '/api/seo/backlinks/rows', None, {
            'target': 'example.com', 'page_size': 100, 'mode': 'as_is',
        })

    def test_posts_referring_domains_table_without_link_mode(self):
        arguments = {'lookup': 'referring_domains', 'target': 'example.com', 'mode': 'as_is'}

        assert _request('estimate_seo_backlinks', arguments)[1:] == (
            '/api/seo/backlinks/referring-domains', None, {'target': 'example.com'},
        )

    def test_accepts_decimal_coordinates_when_searching_local_results(self):
        arguments = {'lookup': 'serp', 'keyword': 'hotel', 'latitude': 43.37, 'longitude': -8.4, 'domain': 'example.com'}

        assert _request('estimate_seo_local', arguments)[3] == {
            'keyword': 'hotel', 'latitude': 43.37, 'longitude': -8.4, 'domain': 'example.com',
        }

    def test_refuses_latitude_outside_the_globe(self):
        with pytest.raises(InvalidArguments, match='latitude must be between -90 and 90'):
            _built('estimate_seo_local', {'lookup': 'profile', 'name': 'Example Hotel', 'latitude': 91})

    def test_refuses_local_serp_without_keyword(self):
        with pytest.raises(InvalidArguments, match='serp needs keyword'):
            _built('estimate_seo_local', {'lookup': 'serp', 'latitude': 43.37, 'longitude': -8.4})

    def test_starts_rank_run_of_tracker(self):
        assert _request('estimate_seo_job', {'job': 'rank_run', 'tracker_id': 'trk-1'}) == (
            'POST', '/api/seo/rank-trackers/trk-1/runs', None, {},
        )

    def test_starts_grid_job_with_kind_grid(self):
        arguments = {'job': 'rank_grid', 'keyword': 'hotel', 'grid_size': 5, 'spacing_km': 1.5}

        assert _request('estimate_seo_job', arguments)[1:] == ('/api/seo/local/jobs', None, {
            'kind': 'grid', 'keyword': 'hotel', 'grid_size': 5, 'spacing_km': 1.5,
        })

    def test_starts_site_audit_from_start_url(self):
        arguments = {'job': 'site_audit', 'start_url': 'https://example.com/', 'max_pages': 100}

        assert _request('estimate_seo_job', arguments)[1:] == (
            '/api/seo/audits', None, {'start_url': 'https://example.com/', 'max_pages': 100},
        )

    def test_takes_domain_snapshot_in_market(self):
        arguments = {'job': 'domain_snapshot', 'domain': 'example.com', 'market_id': 'cl-es'}

        assert _request('estimate_seo_job', arguments)[1:] == (
            '/api/seo/domains/snapshots', None, {'domain': 'example.com', 'market_id': 'cl-es'},
        )

    def test_refuses_rank_run_without_tracker_id(self):
        with pytest.raises(InvalidArguments, match='rank_run needs tracker_id'):
            _built('estimate_seo_job', {'job': 'rank_run'})
