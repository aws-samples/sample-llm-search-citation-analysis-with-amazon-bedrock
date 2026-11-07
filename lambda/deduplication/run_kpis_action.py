"""
The KPI rollup work of the Deduplication Lambda (``shared.keyword_run_kpis``).

- ``record_run_kpis``: when a keyword's run is done (the workflow's
  DeduplicateCitations step), write that run's rollup row.
- ``backfill_handler``: the ``backfill_keyword_run_kpis`` action, which rolls
  up the runs stored before the table existed (``shared.keyword_run_kpis_backfill``).

Environment: ``DYNAMODB_TABLE_KEYWORD_RUN_KPIS`` (unset: nothing is written),
``DYNAMODB_TABLE_SEARCH_RESULTS``, ``DYNAMODB_TABLE_BRAND_CONFIG`` (owned
domains and tracked competitors) and, for a backfill without a keyword list,
``DYNAMODB_TABLE_KEYWORDS``.
"""

from __future__ import annotations

import logging
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.env_vars import resolve_table_env
from shared.keyword_run_kpis import build_run_tally, emit_write_failure_metric, keyword_run_kpis_table, put_run_tally
from shared.keyword_run_kpis_backfill import (
    Cursor,
    KeywordRunKpisBackfill,
    RollupNotDeployedError,
    keyword_pages,
    run_backfill,
)
from shared.request_deadline import request_deadline_scope
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)

dynamodb = boto3.resource('dynamodb')


def _search_results_table() -> Any:
    """SearchResults (``DYNAMODB_TABLE_SEARCH_RESULTS``), which the KPI rollup of a run is read from."""
    return dynamodb.Table(resolve_table_env('DYNAMODB_TABLE_SEARCH_RESULTS'))


def record_run_kpis(keyword: str, timestamp: object) -> None:
    """Write the KPI rollup of ``keyword``'s run ``timestamp`` (``shared.keyword_run_kpis``).

    Best effort: a failure is logged and counted (``KeywordRunKpisWriteFailure``)
    and never fails the keyword; the windowed reports then read that run raw
    only while it is older than the keyword's first rollup, and the backfill
    writes it on its next pass. Skipped where the table is not deployed.
    """
    rollups = keyword_run_kpis_table(dynamodb)
    if rollups is None or not isinstance(timestamp, str) or not timestamp:
        return
    try:
        put_run_tally(rollups, build_run_tally(_search_results_table(), keyword, timestamp, get_brand_config()))
    except (ClientError, BotoCoreError, KeyError, ValueError, TypeError):
        logger.exception('KPI rollup of %r at %s not written', keyword, timestamp)
        emit_write_failure_metric('workflow')


def backfill_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """The ``backfill_keyword_run_kpis`` action (``shared.keyword_run_kpis_backfill``): roll up the runs already stored.

    Event: ``cursor`` (from the previous response), optional ``keywords``
    (else every keyword of the Keywords table) and ``rebuild``. Answers
    ``done`` and the ``cursor`` to invoke it with next.
    """
    rollups = keyword_run_kpis_table(dynamodb)
    if rollups is None:
        raise RollupNotDeployedError
    explicit = event.get('keywords')
    keywords = [keyword for keyword in explicit if isinstance(keyword, str)] if isinstance(explicit, list) else None
    keywords_table = None if keywords is not None else dynamodb.Table(resolve_table_env('DYNAMODB_TABLE_KEYWORDS'))
    cursor = Cursor.from_event(event.get('cursor'))
    with request_deadline_scope(context) as deadline:
        job = KeywordRunKpisBackfill(_search_results_table(), rollups, get_brand_config(), deadline, rebuild=event.get('rebuild') is True)
        return run_backfill(job, keyword_pages(keywords_table, keywords, cursor.scan_key), cursor)
