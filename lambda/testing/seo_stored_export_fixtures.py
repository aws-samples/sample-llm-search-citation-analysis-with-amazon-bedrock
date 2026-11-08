"""Fake SEO router answers for the stored SEO export sources (``shared.export_source_seo_stored``)."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from shared.export_source_routes import RouteRequest, RouteSource

AUDIT_ID = '0123456789abcdef0123456789abcdef'
RUN_ID = 'abcdef0123456789abcdef0123456789'
JOB_ID = 'job-grid-1'

type Answer = tuple[int, Any] | Callable[[RouteRequest], tuple[int, Any]]


@dataclass
class SeoRoutes:
    """A fake SEO router: one answer per request path (a fixed ``(status, body)`` or a function), every request kept."""

    answers: Mapping[str, Answer]
    requests: list[RouteRequest] = field(default_factory=list)

    def __call__(self, request: RouteRequest) -> tuple[int, Any]:
        self.requests.append(request)
        answer = self.answers[request.path]
        return answer(request) if callable(answer) else answer


def over(source: RouteSource, routes: SeoRoutes) -> RouteSource:
    """``source`` reading from ``routes``, never sleeping."""
    return replace(source, invoker=routes, sleep=lambda _seconds: None)


def seo_geo_body() -> dict[str, Any]:
    """An SEO vs GEO report: a ranked keyword, one read without your domains in its top 10, a traffic share table."""
    return {
        'rows': [
            {'keyword': 'flights to vigo', 'search_volume': 900, 'organic_position': 3, 'ai_overview_shown': True,
             'quadrant': 'both'},
            {'keyword': 'vigo airport', 'search_volume': 300, 'organic_position': None, 'ai_overview_shown': False,
             'quadrant': 'geo_only'},
            {'keyword': 'unread keyword', 'search_volume': 50, 'organic_position': None, 'ai_overview_shown': None},
        ],
        'traffic_comparison': [
            {'name': 'example.com', 'owned': True, 'estimated_traffic': 120.5, 'traffic_share': 0.6},
            {'name': 'rival.example', 'owned': False, 'estimated_traffic': 80.0, 'traffic_share': 0.4},
        ],
    }


def rank_results_body() -> dict[str, Any]:
    """A tracker's results: a keyword up two on desktop and new on mobile, one lost on desktop."""
    return {
        'devices': ['desktop', 'mobile'],
        'rows': [
            {'keyword': 'cheap flights', 'keyword_id': 'k1', 'source': 'settings',
             'desktop': {'position': 3, 'previous_position': 5, 'status': 'found', 'serp_features': ['local_pack']},
             'mobile': {'position': 4, 'previous_position': None, 'status': 'found'}},
            {'keyword': 'vigo flights', 'keyword_id': 'k2', 'source': 'extra',
             'desktop': {'position': None, 'previous_position': 8, 'status': 'not_found'},
             'mobile': {'position': None, 'previous_position': None, 'status': 'not_checked'}},
        ],
    }


def audit_issues_answer(pages: Mapping[str, list[str]], *, running: bool = False) -> Callable[[RouteRequest], tuple[int, Any]]:
    """``/audits/{id}/issues``: the issue types of ``pages`` (``{issue_type: page urls}``) or one type's pages, by two."""
    def answer(request: RouteRequest) -> tuple[int, Any]:
        issue_type = request.query.get('issue_type')
        if issue_type is None:
            types = [{'issue_type': name, 'title': name, 'pages': len(urls)} for name, urls in pages.items()]
            return 200, {'audit_id': AUDIT_ID, 'issue_types': types, 'audit_running': running}
        urls = pages.get(issue_type, [])
        start = int(request.query.get('next_token', '0'))
        following = start + 2 if start + 2 < len(urls) else None
        items = [{'page_url': url, 'issue_type': issue_type, 'details': {'length': 72}} for url in urls[start:start + 2]]
        return 200, {'audit_id': AUDIT_ID, 'items': items, 'audit_running': running,
                     'next_token': None if following is None else str(following)}

    return answer


def audit_detail_body(*, with_robots: bool = True) -> dict[str, Any]:
    readiness = {'bots': [{'token': 'GPTBot', 'vendor': 'OpenAI', 'access': 'blocked', 'blocked_paths': ['/']}]}
    return {'audit': {'audit_id': AUDIT_ID, 'status': 'completed', **({'ai_readiness': readiness} if with_robots else {})}}


def lighthouse_body() -> dict[str, Any]:
    """A run of two pages: one completed on mobile, one that failed."""
    return {'run': {'run_id': RUN_ID, 'results': [
        {'url': 'https://www.example.com/', 'device': 'mobile', 'status': 'completed', 'fetched_at': '2026-11-01T08:00:00Z',
         'metrics': {'lcp_ms': 2400, 'cls': 0.02, 'inp_ms': 180, 'ttfb_ms': 300, 'fcp_ms': 1200, 'tbt_ms': 90},
         'failed_audits': [{'id': 'render-blocking-resources', 'title': 'Eliminate render-blocking resources',
                            'savings_ms': 450, 'severity': 'high'}]},
        {'url': 'https://www.example.com/flights', 'device': 'mobile', 'status': 'failed', 'metrics': None,
         'failed_audits': None},
    ]}}


def local_serp_body() -> dict[str, Any]:
    """Maps results where the second is the business looked for."""
    return {'items': [
        {'rank_group': 1, 'rank_absolute': 1, 'title': 'Hotel Mar', 'rating': 4.5},
        {'rank_group': 2, 'rank_absolute': None, 'title': 'Hotel Coruña', 'rating': 4.8},
    ], 'match': {'index': 1}}


def grid_job_body() -> dict[str, Any]:
    return {'job_id': JOB_ID, 'result': {'points': [
        {'row': 0, 'col': 0, 'latitude': 43.36, 'longitude': -8.41, 'status': 'ready', 'rank': 2,
         'top_result': {'title': 'Hotel Mar', 'cid': '111'}},
        {'row': 0, 'col': 1, 'latitude': 43.36, 'longitude': -8.40, 'status': 'ready', 'rank': None},
        {'row': 1, 'col': 0, 'latitude': 43.35, 'longitude': -8.41, 'status': 'failed', 'rank': None},
    ]}}


NOT_CACHED = (404, {'error': 'The research of "cheap flights" is no longer cached', 'code': 'NOT_CACHED'})
