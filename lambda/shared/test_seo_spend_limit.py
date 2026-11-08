"""The per-caller daily limit on the paid one-off SEO routes (``shared.seo_spend_limit``)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared import seo_spend_limit


@pytest.mark.parametrize(('method', 'path', 'paid'), [
    ('POST', '/api/seo/keywords/research', True),
    ('POST', '/api/seo/backlinks/overview/', True),
    ('POST', '/api/seo/keywords/metrics/lookup', False),
    ('GET', '/api/seo/serp', False),
    ('POST', '/api/seo/rank-trackers', False),
])
def test_counts_only_the_paid_one_off_posts(method, path, paid):
    assert seo_spend_limit.is_paid(method, path) is paid


def test_counts_a_request_on_the_callers_day_under_the_limit(monkeypatch):
    monkeypatch.setenv('SEO_PAID_REQUESTS_PER_DAY', '7')
    table = MagicMock()

    assert seo_spend_limit.take('alice', table) is True
    call = table.update_item.call_args.kwargs
    assert (call['Key']['cache_key'].startswith('spend#alice#'), call['ExpressionAttributeValues'][':limit']) == (True, 7)


def test_refuses_a_request_past_the_limit():
    table = MagicMock()
    table.update_item.side_effect = ClientError({'Error': {'Code': 'ConditionalCheckFailedException', 'Message': ''}}, 'UpdateItem')

    assert seo_spend_limit.take('alice', table) is False


@pytest.mark.parametrize('value', ['0', '-3', 'many'])
def test_falls_back_to_the_default_for_an_unusable_limit(monkeypatch, value):
    monkeypatch.setenv('SEO_PAID_REQUESTS_PER_DAY', value)

    assert seo_spend_limit.limit() == seo_spend_limit.DEFAULT_LIMIT
