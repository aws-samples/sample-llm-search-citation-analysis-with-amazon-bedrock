"""Tests for the SEO jobs dispatcher."""

from __future__ import annotations

from pathlib import Path

import pytest

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
