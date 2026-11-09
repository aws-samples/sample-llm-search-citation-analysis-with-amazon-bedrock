"""Tests for the SEO jobs dispatcher."""

from __future__ import annotations

from pathlib import Path

import pytest

from shared.change_events import SEO_JOB_CHANGED
from testing.module_loader import load_handler_module

JOBS_DIR = Path(__file__).resolve().parent


@pytest.fixture
def jobs_module():
    module = load_handler_module(str(JOBS_DIR), 'seo-jobs.py')
    module.steps.cache_clear()
    yield module
    module.steps.cache_clear()


def test_raises_unknown_step_when_the_event_names_no_registered_step(jobs_module):
    with pytest.raises(jobs_module.UnknownStepError, match=r'nope\.missing'):
        jobs_module.handler({'step': 'nope.missing'}, None)


def test_raises_unknown_step_when_the_event_has_no_step(jobs_module):
    with pytest.raises(jobs_module.UnknownStepError, match='None'):
        jobs_module.handler({}, None)


def test_calls_the_registered_step_with_the_whole_event(jobs_module, monkeypatch):
    seen: list[dict] = []
    monkeypatch.setattr(jobs_module, 'steps', lambda: {'demo.echo': lambda event: seen.append(event) or {'ok': True}})

    result = jobs_module.handler({'step': 'demo.echo', 'tracker_id': 't-1'}, None)

    assert (result, seen) == ({'ok': True}, [{'step': 'demo.echo', 'tracker_id': 't-1'}])


class StepFailedError(RuntimeError):
    """A step that raises, as a failed DataForSEO call would."""


def _raise(_event: dict) -> dict:
    raise StepFailedError('boom')


@pytest.mark.parametrize(('event', 'announced'), [
    ({'step': 'rank.collect', 'tracker_id': 't-1', 'run_id': 'r-1'}, [{'feature': 'rank', 'id': 't-1'}]),
    ({'step': 'rank.post', 'state': {'tracker_id': 't-2'}, 'task_token': 'x'}, [{'feature': 'rank', 'id': 't-2'}]),
    ({'step': 'local.collect', 'job_id': 'j-1'}, [{'feature': 'local', 'id': 'j-1'}]),
    ({'step': 'lighthouse.measure', 'run_id': 'l-1'}, [{'feature': 'lighthouse', 'id': 'l-1'}]),
    ({'step': 'audit.crawl', 'audit_id': 'a-1', 'chunk_no': 2}, [{'feature': 'audit', 'id': 'a-1'}]),
    ({'step': 'domain.snapshot_all'}, []),
    ({'step': 'local.collect'}, []),
], ids=['rank', 'rank in state', 'local', 'lighthouse', 'audit', 'unwatched feature', 'no id'])
def test_a_step_announces_the_job_it_ran_for(jobs_module, monkeypatch, change_events_bus, event, announced):
    monkeypatch.setattr(jobs_module, 'steps', lambda: {event['step']: lambda _event: {'ok': True}})

    jobs_module.handler(event, None)

    assert change_events_bus.details(SEO_JOB_CHANGED) == announced


def test_a_step_that_raises_still_announces_its_job(jobs_module, monkeypatch, change_events_bus):
    monkeypatch.setattr(jobs_module, 'steps', lambda: {'audit.crawl': _raise})

    with pytest.raises(StepFailedError):
        jobs_module.handler({'step': 'audit.crawl', 'audit_id': 'a-1'}, None)

    assert change_events_bus.details(SEO_JOB_CHANGED) == [{'feature': 'audit', 'id': 'a-1'}]
