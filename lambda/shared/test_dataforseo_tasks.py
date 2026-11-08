"""Tests for the DataForSEO standard queue (``task_post`` / ``task_get``)."""

from __future__ import annotations

import json

import pytest

from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_tasks import get_task, post_tasks
from testing.dataforseo_fixtures import install_transport, top_level_error

POST_PATH = '/v3/serp/google/organic/task_post'
GET_PREFIX = '/v3/serp/google/organic/task_get/advanced'


def _entry(tag: str, *, status: int = 20100, task_id: str | None = 'task-a', cost: float = 0.0006,
           message: str = 'Task Created.') -> dict:
    entry = {'status_code': status, 'status_message': message, 'cost': cost, 'data': {'tag': tag}}
    if task_id is not None:
        entry['id'] = task_id
    return entry


def _post_answer(*entries: dict) -> dict:
    return {'status_code': 20000, 'status_message': 'Ok.', 'tasks': list(entries)}


def _get_answer(status: int, message: str = 'Ok.', result: list | None = None) -> dict:
    return {'status_code': 20000, 'status_message': 'Ok.',
            'tasks': [{'id': 'task-a', 'status_code': status, 'status_message': message, 'result': result}]}


def test_maps_accepted_entries_to_task_ids_by_tag_when_the_answer_order_differs(monkeypatch):
    install_transport(monkeypatch, _post_answer(_entry('kw-2#mobile', task_id='t-2'), _entry('kw-1#desktop', task_id='t-1')))

    posted = post_tasks(POST_PATH, [{'keyword': 'a', 'tag': 'kw-1#desktop'}, {'keyword': 'b', 'tag': 'kw-2#mobile'}])

    assert posted.accepted == {'kw-1#desktop': 't-1', 'kw-2#mobile': 't-2'}


def test_sums_the_cost_of_every_entry_when_one_is_rejected(monkeypatch):
    install_transport(monkeypatch, _post_answer(
        _entry('a', cost=0.0006), _entry('b', status=40501, task_id=None, cost=0.0006, message='Invalid Field'),
    ))

    posted = post_tasks(POST_PATH, [{'tag': 'a'}, {'tag': 'b'}])

    assert (posted.cost_usd, posted.rejected) == (0.0012, {'b': 'Invalid Field'})


def test_reports_a_task_missing_from_the_answer_as_rejected(monkeypatch):
    install_transport(monkeypatch, _post_answer(_entry('a')))

    posted = post_tasks(POST_PATH, [{'tag': 'a'}, {'tag': 'b'}])

    assert posted.rejected == {'b': 'DataForSEO did not answer for this task'}


def test_ignores_an_entry_whose_tag_was_not_posted(monkeypatch):
    install_transport(monkeypatch, _post_answer(_entry('a'), _entry('stranger', task_id='t-x')))

    posted = post_tasks(POST_PATH, [{'tag': 'a'}])

    assert posted.accepted == {'a': 'task-a'}


def test_sends_every_task_in_one_body_with_the_priority_when_given(monkeypatch):
    transport = install_transport(monkeypatch, _post_answer(_entry('a')))

    post_tasks(POST_PATH, [{'keyword': 'x', 'tag': 'a'}], priority=2)

    assert json.loads(transport.calls[0].body or b'[]') == [{'keyword': 'x', 'tag': 'a', 'priority': 2}]


def test_sets_the_pingback_url_on_every_task_when_given(monkeypatch):
    transport = install_transport(monkeypatch, _post_answer(_entry('a'), _entry('b')))

    post_tasks(POST_PATH, [{'tag': 'a'}, {'tag': 'b'}], pingback_url='https://cb.example/?gate=g&id=$id')

    sent = json.loads(transport.calls[0].body or b'[]')
    assert [task['pingback_url'] for task in sent] == ['https://cb.example/?gate=g&id=$id'] * 2


@pytest.mark.parametrize(('failure', 'message'), [((500, 'oops'), 'HTTP 500'), (TimeoutError('slow'), 'timed out')])
def test_never_retries_a_failed_post(monkeypatch, failure, message):
    transport = install_transport(monkeypatch, failure, _post_answer(_entry('a')))

    with pytest.raises(DataForSeoError, match=message):
        post_tasks(POST_PATH, [{'tag': 'a'}])
    assert len(transport.calls) == 1


def test_raises_upstream_unavailable_when_the_top_level_status_failed(monkeypatch):
    install_transport(monkeypatch, top_level_error(50000))

    with pytest.raises(DataForSeoError) as raised:
        post_tasks(POST_PATH, [{'tag': 'a'}])
    assert raised.value.code == 'UPSTREAM_UNAVAILABLE'


@pytest.mark.parametrize('tasks', [[], [{'tag': str(index)} for index in range(101)]])
def test_refuses_a_post_outside_one_to_one_hundred_tasks(tasks):
    with pytest.raises(ValueError, match='1 to 100'):
        post_tasks(POST_PATH, tasks)


@pytest.mark.parametrize('tasks', [[{'keyword': 'x'}], [{'tag': 'a'}, {'tag': 'a'}]])
def test_refuses_tasks_without_unique_tags(tasks):
    with pytest.raises(ValueError, match='tag'):
        post_tasks(POST_PATH, tasks)


@pytest.mark.parametrize('status', [20100, 40601, 40602])
def test_reads_a_task_still_in_the_queue_as_pending(monkeypatch, status):
    install_transport(monkeypatch, _get_answer(status, 'Task In Queue.'))

    assert get_task(GET_PREFIX, 'task-a').status == 'pending'


def test_reads_an_upstream_task_failure_as_pending_for_the_next_poll(monkeypatch):
    install_transport(monkeypatch, _get_answer(50301, '3rd Party API Service Unavailable.'))

    assert get_task(GET_PREFIX, 'task-a').status == 'pending'


@pytest.mark.parametrize(('answer', 'expected'), [
    (_get_answer(40501, 'No Search Results.'), ('completed', None)),
    (_get_answer(20000, result=[{'items': [{'type': 'organic'}]}]), ('completed', {'items': [{'type': 'organic'}]})),
    (_get_answer(40501, "Invalid Field: 'keyword'."), ('failed', None)),
])
def test_reads_a_finished_task_as_completed_or_failed(monkeypatch, answer, expected):
    install_transport(monkeypatch, answer)

    outcome = get_task(GET_PREFIX, 'task-a')

    assert (outcome.status, outcome.result) == expected


def test_gets_the_task_by_id_below_the_prefix(monkeypatch):
    transport = install_transport(monkeypatch, _get_answer(20000, result=[]))

    get_task(f'{GET_PREFIX}/', 'task-a')

    assert (transport.calls[0].method, transport.calls[0].url.endswith(f'{GET_PREFIX}/task-a')) == ('GET', True)


def test_retries_a_free_get_after_http_503(monkeypatch):
    transport = install_transport(monkeypatch, (503, 'busy'), _get_answer(20000, result=[]))

    get_task(GET_PREFIX, 'task-a')

    assert len(transport.calls) == 2


def test_raises_when_the_get_answer_holds_no_task(monkeypatch):
    install_transport(monkeypatch, {'status_code': 20000, 'status_message': 'Ok.', 'tasks': []})

    with pytest.raises(DataForSeoError, match='missing task'):
        get_task(GET_PREFIX, 'task-a')
