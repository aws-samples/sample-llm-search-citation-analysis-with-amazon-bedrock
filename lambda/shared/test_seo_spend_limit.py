"""The daily limit of paid DataForSEO calls per user (``shared.seo_spend_limit``): the counter, the limit and whom.

The limit over a whole request (calls counted, refused, audited) is tested on the router's stack in
``seo/test_seo_daily_limit.py``.
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from shared import seo_spend_limit
from shared.config import seo_daily_call_limit
from shared.seo_paid_routes import is_paid
from testing.dataforseo_fixtures import InMemorySpendCounter


@pytest.mark.parametrize(('method', 'path', 'paid'), [
    ('POST', '/api/seo/keywords/research', True),
    ('POST', '/api/seo/backlinks/overview/', True),
    ('POST', '/api/seo/keywords/metrics/lookup', False),
    ('GET', '/api/seo/serp', False),
    ('POST', '/api/seo/rank-trackers', False),
])
def test_meters_only_the_paid_one_off_posts(method, path, paid):
    assert is_paid(method, path) is paid


def test_counts_a_call_on_the_users_day_while_calls_are_left():
    counter = InMemorySpendCounter()

    assert [seo_spend_limit.take('alice', 2, counter) for _ in range(3)] == [True, True, False]
    assert counter.calls_of('alice') == 2


def test_counts_nothing_when_the_limit_is_zero():
    counter = InMemorySpendCounter()

    assert (seo_spend_limit.take('alice', 0, counter), counter.items) == (False, {})


@pytest.mark.parametrize(('row', 'limit'), [
    (None, 100),
    ({'provider_id': 'dataforseo'}, 100),
    ({'daily_call_limit': Decimal(250)}, 250),
    ({'daily_call_limit': 0}, 0),
    ({'daily_call_limit': Decimal('2.5')}, 100),
    ({'daily_call_limit': True}, 100),
    ({'daily_call_limit': 'many'}, 100),
])
def test_reads_the_limit_an_admin_set_else_the_default_of_100(row, limit):
    assert seo_daily_call_limit(row) == limit


def test_reads_the_limit_from_the_dataforseo_provider_row():
    config = MagicMock()
    config.get_item.return_value = {'Item': {'provider_id': 'dataforseo', 'daily_call_limit': Decimal(7)}}

    assert (seo_spend_limit.limit(config), config.get_item.call_args.kwargs) == (7, {'Key': {'provider_id': 'dataforseo'}})


def _event(claims):
    return {'requestContext': {'authorizer': {'claims': claims}}}


def test_counts_a_signed_in_caller_against_themselves_even_with_an_owner_claim():
    assert seo_spend_limit.spender(_event({'cognito:username': 'mallory', 'custom:export_owner': 'alice'})) == 'mallory'


def test_counts_an_export_read_against_the_exports_owner():
    assert seo_spend_limit.spender(_event({'cognito:username': 'export-service', 'custom:export_owner': 'alice'})) == 'alice'
