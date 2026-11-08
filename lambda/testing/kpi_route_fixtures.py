"""Support for the KPI route tests of track S2: one handler over a scope of many keywords, read live or from a stored build.

``KpiRoute`` wires a handler module to fake tables of ``two_run_rows`` and
answers a query; ``served_and_live`` answers the same query from a stored
build and from the uncapped live path (the oracle), so a test compares them.
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable, Generator, Mapping
from dataclasses import dataclass
from datetime import datetime
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

from shared.answer_queries import history_since
from shared.snapshot_artifacts import coverage, live_envelope
from testing.events import api_gateway_event, parse_response
from testing.kpi_latest_fixtures import scope_latests, snapshot_artifacts
from testing.kpi_scope_fixtures import keyword_items, snapshot_store, two_run_rows
from testing.kpi_trends_fixtures import SCOPE_ALL, keyword_tallies, trend_doc
from testing.search_results_fixtures import active_keywords_table, report_dynamodb, search_results_table
from testing.snapshot_fakes import FakeSnapshotArtifacts

#: The owned domain and brand configuration of the KPI route tests.
OWNED = ['hotel-sol.com']
BRAND_CONFIG = {'tracked_brands': {'first_party': ['Hotel Sol']}, 'first_party_domains': OWNED, 'updated_at': '2026-10-05T07:00:00Z'}


def live_scope_fields(keywords: int) -> dict[str, Any]:
    """The scope contract fields of a complete live answer over ``keywords`` keywords."""
    return {'coverage': coverage(keywords, keywords), **live_envelope()}


@dataclass(frozen=True)
class KpiRoute:
    """A handler wired to fake tables: ``call(query)`` answers ``GET path``."""

    module: ModuleType
    path: str
    keywords: list[str]
    search: MagicMock

    def call(self, query: Mapping[str, str]) -> tuple[int, dict[str, Any]]:
        return parse_response(self.module.handler(api_gateway_event('GET', self.path, query=dict(query)), None))


@contextlib.contextmanager
def kpi_route(
    module: ModuleType, path: str, keywords: list[str], *,
    frozen: datetime | None = None, other_tables: Mapping[str, MagicMock] | None = None,
    brand_config: Mapping[str, Any] = BRAND_CONFIG, **patches: Any,
) -> Generator[KpiRoute]:
    """``module`` over ``two_run_rows(keywords)`` (and ``other_tables`` by name), the brand config (``BRAND_CONFIG`` by default), and ``history_since`` (where the module reads it) at ``frozen`` when given."""
    search = search_results_table(two_run_rows(keywords))
    resource = report_dynamodb(search, active_keywords_table(keyword_items(keywords)), dict(other_tables or {}))
    clock = {} if frozen is None or not hasattr(module, 'history_since') else {'history_since': lambda days: history_since(days, frozen)}
    with patch.multiple(module, dynamodb=resource, get_brand_config=lambda: dict(brand_config), **clock, **patches):
        yield KpiRoute(module, path, keywords, search)


def from_build(route: KpiRoute, stored: Any, query: Mapping[str, str]) -> tuple[int, dict[str, Any], MagicMock]:
    """``query``'s status and body with ``stored`` as the scope's build (``None``: no build), and the fake ``view_job_response``."""
    with snapshot_store(stored) as job:
        status, body = route.call(query)
    return status, body, job


def served_and_live(route: KpiRoute, query: Mapping[str, str], stored: Any, route_attr: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """``query``'s body from ``stored`` (``open_snapshot``'s build) and from the live path (``route_attr`` forced to ``'live'``)."""
    with snapshot_store(stored):
        _status, served = route.call(query)
    with patch.object(route.module, route_attr, return_value='live'):
        _status, live = route.call(query)
    return served, live


def window_build(
    keywords: list[str], builder: Any, artifacts: Callable[[Any, datetime], dict[str, Any]], built: datetime, **options: Any,
) -> FakeSnapshotArtifacts:
    """The stored build of a window builder (``trends``, ``group-kpis``) over ``two_run_rows(keywords)`` at ``built``."""
    rows = [row for keyword_rows in two_run_rows(keywords).values() for row in keyword_rows]
    tallies = keyword_tallies(keywords, rows, OWNED)
    acc = None
    for keyword in keywords:
        acc = builder.fold(acc, trend_doc(keyword, tallies[keyword], OWNED), SCOPE_ALL)
    return _with_options(FakeSnapshotArtifacts(artifacts(acc, built), keywords_total=len(keywords)), options)


def _with_options(stored: FakeSnapshotArtifacts, options: Mapping[str, Any]) -> FakeSnapshotArtifacts:
    for name, value in options.items():
        setattr(stored, name, value)
    return stored


def latest_build(keywords: list[str], **options: Any) -> FakeSnapshotArtifacts:
    """The stored ``latest`` build (``/visibility``) over ``two_run_rows(keywords)``; ``options`` set its fields (``build_id``, ``stale``...)."""
    rows = [row for keyword_rows in two_run_rows(keywords).values() for row in keyword_rows]
    return _with_options(snapshot_artifacts(scope_latests(keywords, rows, OWNED), keywords_total=len(keywords)), options)


def drained(first: Mapping[str, Any], list_key: str, token_key: str, next_page: Callable[[str], Mapping[str, Any]]) -> list[Any]:
    """Every row of a paged list: ``first[list_key]``, then each ``next_page(token)``'s ``list_key`` until no token is left."""
    rows, token = list(first[list_key]), first[token_key]
    while token is not None:
        page = next_page(token)
        rows.extend(page[list_key])
        token = page['next_token']
    return rows


__all__ = ['BRAND_CONFIG', 'OWNED', 'KpiRoute', 'drained', 'from_build', 'kpi_route', 'latest_build', 'live_scope_fields', 'served_and_live', 'window_build']
