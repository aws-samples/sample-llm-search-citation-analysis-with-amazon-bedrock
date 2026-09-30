"""Test doubles for the ProcessKeywords Distributed Map's S3 hand-offs.

ParseKeywords writes a keyword manifest, the Map's ResultWriter writes a
results manifest plus results files, and GenerateSummary writes the full
report that KpiAlerts reads back. These builders stand in for those S3
objects so each side can be tested alone.
"""

from __future__ import annotations

import io
import json
from typing import Any
from unittest.mock import MagicMock

from botocore.exceptions import ClientError

RESULTS_BUCKET = 'citation-analysis-keywords-123456789012'
MANIFEST_KEY = 'runs/map-results/0f6c1e2a/manifest.json'
RUN_TIMESTAMP = '2026-10-01T10:00:00Z'


def fake_s3_objects(objects: dict[tuple[str, str], Any]) -> MagicMock:
    """An S3 client whose ``get_object`` serves ``objects`` (``(bucket, key) -> JSON value``) and 404s on anything else."""
    client = MagicMock(name='s3')

    def get_object(Bucket: str, Key: str) -> dict[str, Any]:
        if (Bucket, Key) not in objects:
            raise ClientError({'Error': {'Code': 'NoSuchKey', 'Message': Key}}, 'GetObject')
        return {'Body': io.BytesIO(json.dumps(objects[(Bucket, Key)]).encode('utf-8'))}

    client.get_object.side_effect = get_object
    return client


def compact_keyword_result(keyword: str = 'best hotels malaga', **overrides: Any) -> dict[str, Any]:
    """One ``SummarizeKeywordResult`` child output, as the workflow's Pass state shapes it."""
    return {
        'keyword': keyword,
        'timestamp': RUN_TIMESTAMP,
        'status': 'success',
        'provider_summary': {
            'result_count': 2,
            'by_provider': {'openai': {'queries': 1, 'citations': 3}, 'gemini': {'queries': 1, 'citations': 2}},
        },
        'unique_citations': 4,
        'total_citations_found': 5,
        'pages_crawled': 3,
        **overrides,
    }


def child_record(keyword: str, status: str = 'SUCCEEDED', output: dict[str, Any] | None = None) -> dict[str, Any]:
    """One ResultWriter record: ``Input``/``Output`` are JSON strings; a non-succeeded child carries ``Error``/``Cause``."""
    record: dict[str, Any] = {
        'Name': f'child-{keyword}',
        'Status': status,
        'Input': json.dumps({'keyword': keyword, 'timestamp': RUN_TIMESTAMP, 'query_prompts': []}),
    }
    if status == 'SUCCEEDED':
        record['Output'] = json.dumps(output if output is not None else compact_keyword_result(keyword))
    else:
        record['Error'] = 'States.TaskFailed'
        record['Cause'] = 'search exhausted its retries'
    return record


def map_run_pointer(bucket: str = RESULTS_BUCKET, key: str = MANIFEST_KEY) -> dict[str, Any]:
    """The ProcessKeywords output GenerateSummary receives as ``map_run``."""
    return {
        'MapRunArn': 'arn:aws:states:us-west-2:123456789012:mapRun:CitationAnalysis-Workflow/ProcessKeywords:0f6c1e2a',
        'ResultWriterDetails': {'Bucket': bucket, 'Key': key},
    }


def map_run_objects(
    succeeded: list[dict[str, Any]],
    failed: list[dict[str, Any]] | None = None,
) -> dict[tuple[str, str], Any]:
    """The results manifest plus one SUCCEEDED and (when given) one FAILED results file."""
    prefix = MANIFEST_KEY.rsplit('/', 1)[0]
    result_files: dict[str, list[dict[str, Any]]] = {'SUCCEEDED': [], 'FAILED': [], 'PENDING': []}
    objects: dict[tuple[str, str], Any] = {}
    for status, records in (('SUCCEEDED', succeeded), ('FAILED', failed or [])):
        if not records:
            continue
        key = f'{prefix}/{status}_0.json'
        result_files[status].append({'Key': key, 'Size': 1})
        objects[(RESULTS_BUCKET, key)] = records
    objects[(RESULTS_BUCKET, MANIFEST_KEY)] = {
        'DestinationBucket': RESULTS_BUCKET,
        'MapRunArn': map_run_pointer()['MapRunArn'],
        'ResultFiles': result_files,
    }
    return objects
