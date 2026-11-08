"""Fetch classification (``shared.audit_classify``) and crawl politeness (``shared.audit_throttle``)."""

from __future__ import annotations

import pytest

from shared.audit_classify import classify_fetch
from shared.audit_throttle import Throttle, retry_after_ms


@pytest.mark.parametrize(('status', 'headers', 'body', 'expected'), [
    (0, {}, '', 'error'),
    (429, {'cf-mitigated': 'challenge'}, '', 'rate_limited'),
    (200, {'cf-mitigated': 'challenge'}, '', 'blocked'),
    (403, {}, '', 'blocked'),
    (401, {}, '', 'blocked'),
    (202, {}, '', 'blocked'),
    (200, {}, '<html><title>Just a moment...</title>', 'blocked'),
    (503, {}, 'Verifying you are human', 'blocked'),
    (503, {}, 'Service unavailable', 'ok'),
    (404, {}, '', 'ok'),
    (200, {}, '<html><title>Home</title>', 'ok'),
])
def test_classification_follows_the_fixed_order(status, headers, body, expected):
    assert classify_fetch(status, headers, body) == expected


def test_retry_after_reads_delta_seconds():
    assert retry_after_ms('7', now_ms=0) == 7_000


def test_retry_after_reads_an_http_date():
    assert retry_after_ms('Thu, 01 Jan 1970 00:00:10 GMT', now_ms=4_000) == 6_000


def test_retry_after_is_none_when_unreadable():
    assert retry_after_ms('soon', now_ms=0) is None


def test_requests_are_spaced_one_second_apart_by_default():
    throttle = Throttle()
    throttle.record_request(10_000)

    assert throttle.wait_ms(10_200) == 800


def test_first_429_without_retry_after_pauses_thirty_seconds_and_doubles_the_interval():
    throttle = Throttle()
    delay = throttle.record_rate_limited(None, now=0)

    assert (delay, throttle.interval_ms, throttle.consecutive) == (30_000, 2_000, 1)


def test_retry_after_longer_than_the_interval_sets_the_pause():
    throttle = Throttle()

    assert throttle.record_rate_limited('45', now=0) == 45_000


def test_crawl_stops_after_more_than_three_429s_in_a_row():
    throttle = Throttle()
    for _ in range(4):
        throttle.record_rate_limited('1', now=0)

    assert throttle.stopped


def test_a_normal_answer_resets_the_consecutive_429_count():
    throttle = Throttle()
    for _ in range(3):
        throttle.record_rate_limited('1', now=0)
    throttle.record_response()
    throttle.record_rate_limited('1', now=0)

    assert (throttle.consecutive, throttle.stopped) == (1, False)


def test_crawl_stops_when_pauses_exceed_thirty_minutes():
    throttle = Throttle()
    throttle.record_rate_limited(str(31 * 60), now=0)

    assert throttle.stopped


def test_state_round_trips_through_json():
    throttle = Throttle()
    throttle.record_rate_limited('5', now=1_000)

    assert Throttle.from_state(throttle.to_state()) == throttle


def test_state_falls_back_to_defaults_when_garbled():
    assert Throttle.from_state({'interval_ms': 'x', 'consecutive': True}) == Throttle()
