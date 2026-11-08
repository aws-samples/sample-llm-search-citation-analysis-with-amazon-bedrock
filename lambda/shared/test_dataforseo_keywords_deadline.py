"""Auto research under a ``call_deadline``: the parallel legs see it, a late fallback is skipped (review #1)."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from unittest.mock import patch

import pytest

from shared import dataforseo_client
from shared.dataforseo_client import call_deadline, remaining_deadline_s
from shared.dataforseo_keywords import research_keywords
from shared.dataforseo_labs import IDEAS_PATH, RELATED_PATH, SUGGESTIONS_PATH
from testing.dataforseo_endpoint_fixtures import LABS_US, FakePostLive, labs_items, labs_task

THIN_BLEND = {
    SUGGESTIONS_PATH: labs_task(labs_items('caregiving', 'respite care'), cost=0.02),
    IDEAS_PATH: labs_task(labs_items('elder care'), cost=0.02),
    RELATED_PATH: labs_task([{'keyword_data': item} for item in labs_items('care home')], cost=0.03),
}
"""Two non-seed rows: auto mode wants the ``related`` fallback."""


class DeadlineRecordingPostLive(FakePostLive):
    """``FakePostLive`` that also records the ``call_deadline`` time left each call saw."""

    def __init__(self) -> None:
        super().__init__()
        self.remaining: list[float | None] = []

    def __call__(self, path, task, **kwargs):
        self.remaining.append(remaining_deadline_s())
        return super().__call__(path, task, **kwargs)


@pytest.fixture
def fake(monkeypatch) -> Iterator[DeadlineRecordingPostLive]:
    """A recording ``post_live`` and a clock frozen at 100 s, answering ``THIN_BLEND``."""
    monkeypatch.setattr(dataforseo_client, '_monotonic', lambda: 100.0)
    post_live = DeadlineRecordingPostLive()
    post_live.by_path = dict(THIN_BLEND)
    with patch.object(dataforseo_client, 'post_live', post_live):
        yield post_live


def test_parallel_legs_see_the_callers_deadline(fake):
    with call_deadline(20.0):
        research_keywords('caregiving', LABS_US)

    assert fake.remaining[:2] == [20.0, 20.0]


@pytest.mark.parametrize(('seconds_left', 'falls_back'), [(7.9, False), (8.0, True)])
def test_reads_related_fallback_only_when_at_least_eight_seconds_remain(fake, seconds_left, falls_back):
    with call_deadline(seconds_left):
        result = research_keywords('caregiving', LABS_US)

    assert (RELATED_PATH in fake.paths(), result.used_fallback) == (falls_back, falls_back)


def test_returns_the_blend_and_its_cost_when_fallback_is_skipped(fake):
    with call_deadline(5.0):
        result = research_keywords('caregiving', LABS_US)

    assert ([row.keyword for row in result.rows], result.cost_usd) == (
        ['caregiving', 'elder care', 'respite care'], pytest.approx(0.04),
    )


def test_logs_the_skipped_fallback(fake, caplog):
    caplog.set_level(logging.WARNING, logger='shared.dataforseo_keywords')

    with call_deadline(5.0):
        research_keywords('caregiving', LABS_US)

    assert 'dataforseo.research.fallback-skipped remaining_s=5.0' in caplog.messages
