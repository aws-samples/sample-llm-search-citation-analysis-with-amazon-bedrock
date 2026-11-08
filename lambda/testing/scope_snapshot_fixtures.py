"""Test support for the scope snapshot store, builder and serving (``shared.snapshot_store``, ``shared.scope_snapshot*``)."""

from __future__ import annotations

import json
import os
from collections.abc import Generator, Iterable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from types import ModuleType
from typing import Any, Self
from unittest.mock import MagicMock, patch

from shared import scope_source
from shared.keyword_latest import record_keyword_latest
from shared.keyword_run_kpis import run_tally_pair
from shared.kpi_engine import answers_from_rows
from shared.kpi_tally import RunTally
from shared.partial_contract import PartialConfig
from shared.snapshot_store import decode_json, encode_json
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.module_loader import load_handler_module_offline
from testing.scale_data import BRAND_CONFIG, ScaleSpec, keyword_text, run_timestamp, search_result_rows
from testing.snapshot_fakes import ConditionalS3

SNAPSHOT_BUCKET = 'citation-analysis-keywords-123456789012'


def listing_pages(keys: Iterable[str], params: Mapping[str, Any]) -> Iterator[dict[str, Any]]:
    """The one ``list_objects_v2`` page a paginator answers over ``keys``: the keys under ``Prefix``, or their common prefixes with a ``Delimiter``."""
    prefix, delimiter = params['Prefix'], params.get('Delimiter')
    matching = sorted(key for key in keys if key.startswith(prefix))
    if delimiter is None:
        yield {'Contents': [{'Key': key} for key in matching]}
        return
    tails = {key[len(prefix):] for key in matching}
    yield {'CommonPrefixes': [{'Prefix': name} for name in sorted({prefix + tail.split(delimiter, 1)[0] + delimiter for tail in tails if delimiter in tail})]}


class ListedBucket:
    """``get_paginator('list_objects_v2')`` over an in-memory bucket's ``objects`` (one page, ``listing_pages``)."""

    objects: Any

    def get_paginator(self, _operation: str) -> Self:
        return self

    def paginate(self, **params: Any) -> Iterator[dict[str, Any]]:
        return listing_pages(list(self.objects), params)


@dataclass
class SnapshotBucket(ConditionalS3, ListedBucket):
    """``ConditionalS3`` plus the listing and batch delete a build's garbage collection uses."""

    def delete_objects(self, **params: Any) -> dict[str, Any]:
        for item in params['Delete']['Objects']:
            self.delete_object(Key=item['Key'])
        return {}

    def put_json(self, key: str, value: Any) -> None:
        self.put_object(Key=key, Body=encode_json(value))

    def json_at(self, key: str) -> Any:
        """The decoded gzip-JSON object at ``key`` (no call is recorded)."""
        return decode_json(self.objects[key][0])

    def keys_under(self, prefix: str) -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))


@dataclass
class RecordingLambda:
    """A Lambda client that records every asynchronous invocation's payload."""

    invocations: list[dict[str, Any]] = field(default_factory=list)

    def invoke(self, **params: Any) -> dict[str, Any]:
        self.invocations.append(json.loads(params['Payload']))
        return {'StatusCode': 202}


def keywords_table(items: Sequence[Mapping[str, Any]]) -> MagicMock:
    """A Keywords table whose ``StatusIndex`` query answers ``items`` (one page)."""
    table = MagicMock()
    table.query.return_value = {'Items': [dict(item) for item in items]}
    return table


def full_tally(spec: ScaleSpec, keyword_index: int, run_index: int) -> RunTally:
    """The complete tally the workflow computes for one generated keyword-run (rows in sort-key order, as a query returns them)."""
    rows = sorted(search_result_rows(spec, keyword_index, run_index), key=lambda row: row['timestamp_provider'])
    return run_tally_pair(keyword_text(keyword_index), run_timestamp(run_index), answers_from_rows(rows), BRAND_CONFIG).full


def write_keyword_latests(bucket: Any, spec: ScaleSpec, runs: Iterable[int], config: PartialConfig, keywords: Iterable[int] | None = None) -> None:
    """Every generated keyword's KeywordLatest object after the workflow wrote ``runs`` (the partials as registered)."""
    for keyword_index in range(spec.keywords) if keywords is None else keywords:
        for run_index in runs:
            rows = sorted(search_result_rows(spec, keyword_index, run_index), key=lambda row: row['timestamp_provider'])
            record_keyword_latest(bucket, SNAPSHOT_BUCKET, rows, full_tally(spec, keyword_index, run_index), config, keyword_id=f'id-{keyword_index}')


def bucket_with_keyword_latests(spec: ScaleSpec, config: PartialConfig) -> SnapshotBucket:
    """A bucket holding every generated keyword's KeywordLatest object after all of ``spec``'s runs, with no read recorded yet."""
    bucket = SnapshotBucket()
    write_keyword_latests(bucket, spec, range(spec.runs), config)
    bucket.gets.clear()
    return bucket


def deduplication_under_test(handler_dir: str, env: Mapping[str, str], tables: Mapping[str, Any]) -> tuple[ModuleType, Any]:
    """The Deduplication handler loaded with ``env`` (offline), and a DynamoDB resource answering ``tables`` by name."""
    with patch.dict(os.environ, env):
        module = load_handler_module_offline(handler_dir, 'handler.py', 'deduplication_latest_under_test')
    return module, fake_dynamodb_resource(by_name=dict(tables))


@contextmanager
def live_rows_budget(rows: int) -> Generator[None]:
    """``shared.scope_source.LIVE_ROWS_BUDGET`` is ``rows`` for the block (small tenants then have scopes over it)."""
    with patch.object(scope_source, 'LIVE_ROWS_BUDGET', rows):
        yield


@dataclass
class GeneratedHistory:
    """A ``HistoryReader`` over the generated runs ``0 .. runs - 1`` of a spec; ``reads`` records the keywords read."""

    spec: ScaleSpec
    runs: int
    reads: list[str] = field(default_factory=list)

    def __call__(self, keyword: str, since: str = '') -> list[RunTally]:
        self.reads.append(keyword)
        index = int(keyword.rsplit(' ', 1)[-1])
        return [full_tally(self.spec, index, run) for run in range(self.runs) if run_timestamp(run) >= since]


@dataclass(frozen=True)
class PendingBuilder:
    """A builder whose track has not landed: every call raises, as the base stubs do."""

    name: str = 'pending'

    def fold(self, acc: Any, latest: Any, scope: Any) -> Any:
        raise NotImplementedError('pending', acc, latest, scope)

    def finalize(self, acc: Any) -> dict[str, Any]:
        raise NotImplementedError('pending', acc)

    def serve(self, artifacts: Any, params: Mapping[str, Any]) -> dict[str, Any] | None:
        raise NotImplementedError('pending', artifacts, params)
