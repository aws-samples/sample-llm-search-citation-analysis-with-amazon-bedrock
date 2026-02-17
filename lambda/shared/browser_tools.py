"""
Simplified browser automation tools for Lambda using Bedrock AgentCore.

This is a Lambda-optimized version adapted from the enterprise-web-intelligence-agent example.
It focuses on core crawling functionality needed for citation analysis.

Uses synchronous Playwright API for Lambda compatibility.
Supports pre-created custom browser with Web Bot Auth for reduced CAPTCHAs.

NOTE: Nova Act integration was removed because the SDK is too large for Lambda layers (475MB+).
The crawler relies on Web Bot Auth + Playwright for verification handling.
For Nova Act support, consider using a container-based Lambda.
"""

import os
import uuid
import json
import logging
import time
from typing import Dict, Optional
from datetime import datetime

import boto3
from playwright.sync_api import sync_playwright, Browser, Page, BrowserContext

# Import from BedrockAgentCore SDK
try:
    from bedrock_agentcore.tools.browser_client import BrowserClient
    from bedrock_agentcore._utils.endpoints import get_control_plane_endpoint
    BEDROCK_AGENTCORE_AVAILABLE = True
except ImportError:
    BEDROCK_AGENTCORE_AVAILABLE = False
    logging.warning("BedrockAgentCore SDK not available - browser features will be limited")

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class SimpleBrowserTools:
    """Simplified browser automation tools for Lambda environment."""
    
    def __init__(self, config):
        self.config = config
        self.browser_client = None
        self.browser_id = None
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.session_id = None
        self._browser_created_dynamically = False
    
    def create_browser(self) -> str:
        """
        Get or create a browser for crawling.
        
        If BROWSER_ID environment variable is set, uses the pre-created browser
        with Web Bot Auth enabled. Otherwise, creates a browser dynamically.
        
        Pre-created browser benefits:
        - Faster crawls (skip browser creation overhead ~10s per crawl)
        - Consistent signing identity for Web Bot Auth
        - Lower API costs
        """
        if not BEDROCK_AGENTCORE_AVAILABLE:
            raise RuntimeError("BedrockAgentCore SDK not available")
        
        # Check for pre-created browser ID from environment
        pre_created_browser_id = os.environ.get('BROWSER_ID')
        
        if pre_created_browser_id:
            logger.info(f"Using pre-created browser with Web Bot Auth: {pre_created_browser_id}")
            self.browser_id = pre_created_browser_id
            self._browser_created_dynamically = False
            return self.browser_id
        
        # Fallback: Create browser dynamically (slower, no Web Bot Auth)
        logger.info("Creating browser dynamically (no pre-created browser configured)...")
        
        # Create control plane client
        control_plane_url = get_control_plane_endpoint(self.config.region)
        control_client = boto3.client(
            "bedrock-agentcore-control",
            region_name=self.config.region,
            endpoint_url=control_plane_url
        )
        
        # Create browser
        browser_name = f"citation_crawler_{uuid.uuid4().hex[:8]}"
        
        response = control_client.create_browser(
            name=browser_name,
            networkConfiguration={
                "networkMode": "PUBLIC"
            }
        )
        
        self.browser_id = response["browserId"]
        self._browser_created_dynamically = True
        logger.info(f"Browser created dynamically: {self.browser_id}")
        
        return self.browser_id
    
    def initialize_browser_session(self) -> Page:
        """Initialize browser session with Playwright (synchronous)."""
        if not BEDROCK_AGENTCORE_AVAILABLE:
            raise RuntimeError("BedrockAgentCore SDK not available")
        
        # Create BrowserClient from SDK
        self.browser_client = BrowserClient(region=self.config.region)
        self.browser_client.identifier = self.browser_id
        
        # Start a session
        self.session_id = self.browser_client.start(
            identifier=self.browser_id,
            name=f"citation_crawler_session_{datetime.now().strftime('%Y%m%d-%H%M%S')}",
            session_timeout_seconds=self.config.browser_session_timeout
        )
        
        logger.info(f"Session started: {self.session_id}")
        
        # Get WebSocket headers
        ws_url, headers = self.browser_client.generate_ws_headers()
        
        # Wait for browser initialization
        time.sleep(10)
        
        # Initialize Playwright (synchronous)
        logger.info("Connecting Playwright...")
        self.playwright = sync_playwright().start()
        
        # Connect to the browser via CDP
        self.browser = self.playwright.chromium.connect_over_cdp(
            ws_url,
            headers=headers
        )
        
        # Get context and page
        self.context = self.browser.contexts[0]
        self.page = self.context.pages[0]
        
        logger.info("Playwright connected successfully")
        
        return self.page
    
    def navigate_to_url(self, url: str) -> Dict:
        """Navigate to URL and return basic page information."""
        try:
            logger.info(f"Navigating to: {url}")
            
            # Navigate with timeout
            self.page.goto(url, wait_until="domcontentloaded", timeout=60000)
            
            # Wait for dynamic content
            self.page.wait_for_timeout(3000)
            
            # Check for and handle slider challenges
            self._handle_slider_challenge()
            
            title = self.page.title()
            
            return {
                "status": "success",
                "url": url,
                "title": title,
                "timestamp": datetime.utcnow().isoformat() + 'Z'
            }
            
        except Exception as e:
            logger.error(f"Navigation error: {e}")
            return {
                "status": "error",
                "url": url,
                "error": str(e)
            }
    
    def _handle_slider_challenge(self) -> bool:
        """
        Detect and attempt to complete slider verification challenges.
        
        Returns True if a slider was found and completed, False otherwise.
        """
        try:
            # Check for common slider challenge indicators in page content
            page_text = self.page.evaluate("() => document.body.innerText").lower()
            
            slider_indicators = [
                'slide right to secure',
                'slide to verify',
                'slide right to access',
                'drag the slider',
                'slide to unlock',
            ]
            
            has_slider = any(indicator in page_text for indicator in slider_indicators)
            
            if not has_slider:
                return False
            
            logger.info("Slider challenge detected, attempting to complete...")
            
            # Common slider selectors used by various CAPTCHA providers
            slider_selectors = [
                # Generic arrow/slider buttons
                'button[aria-label*="slide"]',
                'div[class*="slider"] button',
                'div[class*="slider"] span',
                '[class*="slide-btn"]',
                '[class*="slider-button"]',
                # TripAdvisor specific patterns
                'button svg[viewBox]',
                'div[class*="captcha"] button',
                # Arrow buttons
                'button:has(svg)',
            ]
            
            slider_element = None
            for selector in slider_selectors:
                try:
                    element = self.page.query_selector(selector)
                    if element and element.is_visible():
                        slider_element = element
                        logger.info(f"Found slider element with selector: {selector}")
                        break
                except Exception:
                    continue
            
            if not slider_element:
                logger.warning("Slider challenge detected but could not find slider element")
                return False
            
            # Get the bounding box of the slider
            box = slider_element.bounding_box()
            if not box:
                logger.warning("Could not get slider bounding box")
                return False
            
            # Calculate drag distance (slide to the right)
            start_x = box['x'] + box['width'] / 2
            start_y = box['y'] + box['height'] / 2
            
            # Drag 300 pixels to the right (typical slider width)
            end_x = start_x + 300
            
            logger.info(f"Dragging slider from ({start_x}, {start_y}) to ({end_x}, {start_y})")
            
            # Perform the drag with human-like movement
            self.page.mouse.move(start_x, start_y)
            self.page.wait_for_timeout(100)
            self.page.mouse.down()
            self.page.wait_for_timeout(50)
            
            # Move in steps for more natural movement
            steps = 10
            for i in range(1, steps + 1):
                intermediate_x = start_x + (end_x - start_x) * i / steps
                self.page.mouse.move(intermediate_x, start_y)
                self.page.wait_for_timeout(30)
            
            self.page.mouse.up()
            
            # Wait for verification to complete
            self.page.wait_for_timeout(2000)
            
            # Check if we're still on a challenge page
            new_page_text = self.page.evaluate("() => document.body.innerText").lower()
            still_has_slider = any(indicator in new_page_text for indicator in slider_indicators)
            
            if still_has_slider:
                logger.warning("Slider challenge still present after attempt")
                return False
            
            logger.info("Slider challenge completed successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error handling slider challenge: {e}")
            return False
    
    def extract_page_content(self) -> Dict:
        """Extract main content from the current page."""
        try:
            logger.info("Extracting page content...")
            
            # Get page title
            title = self.page.title()
            
            # Get text content (limited to avoid token overflow)
            text_content = self.page.evaluate("() => document.body.innerText")
            
            # Truncate to reasonable size
            max_chars = 50000
            if len(text_content) > max_chars:
                text_content = text_content[:max_chars]
                logger.warning(f"Content truncated to {max_chars} chars")
            
            # Get metadata
            metadata = self.page.evaluate("""
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
                "url": self.page.url
            }
            
        except Exception as e:
            logger.error(f"Content extraction error: {e}")
            return {
                "status": "error",
                "error": str(e)
            }
    
    def take_screenshot(self) -> Dict:
        """Take a screenshot of the current page."""
        try:
            logger.info("Taking screenshot...")
            
            # Take full page screenshot as base64
            screenshot_bytes = self.page.screenshot(full_page=True, type="png")
            
            import base64
            screenshot_base64 = base64.b64encode(screenshot_bytes).decode('utf-8')
            
            return {
                "status": "success",
                "screenshot_base64": screenshot_base64,
                "timestamp": datetime.utcnow().isoformat() + 'Z'
            }
            
        except Exception as e:
            logger.error(f"Screenshot error: {e}")
            return {
                "status": "error",
                "error": str(e)
            }
    
    def cleanup(self):
        """Clean up browser resources."""
        try:
            if self.browser:
                logger.info("Closing browser...")
                self.browser.close()
            
            if self.playwright:
                logger.info("Stopping Playwright...")
                self.playwright.stop()
            
            if self.browser_client:
                logger.info("Stopping session...")
                self.browser_client.stop()
            
            logger.info("Cleanup complete")
        except Exception as e:
            logger.error(f"Cleanup error: {e}")


def crawl_url(url: str, config) -> Dict:
    """
    Convenience function to crawl a single URL (synchronous).
    
    Args:
        url: URL to crawl
        config: LambdaConfig instance
        
    Returns:
        Dictionary with crawled content
    """
    browser_tools = SimpleBrowserTools(config)
    
    try:
        # Create and initialize browser
        browser_tools.create_browser()
        browser_tools.initialize_browser_session()
        
        # Navigate to URL
        nav_result = browser_tools.navigate_to_url(url)
        if nav_result["status"] != "success":
            return nav_result
        
        # Extract content
        content_result = browser_tools.extract_page_content()
        
        return content_result
        
    except Exception as e:
        logger.error(f"Error crawling {url}: {e}")
        return {
            "status": "error",
            "url": url,
            "error": str(e)
        }
    finally:
        browser_tools.cleanup()
