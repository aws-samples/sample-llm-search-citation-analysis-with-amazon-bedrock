"""
The ``build_citation_rollup`` action of the GenerateSummary Lambda.

The workflow invokes GenerateSummary a second time after each run with
``{"action": "build_citation_rollup", "execution_id": "..."}``, and
``GET /api/citations`` invokes it asynchronously with
``{"action": "build_citation_rollup", "reason": "..."}`` when the published
rollup is stale. Both build ``shared.citation_rollup`` from the Citations
table (``shared.citation_rollup_build.build_rollup``) under a deadline that
ends ``BUILD_MARGIN_SECONDS`` before the Lambda's timeout, so a build that
cannot finish raises before switching ``current.json``.

Environment: ``CITATION_ROLLUP_BUCKET`` (else ``SUMMARY_BUCKET``, the same
keywords bucket), ``DYNAMODB_TABLE_CITATIONS``, ``DYNAMODB_TABLE_KEYWORDS``
and ``DYNAMODB_TABLE_BRAND_CONFIG``.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import boto3
from botocore.config import Config

from shared.citation_rollup import ROLLUP_BUCKET_ENV
from shared.citation_rollup_build import WRITE_WORKERS, RollupSources, build_rollup
from shared.request_deadline import Deadline, activate_deadline, budget_from_context, clear_request_deadline
from shared.scope_params import keywords_table_name, scoped_dynamodb_resource
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)

#: Seconds kept back from the Lambda's timeout: the build stops before them and raises.
BUILD_MARGIN_SECONDS = 30.0


class RollupConfigurationError(RuntimeError):
    """The Lambda has no bucket or Citations table to build the rollup with."""


def _required_env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    raise RollupConfigurationError(f"Set {' or '.join(names)} to build the citation rollup")


def rollup_sources() -> RollupSources:
    """The tables and bucket from the environment, with connection pools sized for the parallel reads and writes."""
    dynamodb = scoped_dynamodb_resource()
    return RollupSources(
        citations_table=dynamodb.Table(_required_env('DYNAMODB_TABLE_CITATIONS')),
        keywords_table=dynamodb.Table(keywords_table_name()),
        s3=boto3.client('s3', config=Config(max_pool_connections=WRITE_WORKERS)),
        bucket=_required_env(ROLLUP_BUCKET_ENV, 'SUMMARY_BUCKET'),
        brand_config=get_brand_config(os.environ.get('DYNAMODB_TABLE_BRAND_CONFIG')),
    )


def build_citation_rollup(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Build and publish the rollup; the build summary (``status``, ``build_id``, counts, ``seconds``)."""
    logger.info('Building the citation rollup (%s)', event.get('reason') or event.get('execution_id') or 'direct')
    activate_deadline(Deadline(budget_from_context(context, BUILD_MARGIN_SECONDS)))
    try:
        summary = build_rollup(rollup_sources())
    finally:
        clear_request_deadline()
    logger.info('Citation rollup: %s', summary)
    return summary
