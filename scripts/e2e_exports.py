#!/usr/bin/env python3
"""
Live end-to-end check of the server export service on a deployed stack (``npm run e2e:exports``). Free: it exports
data already stored, so no AI engine, search provider or DataForSEO is called.

Against the real ``CitationAnalysis-API-Exports`` Lambda and ``CitationAnalysis-Export`` state machine, as an Admin:

1. Keyword research, one job of each type (Research Agent, keyword expansion, competitor analysis): the newest of
   ``GET /api/keyword-research/history`` that finished (``completed`` or ``partial``) with keywords.
   ``POST /api/exports`` with the job id must answer 202, and the export must end ``ready`` with rows. Each type's detail route answers only the lists of its type, which failed every such export with
   ``ExportSourceError`` until 2.54.4 (``answered without its list analysis``).
2. The ready file downloads through its presigned URL and is a workbook (XLSX is a zip: it starts with ``PK``) of
   the size the export reports.
3. Each export is deleted again (``DELETE /api/exports/{id}``), also when a step fails.

A type with no finished job yet is skipped and reported. It runs against a deployed stack with AWS credentials that may
invoke its API Lambdas, so `npm run validate` leaves it out.

Usage: ``.venv/bin/python scripts/e2e_exports.py [--region us-west-2] [--timeout 300]``
"""

from __future__ import annotations

import argparse
import http.client
import sys
import time
from typing import Any
from urllib.parse import urlsplit

from e2e_live import E2EFailureError, LiveApi, api_event, expect, require

EXPORTS = 'CitationAnalysis-API-Exports'
RESEARCH = 'CitationAnalysis-API-KeywordMgmt'
JOB_TYPES = ('agent', 'expansion', 'competitor')
EXPORT_RESOURCE = '/api/exports/{id}'
POLL_SECONDS = 5
FINISHED = ('ready', 'failed', 'cancelled')
#: A job of these statuses has results; ``failed`` jobs and running ones are passed over.
RESULT_STATUSES = ('completed', 'partial')
#: How far back the history is searched for a finished job of each type.
HISTORY_LIMIT = 20


def newest_job(api: LiveApi, job_type: str) -> dict[str, Any] | None:
    """The newest research job of ``job_type`` that finished with results, or ``None`` when there is none yet.

    A running job, or one that failed with no keywords, would export an incomplete or empty file and check no data.
    """
    query = {'type': job_type, 'limit': str(HISTORY_LIMIT)}
    status, body = api.call(RESEARCH, api_event('GET', '/api/keyword-research/history', query=query))
    items = expect(f'keyword research history of {job_type} jobs', status, body, 200).get('items') or []
    return next((item for item in items if item.get('status') in RESULT_STATUSES and int(item.get('keyword_count') or 0) > 0), None)


def start_export(api: LiveApi, job_type: str, job_id: str) -> str:
    body = {'view': 'keyword-research', 'params': {'id': job_id}, 'format': 'xlsx'}
    status, answer = api.call(EXPORTS, api_event('POST', '/api/exports', body))
    export = expect(f'start the export of {job_type} job {job_id}', status, answer, 202).get('export') or {}
    require('the export has an id', isinstance(export.get('export_id'), str), export)
    return export['export_id']


def read_export(api: LiveApi, export_id: str) -> dict[str, object]:
    event = api_event('GET', f'/api/exports/{export_id}', resource=EXPORT_RESOURCE, path_params={'id': export_id})
    status, answer = api.call(EXPORTS, event)
    if status != 200:
        raise E2EFailureError(f'read export {export_id}: expected HTTP 200, got {status} {answer}')
    return answer.get('export') or {}


def wait_for(api: LiveApi, job_type: str, export_id: str, timeout: float) -> dict[str, object]:
    """The export once it has finished; fails unless it ended ``ready`` within ``timeout`` seconds."""
    deadline = time.monotonic() + timeout
    export = read_export(api, export_id)
    while export.get('status') not in FINISHED:
        if time.monotonic() > deadline:
            raise E2EFailureError(f'{job_type} export {export_id} still {export.get("status")} after {timeout:.0f} s')
        time.sleep(POLL_SECONDS)
        export = read_export(api, export_id)
    require(f'the {job_type} export ends ready ({export.get("rows")} rows)', export.get('status') == 'ready', export)
    return export


def download(url: str) -> bytes:
    """The body of a presigned HTTPS GET."""
    parts = urlsplit(url)
    require('the download URL is HTTPS', parts.scheme == 'https' and bool(parts.hostname), parts.scheme)
    connection = http.client.HTTPSConnection(str(parts.hostname), timeout=60)
    try:
        connection.request('GET', f'{parts.path}?{parts.query}')
        response = connection.getresponse()
        body = response.read()
    finally:
        connection.close()
    require('the file downloads (HTTP 200)', response.status == 200, response.status)
    return body


def check_file(job_type: str, export: dict[str, object]) -> None:
    url = export.get('download_url')
    require(f'the {job_type} export offers a download', isinstance(url, str), sorted(export))
    body = download(str(url))
    require(f'the {job_type} file is a workbook of the size the export reports',
            body[:2] == b'PK' and len(body) == export.get('bytes'), {'start': body[:2], 'size': len(body), 'bytes': export.get('bytes')})


def delete_export(api: LiveApi, export_id: str) -> None:
    event = api_event('DELETE', f'/api/exports/{export_id}', resource=EXPORT_RESOURCE, path_params={'id': export_id})
    status, answer = api.call(EXPORTS, event)
    if status not in (200, 204):
        print(f'warn could not delete export {export_id}: HTTP {status} {answer}', file=sys.stderr)


def run(api: LiveApi, timeout: float) -> list[str]:
    """Export one finished job of every type; the types that have none yet."""
    skipped: list[str] = []
    for job_type in JOB_TYPES:
        job = newest_job(api, job_type)
        if job is None:
            skipped.append(job_type)
            continue
        print(f'..   {job_type} job {job["id"]}: {job.get("status")}, {job.get("keyword_count")} keywords')
        export_id = start_export(api, job_type, str(job['id']))
        try:
            export = wait_for(api, job_type, export_id, timeout)
            rows = export.get('rows')
            require(f'the {job_type} export holds rows', isinstance(rows, int) and rows > 0, export)
            check_file(job_type, export)
        finally:
            delete_export(api, export_id)
    return skipped


def main() -> int:
    parser = argparse.ArgumentParser(description='Live end-to-end check of the export service (stored data only).')
    parser.add_argument('--region', default='us-west-2')
    parser.add_argument('--timeout', type=float, default=300, help='Seconds each export may take')
    args = parser.parse_args()
    try:
        skipped = run(LiveApi(args.region), args.timeout)
    except E2EFailureError as failure:
        print(f'FAIL {failure}', file=sys.stderr)
        return 1
    if skipped:
        print(f'skip no {", ".join(skipped)} research job to export yet')
    print('PASS exports')
    return 0


if __name__ == '__main__':
    sys.exit(main())
