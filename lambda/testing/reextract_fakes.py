"""Doubles for the re-extract tests (``shared.reextract*``, ``api/manage-reextract.py``, ``search/reextract_worker.py``).

- ``FakeJobs``: the job store's interface over one in-memory job (step checks and ``touched_keywords`` included).
- ``JobTable``: a job table that answers ``get_item`` / ``put_item`` / ``delete_item`` / ``update_item`` with the
  conditions ``shared.reextract_jobs`` sends, so the store itself runs for real in the tests.
- ``answer_row`` / ``answers_table``: SearchResults rows and a table holding them that also answers the brand rewrite.
- ``RecordingInvoker``: a Lambda client recording each asynchronous invocation (function and payload).
"""

from __future__ import annotations

import copy
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from botocore.exceptions import ClientError

from shared.reextract_jobs import StaleStepError
from testing.memory_dynamodb import MemoryTable, stored

SEARCH_TABLE = 'test-search-results'
KEYWORDS_TABLE = 'test-keywords'
RUN_DAY = '2026-10-01'


def answer_row(keyword: str, provider: str = 'openai', *, day: str = RUN_DAY, **fields: Any) -> dict[str, Any]:
    """A stored answer of ``keyword`` (an answer engine's success row with text, under no brand rule) plus ``fields``."""
    timestamp = f'{day}T10:00:00.000000Z'
    return {
        'keyword': keyword, 'timestamp_provider': f'{timestamp}#{provider}#default', 'timestamp': timestamp,
        'provider': provider, 'provider_type': 'llm', 'status': 'success', 'market_id': 'global',
        'response': f'{keyword}: Costamar Brisa is lovely.', 'brands': [{'name': 'Costamar'}], 'brand_count': 1,
        **fields,
    }


@dataclass
class AnswersTable(MemoryTable):
    """A SearchResults table that also answers the brand rewrite ``reextract_worker.replace_brands`` sends."""

    updates: list[dict[str, Any]] = field(default_factory=list)
    update_error: Exception | None = None

    def update_item(self, Key: Mapping[str, Any], **params: Any) -> dict[str, Any]:
        if self.update_error is not None:
            raise self.update_error
        row = self.rows.get(self._row_key(stored(Key)))
        values = stored(params['ExpressionAttributeValues'])
        outdated_only = 'brands_version < :version' in params['ConditionExpression']
        if row is None or (outdated_only and row.get('brands_version') is not None and row['brands_version'] >= values[':version']):
            raise conditional_failure()
        row.update({
            'brands': values[':brands'], 'brand_count': values[':count'], 'brands_version': values[':version'],
            'brands_extracted_at': values[':now'], 'brands_model': values[':model'],
            'brands_extracted_by': values[':actor'], 'brands_job_id': values[':job'],
            'brands_history': list(row.get('brands_history') or values[':empty']) + values[':previous'],
        })
        self.updates.append(dict(Key))
        return {}


def answers_table(rows: Iterable[Mapping[str, Any]]) -> AnswersTable:
    """A SearchResults table holding ``rows``."""
    table = AnswersTable(SEARCH_TABLE, ('keyword', 'timestamp_provider'))
    table.put_rows(list(rows))
    return table


def keyword_item(keyword: str, *, keyword_id: str | None = None, group_ids: Iterable[str] = (), market_id: str | None = None) -> dict[str, Any]:
    """An active Keywords item as ``StatusIndex`` projects it."""
    item: dict[str, Any] = {'id': keyword_id or f'id-{keyword}', 'keyword': keyword, 'status': 'active'}
    if group_ids:
        item['group_ids'] = set(group_ids)
    if market_id:
        item['market_id'] = market_id
    return item


def conditional_failure(operation: str = 'UpdateItem') -> ClientError:
    return ClientError({'Error': {'Code': 'ConditionalCheckFailedException', 'Message': 'The conditional request failed'}}, operation)


@dataclass
class FakeJobs:
    """``ReextractJobs`` over one job item: ``save`` checks the step, applies the changes and adds the touched keywords."""

    job: dict[str, Any]
    saves: list[dict[str, Any]] = field(default_factory=list)
    released: list[str] = field(default_factory=list)
    stop_after_saves: int | None = None

    def get(self, job_id: str) -> dict[str, Any] | None:
        return copy.deepcopy(self.job) if job_id == self.job['job_id'] else None

    def save(self, job_id: str, step: int, changes: Mapping[str, Any], touched: set[str] | None = None) -> dict[str, Any]:
        if job_id != self.job['job_id'] or int(self.job.get('step') or 0) != step:
            raise StaleStepError(job_id)
        self.job.update(changes)
        if touched:
            self.job['touched_keywords'] = set(self.job.get('touched_keywords') or set()) | touched
        self.saves.append(dict(changes))
        if self.stop_after_saves is not None and len(self.saves) >= self.stop_after_saves and self.job['status'] == 'running':
            self.job['status'] = 'stopping'
        return copy.deepcopy(self.job)

    def release(self, job_id: str) -> None:
        self.released.append(job_id)


class JobTable:
    """A job table answering exactly the requests ``shared.reextract_jobs.ReextractJobs`` makes."""

    def __init__(self) -> None:
        self.items: dict[str, dict[str, Any]] = {}

    def get_item(self, Key: Mapping[str, Any], **_params: Any) -> dict[str, Any]:
        item = self.items.get(Key['job_id'])
        return {'Item': copy.deepcopy(item)} if item is not None else {}

    def _pointer_free(self, params: Mapping[str, Any]) -> bool:
        pointer = self.items.get('current')
        condition = params.get('ConditionExpression')
        if condition is None:
            return True
        if condition.startswith('attribute_not_exists'):
            return pointer is None or pointer.get('active') is False
        return pointer is not None and pointer.get('job_ref') == params['ExpressionAttributeValues'][':previous']

    def put_item(self, Item: Mapping[str, Any], **params: Any) -> dict[str, Any]:
        if not self._pointer_free(params):
            raise conditional_failure('PutItem')
        self.items[str(Item['job_id'])] = copy.deepcopy(dict(Item))
        return {}

    def delete_item(self, Key: Mapping[str, Any], **_params: Any) -> dict[str, Any]:
        self.items.pop(Key['job_id'], None)
        return {}

    def _update_holds(self, item: Mapping[str, Any] | None, condition: str, values: Mapping[str, Any]) -> bool:
        if item is None:
            return False
        checks = {
            '#step = :step': lambda: item.get('step') == values.get(':step'),
            'job_ref = :job': lambda: item.get('job_ref') == values.get(':job'),
            'attribute_exists(job_id) AND #status = :running': lambda: item.get('status') == 'running',
            '#status IN (:running, :stopping)': lambda: item.get('status') in ('running', 'stopping'),
        }
        return checks[condition]()

    def update_item(self, Key: Mapping[str, Any], **params: Any) -> dict[str, Any]:
        item = self.items.get(Key['job_id'])
        names, values = params.get('ExpressionAttributeNames') or {}, params.get('ExpressionAttributeValues') or {}
        if not self._update_holds(item, params['ConditionExpression'], values) or item is None:
            raise conditional_failure()
        expression = params['UpdateExpression']
        assignments, _, added = expression.removeprefix('SET ').partition(' ADD ')
        for assignment in assignments.split(', '):
            name, value = (part.strip() for part in assignment.split(' = '))
            item[names.get(name, name)] = values[value]
        if added:
            attribute, value = added.split()
            item[attribute] = set(item.get(attribute) or set()) | values[value]
        return {'Attributes': copy.deepcopy(item)}


@dataclass
class RecordingInvoker:
    """A Lambda client recording every asynchronous invocation: ``(function name, payload)``."""

    calls: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    error: Exception | None = None

    def invoke(self, **params: Any) -> dict[str, Any]:
        if self.error is not None:
            raise self.error
        self.calls.append((params['FunctionName'], json.loads(params['Payload'])))
        return {'StatusCode': 202}
