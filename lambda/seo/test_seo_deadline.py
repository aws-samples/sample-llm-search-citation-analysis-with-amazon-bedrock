"""``seo_http.within_lambda_deadline``: SEO routes cap DataForSEO calls to the Lambda's remaining time minus 2 s."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from seo_http import deadline_seconds, within_lambda_deadline

from shared import dataforseo_client
from shared.dataforseo_client import remaining_deadline_s
from testing.seo_fixtures import seo_event

EVENT = seo_event('POST', '/api/seo/serp')


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    monkeypatch.setattr(dataforseo_client, '_monotonic', lambda: 100.0)


@within_lambda_deadline
def route_reporting_deadline(_event, _context):
    """A route whose answer is the ``call_deadline`` time left while it runs."""
    return {'remaining': remaining_deadline_s()}


def lambda_context(remaining_ms: object) -> SimpleNamespace:
    return SimpleNamespace(get_remaining_time_in_millis=lambda: remaining_ms)


def test_route_runs_under_remaining_time_minus_two_seconds_when_lambda_context_is_given():
    assert route_reporting_deadline(EVENT, lambda_context(29_000)) == {'remaining': 27.0}


@pytest.mark.parametrize('context', [None, {}, SimpleNamespace()], ids=['none', 'dict', 'no-method'])
def test_route_runs_without_deadline_when_context_has_no_remaining_time(context):
    assert route_reporting_deadline(EVENT, context) == {'remaining': None}


def test_deadline_is_cleared_after_the_route_returns():
    route_reporting_deadline(EVENT, lambda_context(10_000))

    assert remaining_deadline_s() is None


def test_deadline_seconds_is_none_when_remaining_time_is_not_a_number():
    assert deadline_seconds(lambda_context('soon')) is None
