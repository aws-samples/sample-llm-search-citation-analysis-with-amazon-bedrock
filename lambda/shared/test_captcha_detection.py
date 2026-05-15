"""
Tests for the CAPTCHA detection logic in `browser_tools.SimpleBrowserTools`.

Behaviour pinned by these tests:

- The crawler DETECTS CAPTCHA-protected pages and reports them as
  `status: "blocked", block_reason: "captcha"`.
- The crawler does NOT solve, drag, or otherwise bypass the challenge.
  The legitimate path is Web Bot Auth on Amazon Bedrock AgentCore Browser
  (configured in CDK as `browserSigning: { enabled: true }`).
- Detection covers the wording families seen in the wild (slide-to-verify,
  human-verification, recaptcha-style "I am not a robot") with conservative
  matching to avoid false positives.

The live browser interaction can't run in unit tests; we mock the
Playwright `page` and verify the public surface of `navigate_to_url` plus
the `_detect_captcha_block` predicate directly.
"""

from __future__ import annotations

import importlib
import os
import sys
import types
from unittest.mock import MagicMock

import pytest

# browser_tools imports playwright + bedrock_agentcore at module scope. Stub
# them so the test runner doesn't need the real layer installed.
_fake_playwright = types.ModuleType('playwright')
_fake_sync_api = types.ModuleType('playwright.sync_api')
for _name in ('Browser', 'BrowserContext', 'Page'):
    setattr(_fake_sync_api, _name, object)
_fake_sync_api.sync_playwright = lambda: None
_fake_playwright.sync_api = _fake_sync_api
sys.modules.setdefault('playwright', _fake_playwright)
sys.modules.setdefault('playwright.sync_api', _fake_sync_api)

_fake_boto3 = types.ModuleType('boto3')
_fake_boto3.resource = lambda *a, **kw: MagicMock()
_fake_boto3.client = lambda *a, **kw: MagicMock()
sys.modules.setdefault('boto3', _fake_boto3)

# Stub the BedrockAgentCore SDK shape browser_tools imports lazily.
_fake_bac = types.ModuleType('bedrock_agentcore')
_fake_bac_tools = types.ModuleType('bedrock_agentcore.tools')
_fake_bac_browser = types.ModuleType('bedrock_agentcore.tools.browser_client')
_fake_bac_browser.BrowserClient = object
_fake_bac_utils = types.ModuleType('bedrock_agentcore._utils')
_fake_bac_endpoints = types.ModuleType('bedrock_agentcore._utils.endpoints')
_fake_bac_endpoints.get_control_plane_endpoint = lambda *_a, **_k: 'https://example.invalid'
sys.modules.setdefault('bedrock_agentcore', _fake_bac)
sys.modules.setdefault('bedrock_agentcore.tools', _fake_bac_tools)
sys.modules.setdefault('bedrock_agentcore.tools.browser_client', _fake_bac_browser)
sys.modules.setdefault('bedrock_agentcore._utils', _fake_bac_utils)
sys.modules.setdefault('bedrock_agentcore._utils.endpoints', _fake_bac_endpoints)

sys.path.insert(0, os.path.dirname(__file__))
import browser_tools  # type: ignore[import-not-found]
importlib.reload(browser_tools)


@pytest.fixture
def tools_with_page():
    """Build a SimpleBrowserTools-like object with a mocked Playwright page."""
    tools = browser_tools.SimpleBrowserTools.__new__(
        browser_tools.SimpleBrowserTools,
    )
    tools.page = MagicMock()
    return tools


# --- _detect_captcha_block ---------------------------------------------


def test_detects_slide_to_verify_phrasing(tools_with_page):
    tools_with_page.page.evaluate.return_value = (
        'Welcome. Please slide to verify before continuing.'
    )
    assert tools_with_page._detect_captcha_block() is True


def test_detects_drag_the_slider_phrasing(tools_with_page):
    tools_with_page.page.evaluate.return_value = (
        'Bot check: drag the slider to confirm.'
    )
    assert tools_with_page._detect_captcha_block() is True


def test_detects_recaptcha_style_human_verification(tools_with_page):
    tools_with_page.page.evaluate.return_value = (
        'Verify you are human to access the next page.'
    )
    assert tools_with_page._detect_captcha_block() is True


def test_detects_i_am_not_a_robot_checkbox_text(tools_with_page):
    tools_with_page.page.evaluate.return_value = (
        'Please tick: I am not a robot.'
    )
    assert tools_with_page._detect_captcha_block() is True


def test_returns_false_for_normal_content(tools_with_page):
    tools_with_page.page.evaluate.return_value = (
        'The 10 best hotels in Barcelona for families travelling with kids.'
    )
    assert tools_with_page._detect_captcha_block() is False


def test_returns_false_when_page_evaluate_raises(tools_with_page):
    class PageEvalError(Exception):
        pass
    tools_with_page.page.evaluate.side_effect = PageEvalError('connection lost')
    # The crawler should err on the side of "not a CAPTCHA" rather than
    # mark a page as blocked because we couldn't read it.
    assert tools_with_page._detect_captcha_block() is False


def test_match_is_case_insensitive(tools_with_page):
    tools_with_page.page.evaluate.return_value = (
        'PROVE YOU ARE NOT A ROBOT.'
    )
    assert tools_with_page._detect_captcha_block() is True


# --- navigate_to_url --------------------------------------------------


def test_navigate_returns_blocked_status_when_captcha_detected(tools_with_page):
    tools_with_page.page.evaluate.return_value = 'slide to verify and continue'
    result = tools_with_page.navigate_to_url('https://example.com/blocked')
    assert result['status'] == 'blocked'


def test_navigate_records_captcha_as_block_reason(tools_with_page):
    tools_with_page.page.evaluate.return_value = 'slide to verify and continue'
    result = tools_with_page.navigate_to_url('https://example.com/blocked')
    assert result['block_reason'] == 'captcha'


def test_navigate_records_blocked_url_in_result(tools_with_page):
    tools_with_page.page.evaluate.return_value = 'slide to verify and continue'
    result = tools_with_page.navigate_to_url('https://example.com/blocked')
    assert result['url'] == 'https://example.com/blocked'


def test_navigate_succeeds_on_normal_page(tools_with_page):
    tools_with_page.page.evaluate.return_value = 'Normal article content here.'
    tools_with_page.page.title.return_value = 'A regular page'
    result = tools_with_page.navigate_to_url('https://example.com/article')
    assert result['status'] == 'success'
    assert result['title'] == 'A regular page'


def test_navigate_does_not_attempt_to_drag_or_solve_on_captcha(tools_with_page):
    tools_with_page.page.evaluate.return_value = 'slide to verify'
    tools_with_page.navigate_to_url('https://example.com/blocked')
    # Regression guard: the bypass code attempted to drag the mouse to
    # solve the CAPTCHA. Verify no mouse interaction is invoked here.
    assert tools_with_page.page.mouse.down.called is False
    assert tools_with_page.page.mouse.up.called is False


def test_handle_slider_challenge_method_is_removed():
    # Regression guard: the previous bypass method should no longer exist
    # on the class. If reintroduced this test fails so the change can be
    # caught at review.
    assert not hasattr(
        browser_tools.SimpleBrowserTools, '_handle_slider_challenge',
    )


def test_compute_slider_drag_distance_method_is_removed():
    # Regression guard for the dynamic drag-distance helper proposed in
    # PR #33 (audit #31). Should not be present.
    assert not hasattr(
        browser_tools.SimpleBrowserTools, '_compute_slider_drag_distance',
    )
