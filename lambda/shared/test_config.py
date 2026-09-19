"""Tests for crawler Lambda configuration settings."""

from __future__ import annotations

import os
from collections.abc import Iterator
from unittest.mock import patch

import pytest

from shared.config import LambdaConfig

_CRAWLER_SETTING_NAMES = (
    'BROWSER_SESSION_TIMEOUT_SECONDS',
    'CRAWL_FRESHNESS_DAYS',
    'CRAWL_BLOCKED_FRESHNESS_DAYS',
    'CRAWL_CACHE_INDEX_NAME',
)


@pytest.fixture(autouse=True)
def _restore_crawler_settings() -> Iterator[None]:
    """Remove crawler settings during each test and restore them afterward."""
    with patch.dict(os.environ, {}, clear=False):
        for setting_name in _CRAWLER_SETTING_NAMES:
            os.environ.pop(setting_name, None)
        yield


def test_returns_crawler_defaults_when_settings_are_absent() -> None:
    config = LambdaConfig()

    assert config.browser_session_timeout == 330
    assert config.crawl_freshness_days == 30
    assert config.crawl_blocked_freshness_days == 3
    assert config.crawl_cache_index_name == 'CacheScopeIndex'


@pytest.mark.parametrize(
    ('setting_name', 'attribute_name'),
    [
        pytest.param('CRAWL_FRESHNESS_DAYS', 'crawl_freshness_days', id='successful-crawl'),
        pytest.param(
            'CRAWL_BLOCKED_FRESHNESS_DAYS',
            'crawl_blocked_freshness_days',
            id='blocked-crawl',
        ),
    ],
)
def test_returns_zero_when_freshness_setting_is_explicitly_zero(
    setting_name: str,
    attribute_name: str,
) -> None:
    with patch.dict(os.environ, {setting_name: '0'}, clear=False):
        config = LambdaConfig()

    assert getattr(config, attribute_name) == 0


@pytest.mark.parametrize(
    ('setting_name', 'attribute_name', 'configured_value', 'expected_value'),
    [
        pytest.param(
            'BROWSER_SESSION_TIMEOUT_SECONDS',
            'browser_session_timeout',
            '420',
            420,
            id='browser-session-timeout',
        ),
        pytest.param(
            'CRAWL_FRESHNESS_DAYS',
            'crawl_freshness_days',
            '45',
            45,
            id='successful-crawl-freshness',
        ),
        pytest.param(
            'CRAWL_BLOCKED_FRESHNESS_DAYS',
            'crawl_blocked_freshness_days',
            '7',
            7,
            id='blocked-crawl-freshness',
        ),
    ],
)
def test_returns_custom_integer_when_only_that_setting_is_configured(
    setting_name: str,
    attribute_name: str,
    configured_value: str,
    expected_value: int,
) -> None:
    with patch.dict(os.environ, {setting_name: configured_value}, clear=False):
        config = LambdaConfig()

    assert getattr(config, attribute_name) == expected_value


@pytest.mark.parametrize(
    'setting_name',
    [
        'BROWSER_SESSION_TIMEOUT_SECONDS',
        'CRAWL_FRESHNESS_DAYS',
        'CRAWL_BLOCKED_FRESHNESS_DAYS',
    ],
)
def test_raises_named_value_error_when_integer_setting_is_not_an_integer(
    setting_name: str,
) -> None:
    with (
        patch.dict(os.environ, {setting_name: 'not-an-integer'}, clear=False),
        pytest.raises(ValueError) as error,
    ):
        LambdaConfig()

    assert str(error.value) == f'{setting_name} must be an integer'


def test_rejects_browser_session_timeout_below_60_seconds() -> None:
    with (
        patch.dict(os.environ, {'BROWSER_SESSION_TIMEOUT_SECONDS': '59'}, clear=False),
        pytest.raises(ValueError) as error,
    ):
        LambdaConfig()

    assert str(error.value) == 'BROWSER_SESSION_TIMEOUT_SECONDS must be at least 60'


def test_returns_60_when_browser_session_timeout_is_at_minimum() -> None:
    with patch.dict(os.environ, {'BROWSER_SESSION_TIMEOUT_SECONDS': '60'}, clear=False):
        config = LambdaConfig()

    assert config.browser_session_timeout == 60


@pytest.mark.parametrize(
    ('setting_name', 'expected_message'),
    [
        pytest.param(
            'CRAWL_FRESHNESS_DAYS',
            'CRAWL_FRESHNESS_DAYS must be at least 0',
            id='successful-crawl',
        ),
        pytest.param(
            'CRAWL_BLOCKED_FRESHNESS_DAYS',
            'CRAWL_BLOCKED_FRESHNESS_DAYS must be at least 0',
            id='blocked-crawl',
        ),
    ],
)
def test_rejects_negative_freshness_setting(
    setting_name: str,
    expected_message: str,
) -> None:
    with (
        patch.dict(os.environ, {setting_name: '-1'}, clear=False),
        pytest.raises(ValueError) as error,
    ):
        LambdaConfig()

    assert str(error.value) == expected_message


def test_returns_custom_cache_index_name_when_setting_is_configured() -> None:
    with patch.dict(os.environ, {'CRAWL_CACHE_INDEX_NAME': 'CustomCacheIndex'}, clear=False):
        index_name = LambdaConfig().crawl_cache_index_name

    assert index_name == 'CustomCacheIndex'
