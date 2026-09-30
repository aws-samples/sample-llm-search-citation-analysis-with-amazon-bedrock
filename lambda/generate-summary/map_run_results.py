"""
Reading the ProcessKeywords Distributed Map's results back from S3.

The Map writes one record per keyword (child execution) through its
ResultWriter instead of returning them in the state, which is capped at
256 KiB (~31 keywords of the old inline results). Its output is only a pointer:

    {"MapRunArn": "...", "ResultWriterDetails": {"Bucket": "...", "Key": ".../manifest.json"}}

The manifest lists the results files per child status::

    {"DestinationBucket": "...", "ResultFiles": {"SUCCEEDED": [{"Key": "...", "Size": 1}], "FAILED": [...], "PENDING": [...]}}

and each results file is a JSON array of child records carrying ``Status``,
``Input`` (a JSON string: the ItemSelector output) and either ``Output`` (a JSON
string: the compact ``SummarizeKeywordResult``) or ``Error`` / ``Cause``.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Child statuses the ResultWriter files records under, in report order.
RESULT_FILE_STATUSES = ('SUCCEEDED', 'FAILED', 'PENDING')

# Placeholder error for keywords the manifest counted but no results file holds.
MISSING_RESULT_ERROR = 'result_missing'


class MapRunResultsError(Exception):
    """Raised when the Map run's ResultWriter output cannot be located."""


def _read_json(s3_client: Any, bucket: str, key: str) -> Any:
    response = s3_client.get_object(Bucket=bucket, Key=key)
    return json.loads(response['Body'].read())


def _loads_object(raw: Any) -> dict[str, Any] | None:
    """A child record's ``Input`` / ``Output``: a JSON-encoded object, or ``None`` when absent or malformed."""
    if not isinstance(raw, str):
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def keyword_result_from_record(record: Any) -> dict[str, Any]:
    """One ``keyword_results`` element from a ResultWriter child record.

    A succeeded child yields its compact output unchanged. Any other child
    (failed, aborted, timed out, pending) yields a failed result that keeps the
    keyword and run timestamp from its input, so the summary still names it.
    """
    if not isinstance(record, dict):
        return {'status': 'failed', 'error': 'malformed_result_record'}
    if record.get('Status') == 'SUCCEEDED':
        output = _loads_object(record.get('Output'))
        if output is not None:
            return output
    identity = _loads_object(record.get('Input')) or {}
    return {
        'keyword': identity.get('keyword'),
        'timestamp': identity.get('timestamp'),
        'status': 'failed',
        'error': str(record.get('Error') or record.get('Status') or 'unknown'),
    }


def _result_file_keys(manifest: Any) -> list[str]:
    result_files = manifest.get('ResultFiles') if isinstance(manifest, dict) else None
    if not isinstance(result_files, dict):
        return []
    return [
        entry['Key']
        for status in RESULT_FILE_STATUSES
        for entry in result_files.get(status) or []
        if isinstance(entry, dict) and isinstance(entry.get('Key'), str)
    ]


def load_keyword_results(
    s3_client: Any,
    map_run: Any,
    keyword_count: int,
    timestamp: str | None = None,
) -> list[dict[str, Any]]:
    """Every keyword's result for a Map run, from its ResultWriter manifest and results files.

    ``keyword_count`` is how many keywords ParseKeywords handed the Map; any
    keyword with no record is reported as a failed result (``result_missing``,
    stamped with the run ``timestamp``) so a lost record can never raise the
    success rate.

    Raises:
        MapRunResultsError: When ``map_run`` does not name a ResultWriter manifest.
    """
    details = map_run.get('ResultWriterDetails') if isinstance(map_run, dict) else None
    bucket = details.get('Bucket') if isinstance(details, dict) else None
    key = details.get('Key') if isinstance(details, dict) else None
    if not isinstance(bucket, str) or not isinstance(key, str):
        raise MapRunResultsError('The ProcessKeywords output carries no ResultWriterDetails Bucket/Key')

    manifest = _read_json(s3_client, bucket, key)
    destination = manifest.get('DestinationBucket') if isinstance(manifest, dict) else None
    results_bucket = destination if isinstance(destination, str) and destination else bucket

    keyword_results: list[dict[str, Any]] = []
    for results_key in _result_file_keys(manifest):
        records = _read_json(s3_client, results_bucket, results_key)
        keyword_results.extend(keyword_result_from_record(record) for record in records or [])

    missing = keyword_count - len(keyword_results)
    if missing > 0:
        logger.warning(f"{missing} of {keyword_count} keywords have no Map run result record")
        keyword_results.extend(
            {'timestamp': timestamp, 'status': 'failed', 'error': MISSING_RESULT_ERROR} for _ in range(missing)
        )
    return keyword_results
