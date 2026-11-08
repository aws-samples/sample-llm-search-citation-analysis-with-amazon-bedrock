"""``dataforseo_client.call_deadline``: every call inside it finishes before the Lambda's remaining time runs out."""

from __future__ import annotations

import contextvars
from concurrent.futures import ThreadPoolExecutor

import pytest

from shared import dataforseo_client
from shared.dataforseo_client import DataForSeoError, call_deadline, get_free, post_live, remaining_deadline_s
from testing.dataforseo_fixtures import (
    LABS_IDEAS_PATH,
    LABS_IDEAS_TASK,
    install_transport,
    ok_envelope,
    user_data_envelope,
)


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    """A monotonic clock that stands still at 100 s, so the remaining time is exactly what the test sets."""
    monkeypatch.setattr(dataforseo_client, '_monotonic', lambda: 100.0)


def test_caps_post_timeout_to_remaining_deadline_when_deadline_is_shorter(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope())

    with call_deadline(7.5):
        post_live(LABS_IDEAS_PATH, LABS_IDEAS_TASK, timeout_s=25.0)

    assert transport.calls[0].timeout_s == 7.5


def test_keeps_call_timeout_when_deadline_is_longer(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope())

    with call_deadline(60.0):
        post_live(LABS_IDEAS_PATH, LABS_IDEAS_TASK, timeout_s=25.0)

    assert transport.calls[0].timeout_s == 25.0


def test_caps_free_get_timeout_to_remaining_deadline(monkeypatch):
    transport = install_transport(monkeypatch, user_data_envelope())

    with call_deadline(3.0):
        get_free('/v3/appendix/user_data')

    assert transport.calls[0].timeout_s == 3.0


def test_refuses_unsent_with_upstream_unavailable_when_less_than_one_second_remains(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope())

    with call_deadline(0.5), pytest.raises(DataForSeoError) as excinfo:
        post_live(LABS_IDEAS_PATH, LABS_IDEAS_TASK)

    assert (excinfo.value.code, transport.calls) == ('UPSTREAM_UNAVAILABLE', [])


def test_nested_deadline_never_extends_the_outer_one():
    with call_deadline(5.0), call_deadline(20.0):
        remaining = remaining_deadline_s()

    assert remaining == 5.0


def test_has_no_deadline_after_the_block_exits():
    with call_deadline(5.0):
        pass

    assert remaining_deadline_s() is None


def test_thread_run_in_copied_context_sees_the_deadline():
    with call_deadline(4.0), ThreadPoolExecutor(max_workers=1) as pool:
        remaining = pool.submit(contextvars.copy_context().run, remaining_deadline_s).result()

    assert remaining == 4.0
