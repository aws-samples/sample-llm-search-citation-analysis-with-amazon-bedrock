"""Tests for the KeywordLatest object (``shared.keyword_latest``): parts, placement of runs, history and conditional writes."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError

from shared.keyword_latest import (
    RECENT_DAYS,
    SERIES_RUNS,
    KeywordLatestConflict,
    build_parts,
    config_fingerprint,
    fold_run,
    keyword_latest_key,
    latest_tallies,
    read_keyword_latest,
    recent_tallies,
    record_keyword_latest,
    update_keyword_latest,
)
from shared.kpi_tally import RunTally
from shared.partial_contract import KeywordLatestRun, PartialConfig
from shared.partials import PARTIALS
from testing.scale_data import BRAND_CONFIG, ScaleSpec, keyword_text, run_timestamp, search_result_rows
from testing.scope_snapshot_fixtures import SNAPSHOT_BUCKET, SnapshotBucket, full_tally

_SPEC = ScaleSpec(keywords=2, personas=2, runs=400, long_tail=60)
_CONFIG = PartialConfig(brand_config=BRAND_CONFIG, personas=('persona-00', 'persona-01'))
_FP = config_fingerprint(_CONFIG)


def _full(run: int, keyword: int = 0) -> RunTally:
    return full_tally(_SPEC, keyword, run)


def _run(run: int, **parts: Any) -> KeywordLatestRun:
    return {'timestamp': run_timestamp(run), 'parts': dict(parts)}


def _fold(doc: Any, run: int, config: str = _FP, **parts: Any) -> Any:
    return fold_run(doc, _run(run, **parts), _full(run), keyword_id='k0', config=config, owned_domains=['hotel-coruna-mar.es'])


def _fake_partial(previous_run: bool, value: Any = None, error: type[Exception] | None = None) -> SimpleNamespace:
    def build(rows: Any, config: Any) -> Any:
        if error is not None:
            raise error('boom')
        return {'rows': len(rows)} if value is None else value

    return SimpleNamespace(PREVIOUS_RUN=previous_run, build=build, merge=lambda acc, part: part)


class TestNaming:
    def test_key_is_a_hash_under_the_keywords_prefix(self) -> None:
        assert keyword_latest_key('a').startswith('scope-snapshots/keywords/')

    def test_two_keywords_have_two_keys(self) -> None:
        assert keyword_latest_key('a') != keyword_latest_key('b')

    def test_fingerprint_ignores_the_brand_configs_timestamp(self) -> None:
        moved = PartialConfig(brand_config={**BRAND_CONFIG, 'updated_at': '2027-01-01T00:00:00Z'}, personas=_CONFIG.personas)
        assert config_fingerprint(moved) == _FP

    def test_fingerprint_changes_with_the_personas(self) -> None:
        assert config_fingerprint(PartialConfig(brand_config=BRAND_CONFIG, personas=('persona-00',))) != _FP

    def test_fingerprint_ignores_set_order(self) -> None:
        first = PartialConfig(brand_config={'domains': {'a.es', 'b.es', 'c.es'}})
        second = PartialConfig(brand_config={'domains': {'c.es', 'a.es', 'b.es'}})
        assert config_fingerprint(first) == config_fingerprint(second)


class TestParts:
    def test_unimplemented_partials_are_left_out(self) -> None:
        with patch.dict(PARTIALS, {'kpi': _fake_partial(True, error=NotImplementedError)}, clear=True):
            assert build_parts(search_result_rows(_SPEC, 0, 0), _CONFIG) == {}

    def test_every_registered_partial_is_built(self) -> None:
        assert sorted(build_parts(search_result_rows(_SPEC, 0, 0), _CONFIG)) == ['actions', 'insights', 'kpi', 'mentions']

    def test_an_implemented_partial_is_built_from_the_runs_rows(self) -> None:
        with patch.dict(PARTIALS, {'kpi': _fake_partial(True)}, clear=True):
            assert build_parts(search_result_rows(_SPEC, 0, 0), _CONFIG) == {'kpi': {'rows': 8}}

    def test_a_partial_that_fails_is_left_out(self) -> None:
        parts = {'kpi': _fake_partial(True, error=ValueError), 'mentions': _fake_partial(False, value={'m': 1})}
        with patch.dict(PARTIALS, parts, clear=True):
            assert build_parts(search_result_rows(_SPEC, 0, 0), _CONFIG) == {'mentions': {'m': 1}}


class TestPlacement:
    def test_first_run_becomes_the_latest(self) -> None:
        doc = _fold(None, 3)
        assert (doc['latest']['timestamp'], doc['previous']) == (run_timestamp(3), None)

    def test_a_newer_run_demotes_the_latest_keeping_only_previous_run_parts(self) -> None:
        with patch.dict(PARTIALS, {'kpi': _fake_partial(True), 'mentions': _fake_partial(False)}):
            doc = _fold(_fold(None, 3, kpi={'a': 1}, mentions={'b': 2}), 4, kpi={'a': 3})
        assert doc['previous'] == {'timestamp': run_timestamp(3), 'parts': {'kpi': {'a': 1}}}

    def test_the_same_run_again_replaces_the_latest(self) -> None:
        doc = _fold(_fold(None, 3, kpi={'a': 1}), 3, kpi={'a': 2})
        assert (doc['latest']['parts'], doc['previous']) == ({'kpi': {'a': 2}}, None)

    def test_a_late_run_between_the_two_becomes_the_previous(self) -> None:
        doc = _fold(_fold(_fold(None, 2), 5), 4)
        assert (doc['latest']['timestamp'], doc['previous']['timestamp']) == (run_timestamp(5), run_timestamp(4))

    def test_a_run_older_than_both_only_joins_the_history(self) -> None:
        doc = _fold(_fold(_fold(None, 4), 5), 1)
        assert [doc['latest']['timestamp'], doc['previous']['timestamp'], doc['recent'][0]['run_timestamp']] == [
            run_timestamp(5), run_timestamp(4), run_timestamp(1),
        ]

    def test_the_two_newest_runs_keep_their_full_tallies(self) -> None:
        doc = _fold(_fold(_fold(None, 1), 2), 3)
        assert latest_tallies(doc) == [_full(2), _full(3)]

    def test_another_config_restarts_the_two_newest_runs(self) -> None:
        doc = _fold(_fold(None, 1), 2, config='other')
        assert (doc['config'], doc['previous'], len(doc['recent'])) == ('other', None, 2)


class TestHistory:
    def test_recent_keeps_the_runs_of_the_last_two_months(self) -> None:
        doc = None
        for run in range(RECENT_DAYS + 5):
            doc = _fold(doc, run)
        assert doc is not None
        assert [tally.timestamp for tally in recent_tallies(doc)][:1] == [run_timestamp(4)]

    def test_recent_tallies_carry_no_brands(self) -> None:
        assert recent_tallies(_fold(None, 0))[0].brands == ()

    def test_series_keeps_the_last_year_of_runs(self) -> None:
        doc = None
        for run in range(SERIES_RUNS + 2):
            doc = _fold(doc, run)
        assert doc is not None
        assert (len(doc['series']['r']), doc['series']['r'][0][0]) == (SERIES_RUNS, run_timestamp(2))

    def test_series_rows_hold_the_runs_kpis(self) -> None:
        row = _fold(None, 0)['series']['r'][0]
        assert row[:2] == [run_timestamp(0), 8]


class _RacingBucket(SnapshotBucket):
    """A bucket where another writer replaces the object right after each of the first ``races`` reads."""

    races: int = 0

    def get_object(self, **params: Any) -> dict[str, Any]:
        response = super().get_object(**params)
        if self.races:
            self.races -= 1
            body, etag = self.objects[params['Key']]
            self.objects[params['Key']] = (body, f'{etag}-{self.races}')
        return response


def _racing_after_one_write(races: int) -> _RacingBucket:
    """A bucket holding one written object whose next ``races`` conditional writes lose to a concurrent writer."""
    bucket = _RacingBucket()
    update_keyword_latest(bucket, SNAPSHOT_BUCKET, keyword_text(0), lambda doc: _fold(doc, 1))
    bucket.races = races
    return bucket


class TestConditionalWrites:
    def test_a_new_object_is_written_only_if_absent(self) -> None:
        bucket = SnapshotBucket()
        update_keyword_latest(bucket, SNAPSHOT_BUCKET, keyword_text(0), lambda doc: _fold(doc, 1))
        assert read_keyword_latest(bucket, SNAPSHOT_BUCKET, keyword_text(0))[0] == _fold(None, 1)

    def test_a_concurrent_write_is_retried_over_the_new_version(self) -> None:
        bucket = _racing_after_one_write(1)
        update_keyword_latest(bucket, SNAPSHOT_BUCKET, keyword_text(0), lambda doc: _fold(doc, 2))
        assert bucket.puts.count(keyword_latest_key(keyword_text(0))) == 3

    def test_losing_every_attempt_raises_a_conflict(self) -> None:
        bucket = _racing_after_one_write(10)
        with pytest.raises(KeywordLatestConflict, match='conflicting writes'):
            update_keyword_latest(bucket, SNAPSHOT_BUCKET, keyword_text(0), lambda doc: _fold(doc, 2))

    def test_other_s3_errors_are_raised(self) -> None:
        class _Broken(SnapshotBucket):
            def put_object(self, **params: Any) -> dict[str, Any]:
                raise ClientError({'Error': {'Code': 'AccessDenied', 'Message': 'no'}}, 'PutObject')

        with pytest.raises(ClientError, match='AccessDenied'):
            update_keyword_latest(_Broken(), SNAPSHOT_BUCKET, keyword_text(0), lambda doc: _fold(doc, 1))


class TestRecord:
    def test_records_the_run_with_its_full_tally(self) -> None:
        bucket = SnapshotBucket()
        rows = search_result_rows(_SPEC, 1, 7)
        record_keyword_latest(bucket, SNAPSHOT_BUCKET, rows, _full(7, keyword=1), _CONFIG, keyword_id='k1')
        doc, _ = read_keyword_latest(bucket, SNAPSHOT_BUCKET, keyword_text(1))
        assert doc is not None
        assert (doc['keyword_id'], doc['config'], latest_tallies(doc)) == ('k1', _FP, [_full(7, keyword=1)])
