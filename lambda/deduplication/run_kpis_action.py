"""
The per-run rollups the Deduplication Lambda writes (``shared.keyword_run_kpis``, ``shared.keyword_run_brands``,
``shared.keyword_latest``).

- ``record_run_kpis``: when a keyword's run is done (the workflow's
  DeduplicateCitations step), read the run's SearchResults rows once and write
  its KeywordRunKpis row, its KeywordRunBrands row (only when the run names
  more brands than a KeywordRunKpis row keeps) and its KeywordLatest object.
- ``backfill_handler``: the ``backfill_keyword_run_kpis`` action, which rolls
  up the runs stored before the table existed (``shared.keyword_run_kpis_backfill``);
  with ``latest: true`` it rebuilds every KeywordLatest object instead.

Environment: ``DYNAMODB_TABLE_KEYWORD_RUN_KPIS`` (unset: no KPI row),
``DYNAMODB_TABLE_KEYWORD_RUN_BRANDS`` (unset: no brand row),
``SCOPE_SNAPSHOT_BUCKET`` (unset: no KeywordLatest object),
``SCOPE_SNAPSHOT_FUNCTION_NAME`` (the GenerateSummary Lambda a finished chained
``latest`` backfill starts a scope snapshot build on),
``DYNAMODB_TABLE_QUERY_PROMPTS`` (the enabled personas KeywordLatest is built for),
``DYNAMODB_TABLE_CITATIONS`` and ``DYNAMODB_TABLE_CRAWLED_CONTENT`` (the
KeywordLatest ``counts`` block, ``shared.keyword_counts``; either unset: no block),
``DYNAMODB_TABLE_SEARCH_RESULTS``, ``DYNAMODB_TABLE_BRAND_CONFIG`` (owned
domains and tracked competitors) and, for a backfill without a keyword list,
``DYNAMODB_TABLE_KEYWORDS``.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.env_vars import resolve_table_env
from shared.keyword_counts import KeywordCounter
from shared.keyword_latest import KeywordLatestConflict, read_full_run_rows, record_keyword_latest
from shared.keyword_run_brands import keyword_run_brands_table, put_run_brands
from shared.keyword_run_kpis import (
    RunTallies,
    emit_write_failure_metric,
    keyword_run_kpis_table,
    put_run_tally,
    run_tally_pair,
)
from shared.keyword_run_kpis_backfill import (
    Cursor,
    KeywordLatestBackfill,
    KeywordRunKpisBackfill,
    RollupNotDeployedError,
    keyword_pages,
    run_backfill,
)
from shared.kpi_engine import answers_from_rows
from shared.partial_contract import PartialConfig
from shared.request_deadline import Deadline, request_deadline_scope
from shared.scope_snapshot import PersonaCache, query_prompts_table, snapshot_bucket, start_snapshot_build
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)

dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')
lambda_client = boto3.client('lambda')

_WRITE_ERRORS = (ClientError, BotoCoreError, KeyError, ValueError, TypeError)

personas = PersonaCache(lambda: query_prompts_table(dynamodb))


class KeywordLatestNotDeployedError(RuntimeError):
    """The ``latest`` backfill was invoked where ``SCOPE_SNAPSHOT_BUCKET`` is not set."""

    def __init__(self) -> None:
        super().__init__('Set SCOPE_SNAPSHOT_BUCKET to rebuild the KeywordLatest objects')


def _search_results_table() -> Any:
    """SearchResults (``DYNAMODB_TABLE_SEARCH_RESULTS``), which the KPI rollup of a run is read from."""
    return dynamodb.Table(resolve_table_env('DYNAMODB_TABLE_SEARCH_RESULTS'))


def keyword_counter() -> KeywordCounter:
    """What the KeywordLatest ``counts`` block is counted in (a table not configured: no block)."""
    citations, crawled = os.environ.get('DYNAMODB_TABLE_CITATIONS'), os.environ.get('DYNAMODB_TABLE_CRAWLED_CONTENT')
    return KeywordCounter(
        _search_results_table(),
        dynamodb.Table(citations) if citations else None,
        dynamodb.Table(crawled) if crawled else None,
    )


def _write_rollups(tallies: RunTallies) -> None:
    rollups, brands = keyword_run_kpis_table(dynamodb), keyword_run_brands_table(dynamodb)
    try:
        if rollups is not None:
            put_run_tally(rollups, tallies.capped)
        if brands is not None:
            put_run_brands(brands, tallies.full)
    except (ClientError, BotoCoreError):
        logger.exception('KPI rollup of %r at %s not written', tallies.capped.keyword, tallies.capped.timestamp)
        emit_write_failure_metric('workflow')


def _write_keyword_latest(bucket: str, rows: list[dict[str, Any]], tallies: RunTallies, brand_config: dict[str, Any], keyword_id: str) -> None:
    try:
        config = PartialConfig(brand_config=brand_config, personas=personas.ids())
        record_keyword_latest(s3, bucket, rows, tallies.full, config, keyword_id=keyword_id, counter=keyword_counter())
    except (*_WRITE_ERRORS, KeywordLatestConflict):
        logger.exception('KeywordLatest of %r at %s not written', tallies.full.keyword, tallies.full.timestamp)
        emit_write_failure_metric('keyword_latest')


def record_run_kpis(keyword: str, timestamp: object, keyword_id: str = '') -> None:
    """Write the KPI rollup, the brand row and the KeywordLatest object of ``keyword``'s run ``timestamp``.

    Best effort: a failure is logged and counted (``KeywordRunKpisWriteFailure``)
    and never fails the keyword; the windowed reports then read that run raw
    only while it is older than the keyword's first rollup, and the backfill
    writes it on its next pass. Each write is skipped where its store is not deployed.
    """
    bucket = snapshot_bucket()
    if not isinstance(timestamp, str) or not timestamp:
        return
    if keyword_run_kpis_table(dynamodb) is None and bucket is None:
        return
    try:
        rows = read_full_run_rows(_search_results_table(), keyword, timestamp)
        brand_config = get_brand_config()
        tallies = run_tally_pair(keyword, timestamp, answers_from_rows(rows), brand_config)
    except _WRITE_ERRORS:
        logger.exception('KPI rollup of %r at %s not written', keyword, timestamp)
        emit_write_failure_metric('workflow')
        return
    _write_rollups(tallies)
    if bucket is not None:
        _write_keyword_latest(bucket, rows, tallies, brand_config, keyword_id)


def _latest_backfill(event: dict[str, Any], deadline: Deadline, keyword_ids: dict[str, str]) -> KeywordLatestBackfill:
    bucket = snapshot_bucket()
    if bucket is None:
        raise KeywordLatestNotDeployedError
    config = PartialConfig(brand_config=get_brand_config(), personas=personas.ids())
    return KeywordLatestBackfill(
        _search_results_table(), keyword_run_kpis_table(dynamodb), s3, bucket, config, deadline,
        rebuild=event.get('rebuild') is True, keyword_ids=keyword_ids, counter=keyword_counter(),
    )


def _kpis_backfill(event: dict[str, Any], deadline: Deadline) -> KeywordRunKpisBackfill:
    rollups = keyword_run_kpis_table(dynamodb)
    if rollups is None:
        raise RollupNotDeployedError
    return KeywordRunKpisBackfill(_search_results_table(), rollups, get_brand_config(), deadline, rebuild=event.get('rebuild') is True)


def _continue(event: dict[str, Any], context: Any, response: dict[str, Any]) -> None:
    """After a ``chain`` invocation: invoke this Lambda again with the cursor, or start a scope snapshot build once ``latest`` is done."""
    if event.get('chain') is not True:
        return
    if response['done']:
        if response['mode'] == 'latest':
            start_snapshot_build(lambda_client, 'keyword_latest_backfill')
        return
    function_name = getattr(context, 'invoked_function_arn', None)
    if not function_name:
        return
    try:
        lambda_client.invoke(
            FunctionName=function_name, InvocationType='Event',
            Payload=json.dumps({**event, 'cursor': response['cursor']}, default=str).encode('utf-8'),
        )
    except (ClientError, BotoCoreError):
        logger.exception('Could not continue the %s backfill', response['mode'])


def backfill_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """The ``backfill_keyword_run_kpis`` action (``shared.keyword_run_kpis_backfill``): roll up the runs already stored.

    Event: ``cursor`` (from the previous response), optional ``keywords``
    (else every keyword of the Keywords table), ``rebuild``, ``latest``
    (rebuild the KeywordLatest objects instead of the KPI rows) and ``chain``
    (invoke itself again with the cursor until done; a finished ``latest``
    pass then starts a scope snapshot build). Answers ``done``, ``mode`` and
    the ``cursor`` to invoke it with next.
    """
    explicit = event.get('keywords')
    keywords = [keyword for keyword in explicit if isinstance(keyword, str)] if isinstance(explicit, list) else None
    keywords_table = None if keywords is not None else dynamodb.Table(resolve_table_env('DYNAMODB_TABLE_KEYWORDS'))
    cursor = Cursor.from_event(event.get('cursor'))
    keyword_ids: dict[str, str] = {}
    with request_deadline_scope(context) as deadline:
        job = _latest_backfill(event, deadline, keyword_ids) if event.get('latest') is True else _kpis_backfill(event, deadline)
        response = run_backfill(job, keyword_pages(keywords_table, keywords, cursor.scan_key, keyword_ids), cursor)
    _continue(event, context, response)
    return response
