"""Behavior tests for cache-first crawler orchestration."""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from shared.crawl_cache import success_cache_scope
from testing.crawl_cache_fixtures import missing_cache_index_error
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


_RESTRICTED = 'URL points to a restricted address'
# Navigation reports a captcha page in the same shape the crawl returns it.
_CAPTCHA_BLOCK = {'url': _URL, 'status': 'blocked', 'block_reason': 'captcha'}


def _error_outcome(message: str) -> dict[str, str]:
    """The compact result ``crawl_citation`` returns for a failed crawl."""
    return {'url': _URL, 'status': 'error', 'error': message}


def _cached_outcome(status: str, crawled_at: str, **extra: str) -> dict[str, object]:
    """The compact result ``crawl_citation`` returns when a fresh cache row answers."""
    return {'url': _URL, 'status': status, 'cached': True, 'crawled_at': crawled_at, **extra}


def _stored_fields(runtime: SimpleNamespace, *names: str) -> tuple[object, ...]:
    """The named fields of the CrawledContent row the crawl persisted."""
    stored = runtime.table.put_item.call_args.kwargs['Item']
    return tuple(stored[name] for name in names)


def _crawl_with_cache_rows(
    runtime: SimpleNamespace,
    citation: dict[str, object],
    *,
    same_keyword: list[dict[str, str]] | None = None,
    cross_keyword: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    """Crawl with the same-keyword then cross-keyword cache lookups answering these rows."""
    runtime.table.query.side_effect = [{'Items': same_keyword or []}, {'Items': cross_keyword or []}]
    return runtime.module.crawl_citation(citation)


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
    result = _crawl_with_cache_rows(
        crawler_runtime,
        citation,
        same_keyword=[{'cache_status': 'success', 'analysis_status': 'complete', 'crawled_at': crawled_at}],
    )

    assert result == _cached_outcome('success', crawled_at)
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
    result = _crawl_with_cache_rows(
        crawler_runtime,
        citation,
        cross_keyword=[{'cache_status': 'blocked', 'crawled_at': crawled_at, 'block_reason': 'captcha'}],
    )

    assert result == _cached_outcome('blocked', crawled_at, block_reason='captcha')
    crawler_runtime.browser_factory.assert_not_called()
    crawler_runtime.table.put_item.assert_not_called()


def test_returns_safety_error_without_starting_browser_when_url_is_restricted(
    crawler_runtime,
    citation,
):
    crawler_runtime.module.validate_url_safe.return_value = (False, _RESTRICTED)

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == _error_outcome(_RESTRICTED)
    crawler_runtime.browser_factory.assert_not_called()
    assert _stored_fields(crawler_runtime, 'status', 'error_message') == ('error', _RESTRICTED)


def test_persists_blocked_outcome_when_navigation_finds_captcha(
    crawler_runtime,
    citation,
    monkeypatch,
):
    crawler_runtime.browser.navigate_to_url.return_value = dict(_CAPTCHA_BLOCK)
    monkeypatch.setattr(
        crawler_runtime.module.time,
        'monotonic',
        MagicMock(side_effect=[10.0, 11.0]),
    )

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == _CAPTCHA_BLOCK
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
    crawler_runtime.browser.navigate_to_url.return_value = dict(_CAPTCHA_BLOCK)
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
        uncached_runtime.browser.navigation_guard_error = _RESTRICTED
        return extracted

    uncached_runtime.browser.extract_page_content.side_effect = extract_after_redirect

    result = uncached_runtime.module.crawl_citation(citation)

    assert result == _error_outcome(_RESTRICTED)
    uncached_runtime.module.analyze_content_combined.assert_not_called()
    uncached_runtime.browser.cleanup.assert_called_once_with()
    assert _stored_fields(uncached_runtime, 'status', 'error_message') == ('error', _RESTRICTED)


def test_skips_screenshot_upload_when_redirect_is_aborted_during_capture(
    uncached_runtime,
    citation,
):
    def screenshot_after_redirect():
        uncached_runtime.browser.navigation_guard_error = _RESTRICTED
        return {
            'status': 'success',
            'screenshot_base64': 'captured-but-unsafe',
        }

    uploader = MagicMock()
    uncached_runtime.browser.take_screenshot.side_effect = screenshot_after_redirect
    uncached_runtime.module.__dict__['upload_screenshot_to_s3'] = uploader

    result = uncached_runtime.module.crawl_citation(citation)

    assert result == _error_outcome(_RESTRICTED)
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

    assert _stored_fields(uncached_runtime, 'status', 'cache_status', 'analysis_status', 'cache_scope') == (
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

    assert _stored_fields(uncached_runtime, 'status', 'cache_status', 'analysis_status') == (
        'success', 'success', 'failed'
    )


def test_cleans_up_started_browser_when_session_initialization_fails(
    crawler_runtime,
    citation,
):
    crawler_runtime.browser.initialize_browser_session.side_effect = BrowserInitializationError(
        'CDP unavailable'
    )

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == _error_outcome('CDP unavailable')
    crawler_runtime.browser.cleanup.assert_called_once_with()


def test_returns_configuration_error_without_starting_browser_when_cache_index_is_invalid(
    crawler_runtime,
    citation,
):
    crawler_runtime.table.query.side_effect = missing_cache_index_error()

    result = crawler_runtime.module.crawl_citation(citation)

    assert result == _error_outcome('Crawl cache configuration error (ValidationException)')
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
