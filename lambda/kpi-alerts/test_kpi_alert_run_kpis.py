"""KpiAlerts from the run's KeywordRunKpis rows (2.45.0): one BatchGet per 100 keywords, every pair complete."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.keyword_run_kpis import BRANDS_PER_RUN, tally_item
from shared.kpi_engine import answers_from_rows
from shared.kpi_tally import run_tally
from testing import scale_data
from testing.citation_rollup_fixtures import lambda_context
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.handler_fixtures import handler_fixture
from testing.kpi_alert_fixtures import KPI_ALERTS_ENV, run_event, worker_patches
from testing.markets_fixtures import CHILE, valid_market
from testing.search_result_fixtures import successful_answer_row

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_RUN = '2026-10-01T10:00:00Z'
_RUN_KPIS_TABLE = 'run-kpis'
#: CitationAnalysis-KpiAlerts' timeout (lib/citation-analysis-stack.ts): the budget a run really has.
_KPI_ALERTS_TIMEOUT_MS = 300_000
_OWNED = ['hotel-mine.com']
_BRAND_CONFIG = {'first_party_domains': _OWNED, 'tracked_brands': {'competitors': ['Rival']}}

worker_module = handler_fixture(_HANDLER_DIR, 'handler.py', 'kpi_alert_run_kpis_under_test', env=KPI_ALERTS_ENV)


class RunKpisResource:
    """A DynamoDB resource whose ``batch_get_item`` serves KeywordRunKpis rows by key and counts its calls."""

    def __init__(self, rows: Mapping[tuple[str, str], dict[str, Any]]) -> None:
        self.rows = rows
        self.batch_gets = 0
        self.snapshots = MagicMock()
        self.resource = fake_dynamodb_resource(by_name={'snapshots': self.snapshots, 'alerts': MagicMock()})
        self.resource.batch_get_item = self.batch_get_item

    def batch_get_item(self, **request: Any) -> dict[str, Any]:
        self.batch_gets += 1
        keys = request['RequestItems'][_RUN_KPIS_TABLE]['Keys']
        found = [self.rows[key['keyword'], key['run_timestamp']] for key in keys if (key['keyword'], key['run_timestamp']) in self.rows]
        return {'Responses': {_RUN_KPIS_TABLE: found}, 'UnprocessedKeys': {}}

    def snapshot_items(self) -> list[dict[str, Any]]:
        return [call.kwargs['Item'] for call in self.snapshots.put_item.call_args_list]


def _answer_rows(keyword: str) -> list[dict[str, Any]]:
    """Two answers: the hotel 2nd behind the rival, then the rival with 30 long-tail competitors (over ``BRANDS_PER_RUN``)."""
    long_tail = tuple((f'Hostal {index:02d}', 'competitor', index + 2) for index in range(30))
    return [
        successful_answer_row(keyword=keyword, timestamp=_RUN, provider='openai', brands=(('Rival', 'competitor', 1), ('Hotel Mine', 'first_party', 2)), citations=['https://hotel-mine.com/rooms']),
        successful_answer_row(keyword=keyword, timestamp=_RUN, provider='gemini', brands=(('Rival', 'competitor', 3), *long_tail), citations=['https://guide.example/a']),
    ]


def _stored_row(keyword: str, *, owned: list[str] = _OWNED, tracked: tuple[str, ...] = ('Rival',)) -> dict[str, Any]:
    """The row ``record_run_kpis`` writes for ``keyword``'s answers."""
    tally = run_tally(keyword, _RUN, answers_from_rows(_answer_rows(keyword)), owned, brand_cap=BRANDS_PER_RUN, tracked_brands=tracked)
    return tally_item(tally)


def _run(
    module, resource: RunKpisResource, keyword_items: list[dict[str, Any]], *,
    groups: list[dict[str, Any]], brand_config: Mapping[str, Any], raw: MagicMock, run: str = _RUN,
    markets: list[Any] | None = None,
) -> dict[str, Any]:
    with (
        patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORD_RUN_KPIS': _RUN_KPIS_TABLE}),
        worker_patches(
            module, active=keyword_items, groups=groups, brand_config=brand_config, raw=raw, resource=resource.resource,
            load_markets=MagicMock(return_value=markets or []),
        ),
    ):
        return module.handler(run_event(run, [str(item['keyword']) for item in keyword_items]), lambda_context(_KPI_ALERTS_TIMEOUT_MS))


_KEYWORDS = ['hotel spa', 'hotel beach']
_ITEMS = [{'id': f'keyword-{index}', 'keyword': keyword, 'group_ids': {'group-1'}} for index, keyword in enumerate(_KEYWORDS)]
_GROUPS = [{'id': 'group-1', 'name': 'Group One'}]


def _raw_answers() -> MagicMock:
    """``_load_run_rows`` serving each keyword's run rows (the read from the answers)."""
    return MagicMock(side_effect=lambda keywords, *_args: {keyword: _answer_rows(keyword) for keyword in keywords})


def stub_snapshot_from_answers(module) -> dict[str, Any]:
    """The oracle: the snapshot the worker stores when every keyword is read from its answers (no rows)."""
    resource = RunKpisResource({})
    _run(module, resource, _ITEMS, groups=_GROUPS, brand_config=_BRAND_CONFIG, raw=_raw_answers())
    return resource.snapshot_items()[0]


_CHILE_ITEMS = [{**item, 'market_id': CHILE['market_id']} for item in _ITEMS]


@dataclass(frozen=True)
class RawReadCase:
    """A run whose stored rows ``rows`` (keyword -> ``_stored_row`` options; absent: no row) leave ``raw`` keywords to read from their answers."""

    rows: Mapping[str, Mapping[str, Any]]
    raw: list[str] | None
    brand_config: Mapping[str, Any] = field(default_factory=lambda: _BRAND_CONFIG)
    items: list[dict[str, Any]] = field(default_factory=lambda: _ITEMS)
    markets: tuple[Any, ...] = ()


_EVERY_ROW = {keyword: {} for keyword in _KEYWORDS}


@pytest.mark.parametrize('case', [
    pytest.param(RawReadCase(_EVERY_ROW, None), id='every keyword has a covering row'),
    pytest.param(RawReadCase({'hotel spa': {}}, ['hotel beach']), id='a keyword without a row'),
    pytest.param(RawReadCase({'hotel spa': {'owned': ['elsewhere.com']}, 'hotel beach': {}}, ['hotel spa']), id='a row of other owned domains'),
    pytest.param(RawReadCase(_EVERY_ROW, ['hotel beach', 'hotel spa'], brand_config={'first_party_domains': _OWNED}), id='capped rows, no tracked competitor'),
    pytest.param(
        RawReadCase(_EVERY_ROW, ['hotel beach', 'hotel spa'], items=_CHILE_ITEMS, markets=(valid_market(CHILE),)),
        id='capped rows, a market competitor the rows do not keep',
    ),
])
def test_reads_from_the_answers_only_the_keywords_no_stored_row_covers(worker_module, case: RawReadCase) -> None:
    resource = RunKpisResource({(keyword, _RUN): _stored_row(keyword, **options) for keyword, options in case.rows.items()})
    raw = _raw_answers()

    _run(worker_module, resource, case.items, groups=_GROUPS, brand_config=case.brand_config, raw=raw, markets=list(case.markets))

    assert (raw.call_args.args[0] if raw.call_args else None) == case.raw


def stub_covered_run() -> RunKpisResource:
    """A run whose every keyword has its stored row."""
    return RunKpisResource({(keyword, _RUN): _stored_row(keyword) for keyword in _KEYWORDS})


def test_stores_the_snapshot_the_answers_give(worker_module) -> None:
    resource = stub_covered_run()

    _run(worker_module, resource, _ITEMS, groups=_GROUPS, brand_config=_BRAND_CONFIG, raw=_raw_answers())

    assert resource.snapshot_items() == [stub_snapshot_from_answers(worker_module)]


def test_keeps_the_market_competitor_read_from_the_answers(worker_module) -> None:
    resource = stub_covered_run()
    markets = [valid_market({**CHILE, 'competitors': ['Hostal 07']})]

    _run(worker_module, resource, _CHILE_ITEMS, groups=_GROUPS, brand_config=_BRAND_CONFIG, raw=_raw_answers(), markets=markets)

    assert resource.snapshot_items()[0]['competitors'] == [{'name': 'Rival', 'best_position': 1}, {'name': 'Hostal 07', 'best_position': 9}]


class TestEveryPairCompletesAtTenTimesTheKeywords:
    """5,000 keywords x 10 personas x 4 engines, 710 groups in 15 markets: the run's rows read in 50 BatchGets."""

    SPEC = scale_data.ScaleSpec(keywords=5_000, groups=710, largest_group=160, markets=15, personas=10, runs=1, long_tail=20_000)

    @pytest.fixture(scope='class')
    @classmethod
    def run(cls, worker_module) -> tuple[RunKpisResource, dict[str, Any], MagicMock]:
        timestamp = scale_data.run_timestamp(0)
        rows = {
            (scale_data.keyword_text(index), timestamp): scale_data.keyword_run_kpis_item(cls.SPEC, index, 0)
            for index in range(cls.SPEC.keywords)
        }
        resource = RunKpisResource(rows)
        raw = MagicMock(return_value={})
        result = _run(
            worker_module, resource, scale_data.keyword_items(cls.SPEC),
            groups=scale_data.group_items(cls.SPEC), brand_config=scale_data.BRAND_CONFIG, raw=raw, run=timestamp,
        )
        return resource, result, raw

    def test_reads_the_rows_in_fifty_batch_gets(self, run) -> None:
        resource, _result, _raw = run

        assert resource.batch_gets == 50

    def test_reads_no_answer(self, run) -> None:
        _resource, _result, raw = run

        assert raw.call_count == 0

    def test_snapshots_every_group_and_market_pair(self, run) -> None:
        _resource, result, _raw = run
        pairs = {
            (group, item['market_id'])
            for item in scale_data.keyword_items(self.SPEC) for group in item.get('group_ids', ())
        }

        assert {(scope['group_id'], scope['market_id']) for scope in result['snapshot_scopes']} == pairs

    def test_leaves_no_pair_to_the_time_budget_or_partial(self, run) -> None:
        _resource, result, _raw = run

        assert (result['skipped_time_budget'], result['skipped_partial']) == (0, 0)
