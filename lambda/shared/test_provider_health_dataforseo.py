"""DataForSEO failures classify by ``DataForSeoError.code`` so auto-disable works for Google AI Overviews."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from shared.dataforseo_client import DataForSeoError
from shared.provider_health import (
    INSUFFICIENT_CREDIT,
    INVALID_KEY,
    RATE_LIMITED,
    UNKNOWN,
    classify_provider_error,
    record_provider_failure,
)


@pytest.mark.parametrize(
    ('code', 'category'),
    [
        pytest.param('AUTH_FAILED', INVALID_KEY, id='auth'),
        pytest.param('BILLING_ISSUE', INSUFFICIENT_CREDIT, id='billing'),
        pytest.param('RATE_LIMITED', RATE_LIMITED, id='rate-limited'),
    ],
)
def test_maps_dataforseo_code_to_category_when_error_is_dataforseo(code, category):
    assert classify_provider_error(DataForSeoError(code, 'DataForSEO request failed')) == category


def test_keeps_upstream_outage_transient_when_dataforseo_backend_fails():
    error = DataForSeoError('UPSTREAM_UNAVAILABLE', 'DataForSEO HTTP 502 on /v3/serp', provider_status=502)

    assert classify_provider_error(error) == UNKNOWN


def test_ignores_code_attribute_when_error_is_not_dataforseo():
    other = type('OtherError', (Exception,), {'code': 'AUTH_FAILED'})('boom')

    assert classify_provider_error(other) == UNKNOWN


def test_auto_disables_provider_when_third_dataforseo_auth_failure_is_recorded():
    table = MagicMock()
    table.update_item.return_value = {'Attributes': {'consecutive_failures': 3}}

    outcome = record_provider_failure(table, 'google_ai_overview', DataForSeoError('AUTH_FAILED', 'HTTP 401'))

    assert (outcome['category'], outcome['auto_disabled']) == (INVALID_KEY, True)
