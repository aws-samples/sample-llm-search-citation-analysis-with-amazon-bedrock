"""
The SearchResults reads of the mention views, by row key (``/brand-mentions``, ``/visibility/sentiment-examples`` and their view jobs).

- ``preview_rows``: the rows a brand summary's previews name (no answer text),
  ``BATCH_KEYS`` per BatchGetItem, until the time budget is spent;
- ``answer_texts``: the answer text of one page of sentiment examples, in one
  BatchGetItem, nothing once the budget is spent (the page then says ``truncated``);
- ``job_readers``: the reads a mention view job makes (``shared.mention_view_jobs.JobReaders``):
  each keyword's selected run projected with ``JOB_PROJECTION``, the two above,
  and the run listing of a summary's ``available_runs``.

The handlers and the GenerateSummary Lambda's view jobs share them, so a job
reads exactly what the request it stands in for would.
"""

from __future__ import annotations

from typing import Any

from shared.answer_queries import latest_run_timestamp
from shared.brand_mention_views import SCOPE_ATTRIBUTE_NAMES, SCOPE_PROJECTION, list_runs, read_run_rows
from shared.dynamodb_batch import batch_get_items
from shared.mention_view_jobs import JOB_ATTRIBUTE_NAMES, JOB_PROJECTION, JobReaders
from shared.request_deadline import current_deadline

#: BatchGetItem's key limit per call.
BATCH_KEYS = 100

#: What a brand preview reads of its row: the summary's projection plus the key it is joined back on.
PREVIEW_PROJECTION = f'{SCOPE_PROJECTION}, timestamp_provider'

#: What an example's answer text is read from: the row's key (to join it back) and the answer.
ANSWER_TEXT_PROJECTION = 'keyword, timestamp_provider, #rsp'
ANSWER_TEXT_ATTRIBUTE_NAMES = {'#rsp': 'response'}

RowKey = tuple[str, str]


def _row_key(item: dict[str, Any]) -> RowKey:
    return str(item.get('keyword')), str(item.get('timestamp_provider'))


def preview_rows(resource: Any, table_name: str, keys: list[RowKey]) -> dict[RowKey, dict[str, Any]]:
    """The rows at ``keys``, ``BATCH_KEYS`` per BatchGetItem, until the request's time budget is spent."""
    rows: dict[RowKey, dict[str, Any]] = {}
    for start in range(0, len(keys), BATCH_KEYS):
        if current_deadline().stop_reading('the brand previews'):
            break
        chunk = [{'keyword': keyword, 'timestamp_provider': sort_key} for keyword, sort_key in keys[start:start + BATCH_KEYS]]
        for item in batch_get_items(resource, table_name, chunk, projection=PREVIEW_PROJECTION, attribute_names=SCOPE_ATTRIBUTE_NAMES):
            rows[_row_key(item)] = item
    return rows


def answer_texts(resource: Any, table_name: str, keys: list[RowKey]) -> dict[RowKey, str]:
    """The answer text of the rows at ``keys`` (one page's rows), in one BatchGetItem; nothing once the time budget is spent."""
    if not keys or current_deadline().stop_reading('the example answers'):
        return {}
    items = batch_get_items(
        resource, table_name, [{'keyword': keyword, 'timestamp_provider': sort_key} for keyword, sort_key in keys],
        projection=ANSWER_TEXT_PROJECTION, attribute_names=ANSWER_TEXT_ATTRIBUTE_NAMES,
    )
    return {_row_key(item): response for item in items if isinstance(response := item.get('response'), str)}


def job_readers(resource: Any, table_name: str) -> JobReaders:
    """The reads of a mention view job over the SearchResults table ``table_name``."""
    table = resource.Table(table_name)

    def selected_run(keyword: str, timestamp: str | None) -> tuple[str | None, list[dict[str, Any]]]:
        return read_run_rows(table, keyword, timestamp, projection=JOB_PROJECTION, attribute_names=JOB_ATTRIBUTE_NAMES)

    def run_listing(keyword: str, depth: int) -> list[str]:
        return list_runs(table, keyword, latest_run_timestamp(table, keyword), depth)

    return JobReaders(
        selected_run=selected_run,
        preview_rows=lambda keys: preview_rows(resource, table_name, keys),
        answer_texts=lambda keys: answer_texts(resource, table_name, keys),
        run_listing=run_listing,
    )


__all__ = [
    'ANSWER_TEXT_ATTRIBUTE_NAMES',
    'ANSWER_TEXT_PROJECTION',
    'BATCH_KEYS',
    'PREVIEW_PROJECTION',
    'answer_texts',
    'job_readers',
    'preview_rows',
]
