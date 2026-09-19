"""Behavior tests for cache-first crawler orchestration."""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared.crawl_cache import success_cache_scope
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.module_loader import load_handler_module

_CRAWLER_DIR = os.path.dirname(__file__)
_MODULE_NAME = 'crawler_handler_under_test'
_URL = 'https://example.com/article'
_KEYWORD = 'family hotels'
_ENV = {
    'AWS_REGION': 'us-west-2',
    'BROWSER_ID': 'browser-123',
    'BROWSER_SESSION_TIMEOUT_SECONDS': '330',
    'CRAWL_FRESHNESS_DAYS': '30',
    'CRAWL_BLOCKED_FRESHNESS_DAYS': '3',
    'CRAWL_CACHE_INDEX_NAME': 'CacheScopeIndex',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'CrawledContent',
    'SCREENSHOTS_BUCKET': 'screenshots-bucket',
}


class BrowserInitializationError(Exception):
    """Browser failure injected by a test."""


@pytest.fixture
def crawler_runtime():
    """Load the crawler with deterministic AWS and browser collaborators."""
    table = fake_table(query={'Items': []})
    dynamodb = fake_dynamodb_resource(table)
    browser = MagicMock()
    browser.navigation_guard_error = None
    browser.navigate_to_url.return_value = {
        'status': 'success',
        'url': _URL,
        'title': 'Example article',
    }
    browser.extract_page_content.return_value = {
        'status': 'success',
        'title': 'Example article',
        'content': 'Useful article content. ' * 10,
        'content_length': 240,
        'url': _URL,
    }
    browser.take_screenshot.return_value = {
        'status': 'error',
        'error': 'Screenshot unavailable',
    }
    browser_factory = MagicMock(return_value=browser)
    browser_module = ModuleType('shared.browser_tools')
    browser_module.__dict__['SimpleBrowserTools'] = browser_factory

    with (
        patch.dict(os.environ, _ENV),
        patch.dict(sys.modules, {'shared.browser_tools': browser_module}),
        patch('boto3.resource', MagicMock(return_value=dynamodb)),
        patch('boto3.client', MagicMock()),
    ):
        module = load_handler_module(_CRAWLER_DIR, 'handler.py', _MODULE_NAME)
        module.__dict__['validate_url_safe'] = MagicMock(return_value=(True, ''))
        module.__dict__['analyze_content_combined'] = MagicMock(
            return_value=('Summary', {'relevance_score': 8})
        )
        yield SimpleNamespace(
            browser=browser,
            browser_factory=browser_factory,
            module=module,
            table=table,
        )

    sys.modules.pop(_MODULE_NAME, None)


@pytest.fixture
def citation():
    return {
        'normalized_url': _URL,
        'keyword': _KEYWORD,
        'citation_count': 2,
        'citing_providers': ['openai', 'perplexity'],
    }


@pytest.fixture
def uncached_runtime(crawler_runtime, monkeypatch):
    """Use deterministic half-second browser timing for an uncached crawl."""
    monkeypatch.setattr(
        crawler_runtime.module.time,
        'monotonic',
        MagicMock(side_effect=[10.0, 10.5]),
    )
    return crawler_runtime


def test_returns_cached_success_without_starting_browser_when_same_keyword_row_is_fresh(
    crawler_runtime,
    citation,
):
    crawled_at = datetime.now(UTC).isoformat()
    crawler_runtime.table.query.side_effect = [
        {'Items': [{
            'cache_status': 'success',
            'analysis_status': 'complete',
            'crawled_at': crawled_at,
        }]},
        {'Items': []},
    ]

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == {
        'url': _URL,
        'status': 'success',
        'cached': True,
        'crawled_at': crawled_at,
    }
    crawler_runtime.browser_factory.assert_not_called()
    crawler_runtime.table.update_item.assert_called_once_with(
        Key={'normalized_url': _URL, 'crawled_at': crawled_at},
        UpdateExpression='SET citation_count = :count, citing_providers = :providers',
        ExpressionAttributeValues={
            ':count': 2,
            ':providers': ['openai', 'perplexity'],
        },
    )
    crawler_runtime.table.put_item.assert_not_called()


def test_returns_cached_block_without_starting_browser_when_cross_keyword_row_is_fresh(
    crawler_runtime,
    citation,
):
    crawled_at = datetime.now(UTC).isoformat()
    crawler_runtime.table.query.side_effect = [
        {'Items': []},
        {'Items': [{
            'cache_status': 'blocked',
            'crawled_at': crawled_at,
            'block_reason': 'captcha',
        }]},
    ]

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == {
        'url': _URL,
        'status': 'blocked',
        'cached': True,
        'crawled_at': crawled_at,
        'block_reason': 'captcha',
    }
    crawler_runtime.browser_factory.assert_not_called()
    crawler_runtime.table.put_item.assert_not_called()


def test_returns_safety_error_without_starting_browser_when_url_is_restricted(
    crawler_runtime,
    citation,
):
    crawler_runtime.module.validate_url_safe.return_value = (
        False,
        'URL points to a restricted address',
    )

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == {
        'url': _URL,
        'status': 'error',
        'error': 'URL points to a restricted address',
    }
    crawler_runtime.browser_factory.assert_not_called()
    stored = crawler_runtime.table.put_item.call_args.kwargs['Item']
    assert (stored['status'], stored['error_message']) == (
        'error',
        'URL points to a restricted address',
    )


def test_persists_blocked_outcome_when_navigation_finds_captcha(
    crawler_runtime,
    citation,
    monkeypatch,
):
    crawler_runtime.browser.navigate_to_url.return_value = {
        'status': 'blocked',
        'url': _URL,
        'block_reason': 'captcha',
    }
    monkeypatch.setattr(
        crawler_runtime.module.time,
        'monotonic',
        MagicMock(side_effect=[10.0, 11.0]),
    )

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == {
        'url': _URL,
        'status': 'blocked',
        'block_reason': 'captcha',
    }
    stored = crawler_runtime.table.put_item.call_args.kwargs['Item']
    assert (
        stored['status'],
        stored['block_reason'],
        stored['error_message'],
        stored['metadata']['page_load_time_ms'],
    ) == ('blocked', 'captcha', 'Bot detection - captcha', 1000)
    crawler_runtime.browser.cleanup.assert_called_once_with()


def test_stops_agentcore_session_before_persisting_navigation_block(
    crawler_runtime,
    citation,
):
    events: list[str] = []
    crawler_runtime.browser.navigate_to_url.return_value = {
        'status': 'blocked',
        'url': _URL,
        'block_reason': 'captcha',
    }
    crawler_runtime.browser.cleanup.side_effect = lambda: events.append('cleanup')
    crawler_runtime.table.put_item.side_effect = lambda **_kwargs: events.append('persist')

    crawler_runtime.module.crawl_citation(citation)

    assert events == ['cleanup', 'persist']


def test_returns_safety_error_when_document_redirect_occurs_during_extraction(
    uncached_runtime,
    citation,
):
    extracted = uncached_runtime.browser.extract_page_content.return_value

    def extract_after_redirect():
        uncached_runtime.browser.navigation_guard_error = 'URL points to a restricted address'
        return extracted

    uncached_runtime.browser.extract_page_content.side_effect = extract_after_redirect

    result = uncached_runtime.module.crawl_citation(citation)

    assert result == {
        'url': _URL,
        'status': 'error',
        'error': 'URL points to a restricted address',
    }
    uncached_runtime.module.analyze_content_combined.assert_not_called()
    uncached_runtime.browser.cleanup.assert_called_once_with()
    stored = uncached_runtime.table.put_item.call_args.kwargs['Item']
    assert (stored['status'], stored['error_message']) == (
        'error',
        'URL points to a restricted address',
    )


def test_skips_screenshot_upload_when_redirect_is_aborted_during_capture(
    uncached_runtime,
    citation,
):
    def screenshot_after_redirect():
        uncached_runtime.browser.navigation_guard_error = 'URL points to a restricted address'
        return {
            'status': 'success',
            'screenshot_base64': 'captured-but-unsafe',
        }

    uploader = MagicMock()
    uncached_runtime.browser.take_screenshot.side_effect = screenshot_after_redirect
    uncached_runtime.module.__dict__['upload_screenshot_to_s3'] = uploader

    result = uncached_runtime.module.crawl_citation(citation)

    assert result == {
        'url': _URL,
        'status': 'error',
        'error': 'URL points to a restricted address',
    }
    uploader.assert_not_called()
    uncached_runtime.browser.cleanup.assert_called_once_with()


def test_returns_compact_success_when_uncached_page_is_crawled(
    uncached_runtime,
    citation,
):
    result = uncached_runtime.module.crawl_citation(citation)

    assert result == {
        'url': _URL,
        'status': 'success',
    }
    uncached_runtime.browser.cleanup.assert_called_once_with()


def test_stops_agentcore_session_before_bedrock_analysis(
    uncached_runtime,
    citation,
):
    events: list[str] = []
    uncached_runtime.browser.cleanup.side_effect = lambda: events.append('cleanup')
    uncached_runtime.module.analyze_content_combined.side_effect = (
        lambda *_args: (events.append('analysis') or ('Summary', {'relevance_score': 8}))
    )

    uncached_runtime.module.crawl_citation(citation)

    assert events == ['cleanup', 'analysis']


def test_marks_success_cache_complete_when_analysis_succeeds(
    uncached_runtime,
    citation,
):
    uncached_runtime.module.crawl_citation(citation)

    stored = uncached_runtime.table.put_item.call_args.kwargs['Item']
    assert (
        stored['status'],
        stored['cache_status'],
        stored['analysis_status'],
        stored['cache_scope'],
    ) == (
        'success',
        'success',
        'complete',
        success_cache_scope(_URL, _KEYWORD),
    )


def test_marks_success_cache_incomplete_when_optional_analysis_fails(
    uncached_runtime,
    citation,
):
    uncached_runtime.module.analyze_content_combined.return_value = ('', {})

    uncached_runtime.module.crawl_citation(citation)

    stored = uncached_runtime.table.put_item.call_args.kwargs['Item']
    assert (
        stored['status'],
        stored['cache_status'],
        stored['analysis_status'],
    ) == ('success', 'success', 'failed')


def test_cleans_up_started_browser_when_session_initialization_fails(
    crawler_runtime,
    citation,
):
    crawler_runtime.browser.initialize_browser_session.side_effect = BrowserInitializationError(
        'CDP unavailable'
    )

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == {
        'url': _URL,
        'status': 'error',
        'error': 'CDP unavailable',
    }
    crawler_runtime.browser.cleanup.assert_called_once_with()


def test_returns_configuration_error_without_starting_browser_when_cache_index_is_invalid(
    crawler_runtime,
    citation,
):
    crawler_runtime.table.query.side_effect = ClientError(
        {'Error': {'Code': 'ValidationException', 'Message': 'missing index'}},
        'Query',
    )

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == {
        'url': _URL,
        'status': 'error',
        'error': 'Crawl cache configuration error (ValidationException)',
    }
    crawler_runtime.browser_factory.assert_not_called()


def test_classifies_captcha_before_empty_content_when_block_page_is_short(crawler_runtime):
    is_blocked, reason = crawler_runtime.module.detect_blocked_page(
        'Please verify you are human.',
        'Security check',
    )

    assert (is_blocked, reason) == (True, 'captcha')


def test_classifies_empty_content_when_short_page_has_no_block_pattern(crawler_runtime):
    is_blocked, reason = crawler_runtime.module.detect_blocked_page(
        'Temporarily unavailable.',
        'Example',
    )

    assert (is_blocked, reason) == (True, 'empty_content')
