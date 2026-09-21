"""Tests for AgentCore browser lifecycle, safety, and CAPTCHA detection."""

from __future__ import annotations

import importlib
import sys
import types
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, call

import pytest


def _stub_module(name: str, **attributes: Any) -> types.ModuleType:
    """A bare module carrying just the names ``browser_tools`` imports from it."""
    module = types.ModuleType(name)
    vars(module).update(attributes)
    return module


# browser_tools imports Playwright and AgentCore at module scope. Stub only
# those optional layer packages so the normal boto3 package remains available
# to other test modules collected in the same process.
_fake_sync_api = _stub_module(
    "playwright.sync_api",
    Browser=object,
    BrowserContext=object,
    Page=object,
    sync_playwright=lambda: None,
)
_fake_playwright = _stub_module("playwright", sync_api=_fake_sync_api)
sys.modules.setdefault("playwright", _fake_playwright)
sys.modules.setdefault("playwright.sync_api", _fake_sync_api)

_fake_agentcore = _stub_module("bedrock_agentcore")
_fake_agentcore_tools = _stub_module("bedrock_agentcore.tools")
_fake_agentcore_browser = _stub_module("bedrock_agentcore.tools.browser_client", BrowserClient=object)
sys.modules.setdefault("bedrock_agentcore", _fake_agentcore)
sys.modules.setdefault("bedrock_agentcore.tools", _fake_agentcore_tools)
sys.modules.setdefault("bedrock_agentcore.tools.browser_client", _fake_agentcore_browser)

from shared import browser_tools

importlib.reload(browser_tools)


class BrowserTestError(Exception):
    """Browser failure injected by a test."""


_BODY_TEXT_JAVASCRIPT = "() => document.body?.innerText ?? ''"


@pytest.fixture
def tools_with_page():
    """Build browser tools with a mocked active Playwright page."""
    config = SimpleNamespace(region="us-west-2", browser_session_timeout=330)
    tools = browser_tools.SimpleBrowserTools(config)
    tools.context = MagicMock()
    tools.page = MagicMock()
    return tools


@pytest.fixture
def initialized_session(monkeypatch, tools_with_page):
    """Arrange AgentCore and Playwright clients for session initialization."""
    page = MagicMock()
    context = MagicMock()
    context.pages = [page]
    browser = MagicMock()
    browser.contexts = [context]
    playwright = MagicMock()
    playwright.chromium.connect_over_cdp.return_value = browser
    playwright_factory = MagicMock()
    playwright_factory.start.return_value = playwright
    client = MagicMock()
    client.start.return_value = "session-123"
    client.generate_ws_headers.return_value = (
        "wss://agentcore.example/session",
        {"Authorization": "signed"},
    )
    client_factory = MagicMock(return_value=client)

    monkeypatch.setattr(browser_tools, "BrowserClient", client_factory)
    monkeypatch.setattr(browser_tools, "sync_playwright", MagicMock(return_value=playwright_factory))
    monkeypatch.setattr(browser_tools.time, "sleep", MagicMock())
    tools_with_page.browser_id = "browser-123"

    return SimpleNamespace(
        browser=browser,
        client=client,
        client_factory=client_factory,
        context=context,
        page=page,
        playwright=playwright,
        tools=tools_with_page,
    )


@pytest.fixture
def cleanup_runtime(tools_with_page):
    """Arrange each independently managed browser-session resource."""
    browser = MagicMock()
    playwright = MagicMock()
    browser_client = MagicMock()
    tools_with_page.browser = browser
    tools_with_page.playwright = playwright
    tools_with_page.browser_client = browser_client
    tools_with_page.session_id = "session-123"
    return SimpleNamespace(
        browser=browser,
        browser_client=browser_client,
        context=tools_with_page.context,
        playwright=playwright,
        tools=tools_with_page,
    )


def test_detects_slide_to_verify_when_page_contains_slider_challenge(tools_with_page):
    tools_with_page.page.evaluate.return_value = "Welcome. Please slide to verify before continuing."

    assert tools_with_page._detect_captcha_block() is True


def test_detects_drag_slider_when_page_contains_drag_challenge(tools_with_page):
    tools_with_page.page.evaluate.return_value = "Bot check: drag the slider to confirm."

    assert tools_with_page._detect_captcha_block() is True


def test_detects_human_verification_when_page_contains_recaptcha_wording(tools_with_page):
    tools_with_page.page.evaluate.return_value = "Verify you are human to access the next page."

    assert tools_with_page._detect_captcha_block() is True


def test_detects_robot_checkbox_when_page_uses_mixed_case(tools_with_page):
    tools_with_page.page.evaluate.return_value = "Please tick: I AM NOT A ROBOT."

    assert tools_with_page._detect_captcha_block() is True


def test_returns_not_blocked_when_page_contains_normal_content(tools_with_page):
    tools_with_page.page.evaluate.return_value = "The 10 best hotels in Barcelona for families travelling with kids."

    assert tools_with_page._detect_captcha_block() is False


def test_returns_navigation_error_when_captcha_body_text_cannot_be_read(tools_with_page):
    tools_with_page.page.evaluate.side_effect = BrowserTestError("connection lost")

    result = tools_with_page.navigate_to_url("https://example.com/article")

    assert result == {
        "status": "error",
        "url": "https://example.com/article",
        "error": "connection lost",
    }


def test_returns_not_blocked_when_document_body_is_missing(tools_with_page):
    tools_with_page.page.evaluate.return_value = ""

    result = tools_with_page._detect_captcha_block()

    assert result is False
    tools_with_page.page.evaluate.assert_called_once_with(_BODY_TEXT_JAVASCRIPT)


def test_returns_blocked_result_when_navigation_finds_captcha(tools_with_page, monkeypatch):
    tools_with_page.page.evaluate.return_value = "slide to verify and continue"
    monkeypatch.setattr(browser_tools, "get_timestamp", MagicMock(return_value="2026-09-19T12:00:00Z"))

    result = tools_with_page.navigate_to_url("https://example.com/blocked")

    assert result == {
        "status": "blocked",
        "url": "https://example.com/blocked",
        "block_reason": "captcha",
        "timestamp": "2026-09-19T12:00:00Z",
    }


def test_returns_success_result_when_navigation_finds_normal_page(tools_with_page, monkeypatch):
    tools_with_page.page.evaluate.return_value = "Normal article content here."
    tools_with_page.page.title.return_value = "A regular page"
    monkeypatch.setattr(browser_tools, "get_timestamp", MagicMock(return_value="2026-09-19T12:00:00Z"))

    result = tools_with_page.navigate_to_url("https://example.com/article")

    assert result == {
        "status": "success",
        "url": "https://example.com/article",
        "title": "A regular page",
        "timestamp": "2026-09-19T12:00:00Z",
    }


def test_installs_context_redirect_guard_before_navigation(tools_with_page, monkeypatch):
    events: list[str] = []
    tools_with_page.context.route.side_effect = lambda *_args: events.append("route")
    tools_with_page.page.goto.side_effect = lambda *_args, **_kwargs: events.append("goto")
    tools_with_page.page.evaluate.return_value = "Normal article content here."
    tools_with_page.page.title.return_value = "A regular page"
    monkeypatch.setattr(browser_tools, "get_timestamp", MagicMock(return_value="2026-09-19T12:00:00Z"))

    tools_with_page.navigate_to_url("https://example.com/article")

    assert events == ["route", "goto"]


def test_returns_safety_error_when_delayed_document_redirect_is_aborted(tools_with_page):
    def record_delayed_block(_milliseconds):
        tools_with_page._navigation_guard_error = "URL points to a restricted address"

    tools_with_page.page.wait_for_timeout.side_effect = record_delayed_block

    result = tools_with_page.navigate_to_url("https://example.com/article")

    assert result == {
        "status": "error",
        "url": "https://example.com/article",
        "error": "URL points to a restricted address",
    }


def test_leaves_mouse_untouched_when_navigation_finds_captcha(tools_with_page):
    tools_with_page.page.evaluate.return_value = "slide to verify"

    tools_with_page.navigate_to_url("https://example.com/blocked")

    tools_with_page.page.mouse.down.assert_not_called()
    tools_with_page.page.mouse.up.assert_not_called()


def test_exposes_no_slider_bypass_methods_when_browser_tools_are_loaded():
    assert not hasattr(browser_tools.SimpleBrowserTools, "_handle_slider_challenge")
    assert not hasattr(browser_tools.SimpleBrowserTools, "_compute_slider_drag_distance")


def test_selects_precreated_browser_when_browser_id_is_configured(tools_with_page, monkeypatch):
    monkeypatch.setenv("BROWSER_ID", "browser-123")

    result = tools_with_page.create_browser()

    assert result == "browser-123"
    assert tools_with_page.browser_id == "browser-123"


def test_raises_configuration_error_when_browser_id_is_missing(tools_with_page, monkeypatch):
    monkeypatch.delenv("BROWSER_ID", raising=False)

    with pytest.raises(
        browser_tools.BrowserConfigurationError,
        match="BROWSER_ID is required; deploy the pre-created AgentCore browser before crawling",
    ):
        tools_with_page.create_browser()


def test_passes_short_backstop_when_agentcore_session_starts(initialized_session):
    initialized_session.tools.initialize_browser_session()

    initialized_session.client.start.assert_called_once_with(
        identifier="browser-123",
        name=initialized_session.client.start.call_args.kwargs["name"],
        session_timeout_seconds=330,
    )


def test_attaches_playwright_with_agentcore_connection_when_session_starts(initialized_session):
    result = initialized_session.tools.initialize_browser_session()

    assert result is initialized_session.page
    initialized_session.playwright.chromium.connect_over_cdp.assert_called_once_with(
        "wss://agentcore.example/session",
        headers={"Authorization": "signed"},
    )


def test_creates_page_when_agentcore_context_has_no_pages(initialized_session):
    new_page = MagicMock()
    initialized_session.context.pages = []
    initialized_session.context.new_page.return_value = new_page

    result = initialized_session.tools.initialize_browser_session()

    assert result is new_page
    initialized_session.context.new_page.assert_called_once_with()


def test_raises_clear_error_when_agentcore_session_has_no_context(initialized_session):
    initialized_session.browser.contexts = []

    with pytest.raises(
        RuntimeError,
        match="AgentCore browser session returned no browser context",
    ):
        initialized_session.tools.initialize_browser_session()


def test_aborts_document_request_when_redirect_destination_is_unsafe(tools_with_page, monkeypatch):
    route = MagicMock()
    route.request.resource_type = "document"
    route.request.url = "http://169.254.169.254/latest/meta-data"
    monkeypatch.setattr(
        browser_tools,
        "validate_url_safe",
        MagicMock(return_value=(False, "URL points to a restricted address")),
    )

    tools_with_page._guard_document_request(route)

    route.abort.assert_called_once_with("blockedbyclient")
    route.continue_.assert_not_called()
    assert tools_with_page._navigation_guard_error == "URL points to a restricted address"


def test_continues_subresource_without_dns_check_when_request_is_not_document(tools_with_page, monkeypatch):
    route = MagicMock()
    route.request.resource_type = "image"
    validator = MagicMock()
    monkeypatch.setattr(browser_tools, "validate_url_safe", validator)

    tools_with_page._guard_document_request(route)

    route.continue_.assert_called_once_with()
    validator.assert_not_called()


def test_returns_empty_content_when_document_body_is_missing(tools_with_page):
    tools_with_page.page.title.return_value = "Sparse page"
    tools_with_page.page.url = "https://example.com/sparse"
    tools_with_page.page.evaluate.side_effect = ["", {}]

    result = tools_with_page.extract_page_content()

    assert result == {
        "status": "success",
        "title": "Sparse page",
        "content": "",
        "metadata": {},
        "content_length": 0,
        "url": "https://example.com/sparse",
    }
    assert tools_with_page.page.evaluate.call_args_list[0] == call(_BODY_TEXT_JAVASCRIPT)


def test_truncates_visible_content_when_page_exceeds_fifty_thousand_characters(tools_with_page):
    tools_with_page.page.title.return_value = "Long page"
    tools_with_page.page.url = "https://example.com/long"
    tools_with_page.page.evaluate.side_effect = [("x" * 50001), {}]

    result = tools_with_page.extract_page_content()

    assert result["content"] == "x" * 50000
    assert result["content_length"] == 50000


def _record_cleanup_events(cleanup_runtime) -> list[str]:
    events: list[str] = []
    cleanup_runtime.context.unroute_all.side_effect = (
        lambda **kwargs: events.append(f"unroute:{kwargs['behavior']}")
    )
    cleanup_runtime.browser.close.side_effect = lambda: events.append("browser")
    cleanup_runtime.playwright.stop.side_effect = lambda: events.append("playwright")
    cleanup_runtime.browser_client.stop.side_effect = lambda: events.append("browser_client")
    return events


def _cleanup_call_counts(cleanup_runtime) -> tuple[int, int, int, int]:
    return (
        cleanup_runtime.context.unroute_all.call_count,
        cleanup_runtime.browser.close.call_count,
        cleanup_runtime.playwright.stop.call_count,
        cleanup_runtime.browser_client.stop.call_count,
    )


def test_uses_required_resource_shutdown_order_when_cleanup_runs(cleanup_runtime):
    events = _record_cleanup_events(cleanup_runtime)

    cleanup_runtime.tools.cleanup()

    assert events == ["unroute:wait", "browser", "playwright", "browser_client"]


def test_continues_resource_shutdown_when_route_drain_fails(cleanup_runtime):
    events = _record_cleanup_events(cleanup_runtime)
    cleanup_runtime.context.unroute_all.side_effect = BrowserTestError("route cleanup failed")

    cleanup_runtime.tools.cleanup()

    assert events == ["browser", "playwright", "browser_client"]


def test_does_not_release_resources_again_when_cleanup_repeats(cleanup_runtime):
    cleanup_runtime.tools.cleanup()
    cleanup_runtime.tools.cleanup()

    assert _cleanup_call_counts(cleanup_runtime) == (1, 1, 1, 1)


def test_clears_resource_references_when_cleanup_finishes(cleanup_runtime):
    cleanup_runtime.tools.cleanup()

    assert (
        cleanup_runtime.tools.page,
        cleanup_runtime.tools.context,
        cleanup_runtime.tools.browser,
        cleanup_runtime.tools.playwright,
        cleanup_runtime.tools.browser_client,
        cleanup_runtime.tools.session_id,
    ) == (None, None, None, None, None, None)


def test_preserves_redirect_guard_error_when_cleanup_finishes(cleanup_runtime):
    cleanup_runtime.tools._navigation_guard_error = "URL points to a restricted address"

    cleanup_runtime.tools.cleanup()

    assert cleanup_runtime.tools.navigation_guard_error == "URL points to a restricted address"


@pytest.mark.parametrize("failing_resource", ["browser", "playwright", "browser_client"])
def test_attempts_every_cleanup_step_when_one_resource_fails(cleanup_runtime, failing_resource):
    failure_method = {
        "browser": cleanup_runtime.browser.close,
        "playwright": cleanup_runtime.playwright.stop,
        "browser_client": cleanup_runtime.browser_client.stop,
    }[failing_resource]
    failure_method.side_effect = BrowserTestError(f"{failing_resource} cleanup failed")

    cleanup_runtime.tools.cleanup()

    assert _cleanup_call_counts(cleanup_runtime) == (1, 1, 1, 1)


_NOT_INITIALIZED = "Browser session not initialized - call initialize_browser_session() first"


@pytest.fixture
def tools_without_session():
    """A SimpleBrowserTools whose ``initialize_browser_session`` never ran."""
    config = SimpleNamespace(region="us-east-1", browser_session_timeout=330)
    return browser_tools.SimpleBrowserTools(config)


def test_navigate_reports_the_missing_session_instead_of_a_none_attribute_error(tools_without_session):
    result = tools_without_session.navigate_to_url("https://example.com")

    assert result == {"status": "error", "url": "https://example.com", "error": _NOT_INITIALIZED}


def test_extract_reports_the_missing_session_instead_of_a_none_attribute_error(tools_without_session):
    result = tools_without_session.extract_page_content()

    assert result == {"status": "error", "error": _NOT_INITIALIZED}


def test_screenshot_reports_the_missing_session_instead_of_a_none_attribute_error(tools_without_session):
    result = tools_without_session.take_screenshot()

    assert result == {"status": "error", "error": _NOT_INITIALIZED}


def test_raises_missing_session_error_when_captcha_detection_has_no_page(tools_without_session):
    with pytest.raises(RuntimeError) as error_info:
        tools_without_session._detect_captcha_block()

    assert str(error_info.value) == _NOT_INITIALIZED
