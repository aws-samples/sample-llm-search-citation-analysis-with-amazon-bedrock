"""A generated tenant's routes as the export sources and the full-list paging tests reach them (2.45.0 wave 5).

``TenantRoutes`` answers a ``shared.export_source_routes.RouteRequest`` with the
real handler behind its path, loaded against an ``EndToEndTenant``; a 202
(a view job started) runs the tenant's view jobs, so the source's next ask is
served, as the deployed GenerateSummary job would. ``drain`` follows a
route's cursor to the end of a list.
"""

from __future__ import annotations

from collections.abc import Callable, Generator, Mapping
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field, replace
from typing import Any
from unittest.mock import patch

from shared.export_source_routes import RouteList, RouteRequest, RouteSource, path_value, route_event
from shared.scope_snapshot import SNAPSHOT_PREFIX
from testing.citation_rollup_fixtures import lambda_context
from testing.end_to_end_tenant import EndToEndTenant
from testing.events import parse_response

#: The handler file behind each API path an export source reads.
HANDLERS: Mapping[str, str] = {
    '/api/visibility': 'get-visibility-metrics.py',
    '/api/visibility/sentiment-examples': 'get-sentiment-examples.py',
    '/api/brand-mentions': 'get-brand-mentions.py',
    '/api/trends': 'get-historical-trends.py',
    '/api/persona-rankings': 'get-persona-rankings.py',
    '/api/citations': 'get-citations.py',
    '/api/url-breakdown': 'get-url-breakdown.py',
    '/api/crawled-content': 'get-crawled-content.py',
    '/api/searches': 'get-searches.py',
    '/api/citation-gaps': 'get-citation-gaps.py',
    '/api/prompt-insights': 'get-prompt-insights.py',
    '/api/recommendations': 'get-recommendations.py',
    '/api/reports/competitor': 'get-reports-competitor.py',
    '/api/reports/group-kpis': 'get-group-kpi-history.py',
    '/api/reports/insights': 'get-reports-insights.py',
    '/api/content-studio/ideas': 'content-studio.py',
    '/api/content-studio/history': 'content-studio.py',
    '/api/alerts': 'manage-alerts.py',
    '/api/alerts/content-changes': 'manage-alerts.py',
    '/api/keywords': 'get-keywords.py',
    '/api/keyword-groups': 'manage-keyword-groups.py',
    '/api/markets': 'manage-markets.py',
    '/api/query-prompts': 'manage-query-prompts.py',
    '/api/schedules': 'manage-schedule.py',
    '/api/users': 'manage-users.py',
}


@dataclass
class TenantRoutes:
    """A ``RouteInvoker`` over the tenant's real handlers (``live``: every scope read live, the oracle)."""

    tenant: EndToEndTenant
    live: bool = False
    patches: tuple[tuple[Any, Mapping[str, Any]], ...] = ()
    """``(module, {name: value})`` patched while a handler answers (an uncapped oracle raises a page size)."""
    requests: list[RouteRequest] = field(default_factory=list)

    def __call__(self, request: RouteRequest) -> tuple[int, Any]:
        self.requests.append(request)
        module = self.tenant.handler(HANDLERS[request.resource])
        with ExitStack() as stack:
            stack.enter_context(self.tenant.active())
            if self.live:
                stack.enter_context(self.tenant.live())
            for target, values in self.patches:
                stack.enter_context(patch.multiple(target, **dict(values)))
            status, body = parse_response(module.handler(route_event(request), lambda_context(29_000)))
        if status == 202:
            self.tenant.run_jobs()
        return status, body


def oracle_values(routes: TenantRoutes, route_list: RouteList, query: Mapping[str, str]) -> list[tuple[str, tuple[Any, ...]]]:
    """The rows of ``route_list`` from ONE answer of its route (``routes`` uncapped): the oracle a source's pages must equal."""
    request = RouteRequest(route_list.router, route_list.path, route_list.path, {**query, **route_list.fixed})
    status, body = routes(request)
    assert (status, path_value(body, route_list.paging.response_key) if route_list.paging.kind == 'token' else None) == (200, None), body
    items = path_value(body, route_list.items)
    listed = [items] if isinstance(items, Mapping) else list(items or [])
    return [
        (route_list.sheet, tuple(column.value(row) for column in route_list.columns))
        for item in listed for row in route_list.rows_of(item)
    ]


def over_tenant(source: RouteSource, routes: TenantRoutes) -> RouteSource:
    """``source`` reading the tenant's routes (a 202 already ran its job)."""
    return replace(source, invoker=routes)


def short_paged(source: RouteSource, limit: int) -> RouteSource:
    """``source`` asking ``limit`` items a page of every list it pages by ``limit`` (the cursor crosses pages on a small tenant)."""
    lists = tuple(
        replace(route_list, paging=replace(route_list.paging, limit=limit)) if route_list.paging.limit_param else route_list
        for route_list in source.lists
    )
    return replace(source, lists=lists)


def drain(call: Callable[[str | None], Mapping[str, Any]], items: str, cursor_field: str = 'next_token', first_field: str | None = None) -> list[Any]:
    """Every item of a paged list: the first page (``call(None)``), then each ``cursor_field`` token until there is none.

    ``first_field`` names the body field of the first page's token when it differs from the pages' (``brands_next_token``).
    """
    page = call(None)
    collected = list(page[items])
    next_token = page.get(first_field or cursor_field)
    for _ in range(1_000):
        if not next_token:
            return collected
        page = call(next_token)
        collected.extend(page[items])
        next_token = page.get(cursor_field)
    raise AssertionError(f'{items}: more than 1,000 pages')


@contextmanager
def patched(target: Any, **values: Any) -> Generator[None]:
    with patch.multiple(target, **values):
        yield


@contextmanager
def without_build(tenant: EndToEndTenant) -> Generator[None]:
    """The tenant's bucket without its build pointer for the block: every scope is a view job."""
    key = f'{SNAPSHOT_PREFIX}current.json'
    saved = tenant.bucket.objects.pop(key)
    try:
        yield
    finally:
        tenant.bucket.objects[key] = saved


def answered_page(
    tenant: EndToEndTenant, query: Mapping[str, str], token: str | None = None, *, handler: str, path: str,
) -> dict[str, Any]:
    """The 200 body of ``path`` at ``token``; a 202 runs the tenant's view jobs and asks once more."""
    params = {**query, **({'next_token': token} if token else {})}
    status, body = tenant.call(handler, path, params)
    if status == 202:
        tenant.run_jobs()
        status, body = tenant.call(handler, path, params)
    assert status == 200, body
    return body
