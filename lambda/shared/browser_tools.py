"""
Simplified browser automation tools for Lambda using Bedrock AgentCore.

This is a Lambda-optimized version adapted from the enterprise-web-intelligence-agent example.
It focuses on core crawling functionality needed for citation analysis.

Uses synchronous Playwright API for Lambda compatibility.
Supports a pre-created custom browser with Web Bot Auth for reduced CAPTCHAs.

NOTE: Nova Act integration was removed because the SDK is too large for Lambda layers (475MB+).
The crawler relies on Web Bot Auth + Playwright for verification handling.
For Nova Act support, consider using a container-based Lambda.
"""

import base64
import logging
import os
import time

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

# Import from BedrockAgentCore SDK. The ``None`` fallback makes the "SDK
# missing" guard visible to the type checker at each use site.
try:
    from bedrock_agentcore.tools.browser_client import BrowserClient
except ImportError:
    BrowserClient = None
    logging.warning("BedrockAgentCore SDK not available - browser features will be limited")

from shared.url_validator import validate_url_safe
from shared.utils import get_timestamp, get_timestamp_compact

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_SESSION_NOT_INITIALIZED = "Browser session not initialized - call initialize_browser_session() first"
_BODY_TEXT_JAVASCRIPT = "() => document.body?.innerText ?? ''"


class BrowserConfigurationError(RuntimeError):
    """Raised when required AgentCore browser configuration is absent."""


class SimpleBrowserTools:
    """Simplified browser automation tools for Lambda environment."""

    def __init__(self, config):
        self.config = config
        self.browser_client = None
        self.browser_id = None
        self.playwright = None
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        self.session_id = None
        self._navigation_guard_error: str | None = None

    def create_browser(self) -> str:
        """Select the pre-created signed browser configured by CDK.

        Dynamically creating a browser in a crawl is intentionally unsupported:
        it is slower, omits the configured Web Bot Auth identity, and can leak a
        control-plane resource because session cleanup does not delete browsers.
        """
        if BrowserClient is None:
            raise RuntimeError("BedrockAgentCore SDK not available")

        pre_created_browser_id = os.environ.get("BROWSER_ID")
        if not pre_created_browser_id:
            raise BrowserConfigurationError(
                "BROWSER_ID is required; deploy the pre-created AgentCore browser before crawling"
            )

        logger.info("Using pre-created AgentCore browser with Web Bot Auth")
        self.browser_id = pre_created_browser_id
        return self.browser_id

    def initialize_browser_session(self) -> Page:
        """Initialize an AgentCore session and attach synchronous Playwright."""
        if BrowserClient is None:
            raise RuntimeError("BedrockAgentCore SDK not available")
        if not self.browser_id:
            raise BrowserConfigurationError("create_browser must select BROWSER_ID before starting a session")

        self.browser_client = BrowserClient(region=self.config.region)
        self.session_id = self.browser_client.start(
            identifier=self.browser_id,
            name=f"citation_crawler_session_{get_timestamp_compact()}",
            session_timeout_seconds=self.config.browser_session_timeout,
        )

        logger.info("AgentCore browser session started: %s", self.session_id)
        ws_url, headers = self.browser_client.generate_ws_headers()

        # AgentCore does not currently expose a documented readiness signal.
        # Keep the existing bounded delay until CDP-connect retry can be proven
        # against the deployed SDK rather than guessing at a private API.
        time.sleep(10)

        logger.info("Connecting Playwright")
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.connect_over_cdp(
            ws_url,
            headers=headers,
        )

        if not self.browser.contexts:
            raise RuntimeError("AgentCore browser session returned no browser context")
        self.context = self.browser.contexts[0]
        self.page = self.context.pages[0] if self.context.pages else self.context.new_page()

        logger.info("Playwright connected successfully")
        return self.page

    def _active_context(self) -> BrowserContext:
        """The context of the running session; raises when no session was initialized."""
        if self.context is None:
            raise RuntimeError(_SESSION_NOT_INITIALIZED)
        return self.context

    def _active_page(self) -> Page:
        """The page of the running session; raises when no session was initialized."""
        if self.page is None:
            raise RuntimeError(_SESSION_NOT_INITIALIZED)
        return self.page

    def _read_body_text(self) -> str:
        """Read visible text while allowing documents whose body is still absent."""
        page_text = self._active_page().evaluate(_BODY_TEXT_JAVASCRIPT)
        return page_text if isinstance(page_text, str) else ""

    def _guard_document_request(self, route) -> None:
        """Abort any document navigation whose destination fails SSRF checks."""
        request = route.request
        if request.resource_type != "document":
            route.continue_()
            return

        is_safe, error_message = validate_url_safe(request.url)
        if is_safe:
            route.continue_()
            return

        self._navigation_guard_error = error_message
        logger.warning("Blocked unsafe browser document navigation")
        route.abort("blockedbyclient")

    @property
    def navigation_guard_error(self) -> str | None:
        """Return any unsafe document destination observed by the route guard."""
        return self._navigation_guard_error

    @staticmethod
    def _navigation_error_result(url: str, error_message: str) -> dict[str, str]:
        return {
            "status": "error",
            "url": url,
            "error": error_message,
        }

    def navigate_to_url(self, url: str) -> dict:
        """Navigate to a URL and return basic page information."""
        try:
            page = self._active_page()
            context = self._active_context()
            logger.info("Navigating to cited page")
            self._navigation_guard_error = None
            context.route("**/*", self._guard_document_request)
            page.goto(url, wait_until="domcontentloaded", timeout=60000)

            if self._navigation_guard_error:
                return self._navigation_error_result(url, self._navigation_guard_error)

            page.wait_for_timeout(3000)
            if self._navigation_guard_error:
                return self._navigation_error_result(url, self._navigation_guard_error)

            # Detection only. Web Bot Auth may prevent a challenge when the
            # publisher permits verified bots; otherwise we record the block
            # and never attempt to solve or bypass it.
            if self._detect_captcha_block():
                logger.warning("CAPTCHA-protected page; recording as blocked")
                return {
                    "status": "blocked",
                    "url": url,
                    "block_reason": "captcha",
                    "timestamp": get_timestamp(),
                }

            return {
                "status": "success",
                "url": url,
                "title": page.title(),
                "timestamp": get_timestamp(),
            }

        except Exception as exc:
            error_message = self._navigation_guard_error or str(exc)
            logger.exception("Navigation error: %s", error_message)
            return self._navigation_error_result(url, error_message)

    def _detect_captcha_block(self) -> bool:
        """Return whether the current page is a CAPTCHA or bot-challenge wall."""
        normalized_text = self._read_body_text().lower()
        indicators = (
            "slide to verify",
            "slide right to secure",
            "slide right to access",
            "drag the slider",
            "slide to unlock",
            "verify you are human",
            "prove you are not a robot",
            "i am not a robot",
            "please complete the security check",
        )
        return any(indicator in normalized_text for indicator in indicators)

    def extract_page_content(self) -> dict:
        """Extract bounded visible content and basic metadata from the page."""
        try:
            logger.info("Extracting page content")
            page = self._active_page()
            title = page.title()
            text_content = self._read_body_text()

            max_chars = 50000
            if len(text_content) > max_chars:
                text_content = text_content[:max_chars]
                logger.warning("Content truncated to %s chars", max_chars)

            metadata = page.evaluate("""
                () => {
                    return {
                        description: document.querySelector('meta[name="description"]')?.content || '',
                        keywords: document.querySelector('meta[name="keywords"]')?.content || '',
                        author: document.querySelector('meta[name="author"]')?.content || ''
                    };
                }
            """)

            return {
                "status": "success",
                "title": title,
                "content": text_content,
                "metadata": metadata,
                "content_length": len(text_content),
                "url": page.url,
            }

        except Exception as exc:
            logger.exception("Content extraction error")
            return {
                "status": "error",
                "error": str(exc),
            }

    def take_screenshot(self) -> dict:
        """Take a full-page PNG screenshot of the current page."""
        try:
            logger.info("Taking screenshot")
            screenshot_bytes = self._active_page().screenshot(full_page=True, type="png")
            screenshot_base64 = base64.b64encode(screenshot_bytes).decode("utf-8")

            return {
                "status": "success",
                "screenshot_base64": screenshot_base64,
                "timestamp": get_timestamp(),
            }

        except Exception as exc:
            logger.exception("Screenshot error")
            return {
                "status": "error",
                "error": str(exc),
            }

    def cleanup(self) -> None:
        """Detach and independently release every browser resource exactly once."""
        context = self.context
        browser = self.browser
        playwright = self.playwright
        browser_client = self.browser_client

        self.page = None
        self.context = None
        self.browser = None
        self.playwright = None
        self.browser_client = None
        self.session_id = None

        if context is not None:
            try:
                logger.info("Removing browser request routes")
                context.unroute_all(behavior="wait")
            except Exception:
                logger.exception("Could not remove browser request routes")

        if browser is not None:
            try:
                logger.info("Closing browser connection")
                browser.close()
            except Exception:
                logger.exception("Could not close Playwright browser connection")

        if playwright is not None:
            try:
                logger.info("Stopping Playwright")
                playwright.stop()
            except Exception:
                logger.exception("Could not stop Playwright")

        if browser_client is not None:
            try:
                logger.info("Stopping AgentCore browser session")
                browser_client.stop()
            except Exception:
                logger.exception("Could not stop AgentCore browser session")

        logger.info("Browser cleanup attempts complete")
