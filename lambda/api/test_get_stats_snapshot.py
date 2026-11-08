"""GET /api/stats?market_id: a market over the live budget takes its totals from the scope snapshot (2.45.0).

The ``stats`` artifact sums each active keyword's KeywordLatest ``counts``;
the keywords the build does not cover (paused ones) are counted live, so the
totals still cover every keyword of the market. The S1 store is a fake.
"""

from __future__ import annotations

import os
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest

from shared.artifact_stats import STATS_BUILDER, stats_artifacts
from shared.partial_contract import KeywordLatest
from testing import dynamodb_stubs
from testing.env import STATS_ENV
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.kpi_scope_fixtures import snapshot_store
from testing.kpi_trends_fixtures import SCOPE_ALL
from testing.search_results_fixtures import key_parts
from testing.snapshot_fakes import FakeSnapshotArtifacts, keyword_latest

stats_module = handler_fixture(os.path.dirname(__file__), 'get-stats.py', 'get_stats_snapshot_under_test', env=STATS_ENV)

_MARKET = 'cl-es'
_ACTIVE = [f'vuelos {index:03}' for index in range(150)]
_PAUSED = ['vuelos pausado']
_RUN = '2026-10-01T08:00:00.000000Z'
_STAMP = '2026-10-05T09:00:00Z'


def stub_latest(keyword: str, *, counts: dict[str, int] | None) -> KeywordLatest:
    """A KeywordLatest object of ``keyword``'s run ``_RUN``, with a ``counts`` block when given."""
    doc: dict[str, Any] = dict(keyword_latest(keyword, timestamp=_RUN))
    if counts is not None:
        doc['counts'] = counts
    return cast('KeywordLatest', doc)


def _build(docs) -> FakeSnapshotArtifacts:
    acc = None
    for doc in docs:
        acc = STATS_BUILDER.fold(acc, doc, SCOPE_ALL)
    return FakeSnapshotArtifacts(stats_artifacts(acc), keywords_total=len(_ACTIVE))


def _partitions(per_keyword: int, newest: str | None = None) -> MagicMock:
    """A table counting ``per_keyword`` rows in every keyword partition (and answering ``newest`` to a newest-row read)."""
    def query(**kwargs: Any) -> dict[str, Any]:
        if kwargs.get('Select') == 'COUNT':
            return {'Count': per_keyword}
        return {'Items': [{'timestamp': newest}]} if newest else {'Items': []}

    table = dynamodb_stubs.described(dynamodb_stubs.fake_table())
    table.query.side_effect = query
    return table


@pytest.fixture
def tables() -> dict[str, MagicMock]:
    rows = [{'keyword': keyword, 'market_id': _MARKET, 'status': 'active'} for keyword in _ACTIVE]
    rows += [{'keyword': keyword, 'market_id': _MARKET, 'status': 'paused'} for keyword in _PAUSED]
    return {
        'search_results_table': _partitions(3, '2026-09-01T08:00:00.000000Z'),
        'citations_table': _partitions(2),
        'crawled_table': _partitions(1),
        'keywords_table': dynamodb_stubs.described(dynamodb_stubs.fake_table(scan={'Items': rows})),
    }


def _get(module: Any, tables: dict[str, MagicMock]) -> tuple[int, dict[str, Any]]:
    with (
        patch.multiple(module, _count_cache={}, **tables),
        patch.object(module.utils, 'get_brand_config', return_value={'updated_at': '2026-10-05T07:00:00Z'}),
        patch.object(module, 'get_timestamp', return_value=_STAMP),
    ):
        return parse_response(module.handler(api_gateway_event('GET', '/api/stats', query={'market_id': _MARKET}), None))


_COUNTS = {'searches': 40, 'citations': 12, 'crawled': 5}


class TestStatsArtifact:
    def test_sums_every_keywords_counts(self) -> None:
        stored = _build([stub_latest(keyword, counts=_COUNTS) for keyword in _ACTIVE]).artifacts['stats']

        assert stored == {'unique_keywords': 150, 'total_searches': 6_000, 'total_citations': 1_800, 'total_crawled': 750, 'last_execution': _RUN}

    def test_writes_nothing_when_an_object_lacks_its_counts(self) -> None:
        docs = [stub_latest(keyword, counts=_COUNTS) for keyword in _ACTIVE[1:]] + [stub_latest(_ACTIVE[0], counts=None)]

        assert _build(docs).artifacts == {}

    def test_rejects_a_negative_count(self) -> None:
        assert _build([stub_latest(_ACTIVE[0], counts={**_COUNTS, 'crawled': -1})]).artifacts == {}


def _get_from(module: Any, tables: dict[str, MagicMock], stored: Any) -> dict[str, Any]:
    """The body ``/stats?market_id`` answers with ``stored`` as the market's build (``None``: no build)."""
    with snapshot_store(stored):
        return _get(module, tables)[1]


@pytest.fixture
def served(stats_module, tables) -> dict[str, Any]:
    return _get_from(stats_module, tables, _build([stub_latest(keyword, counts=_COUNTS) for keyword in _ACTIVE]))


class TestLargeMarket:
    def test_adds_the_live_counts_of_the_keywords_outside_the_build(self, served) -> None:
        assert {name: served[name] for name in ('total_searches', 'total_citations', 'total_crawled', 'unique_keywords')} == {
            'total_searches': 6_000 + 3, 'total_citations': 1_800 + 2, 'total_crawled': 750 + 1, 'unique_keywords': 151,
        }

    def test_counts_only_the_partitions_outside_the_build(self, served, tables) -> None:
        counted = {key_parts(call.kwargs['KeyConditionExpression'])[0] for call in tables['citations_table'].query.call_args_list}

        assert (counted, served['source']) == (set(_PAUSED), 'snapshot')

    def test_takes_the_newest_run_of_the_build_and_the_rest(self, served) -> None:
        assert (served['last_execution'], served['last_execution_approximate'], served['counts_approximate']) == (_RUN, False, False)

    def test_labels_the_body_with_the_build(self, served) -> None:
        assert (served['source'], served['as_of'], served['coverage']) == (
            'snapshot', '2026-10-05T07:12:00Z', {'keywords_total': 151, 'keywords_analyzed': 151, 'complete': True},
        )

    @pytest.mark.parametrize('stored', [
        pytest.param(_build([stub_latest(keyword, counts=None) for keyword in _ACTIVE]), id='a build without totals'),
        pytest.param(None, id='no build'),
    ])
    def test_counts_live_without_stored_totals(self, stats_module, tables, stored) -> None:
        body = _get_from(stats_module, tables, stored)

        assert (body['source'], body['total_searches'], body['unique_keywords']) == ('live', 3 * 151, 151)


class TestSmallMarket:
    def test_never_opens_the_snapshot(self, stats_module, tables) -> None:
        tables['keywords_table'] = dynamodb_stubs.described(dynamodb_stubs.fake_table(scan={'Items': [{'keyword': 'vuelos 001', 'market_id': _MARKET, 'status': 'active'}]}))
        with patch('shared.scope_snapshot_serve.open_snapshot') as opened:
            _status, body = _get(stats_module, tables)

        assert (opened.call_count, body['source'], body['unique_keywords']) == (0, 'live', 1)
