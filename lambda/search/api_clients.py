"""
Lightweight API clients for AI providers using only requests library.
No heavy SDKs - direct HTTP API calls.
"""

import requests
import time
import functools
import logging
from typing import Dict, List, Any, Optional, Callable, Set

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def retry_with_backoff(
    provider_name: str,
    max_retries: int = 5,
    retryable_codes: Set[int] = None,
    timeout: int = 60
):
    """
    Decorator for HTTP requests with exponential backoff retry logic.
    
    Args:
        provider_name: Name of the provider for logging (e.g., "OPENAI", "PERPLEXITY")
        max_retries: Maximum number of retry attempts
        retryable_codes: HTTP status codes that should trigger a retry
        timeout: Request timeout in seconds
    """
    if retryable_codes is None:
        retryable_codes = {429, 500, 502, 503, 504}
    
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> Dict[str, Any]:
            # Allow override of max_retries via kwargs
            actual_max_retries = kwargs.pop('max_retries', max_retries)
            
            for attempt in range(actual_max_retries):
                try:
                    response = func(*args, timeout=timeout, **kwargs)
                    
                    # If rate limited or server error, retry with exponential backoff
                    if response.status_code in retryable_codes:
                        error_body = response.text[:200] if response.text else "No error body"
                        if attempt < actual_max_retries - 1:
                            wait_time = (2 ** attempt) + (attempt * 0.5)  # 1s, 2.5s, 5s, 9.5s, 17s
                            logger.warning(
                                f"[{provider_name}_RETRY] Status {response.status_code} | "
                                f"Attempt {attempt + 1}/{actual_max_retries} | "
                                f"Waiting {wait_time}s | Error: {error_body}"
                            )
                            time.sleep(wait_time)
                            continue
                        else:
                            logger.error(
                                f"[{provider_name}_FAILED] Status {response.status_code} "
                                f"after {actual_max_retries} attempts | Error: {error_body}"
                            )
                    
                    if response.status_code != 200:
                        logger.error(
                            f"[{provider_name}_ERROR] Status {response.status_code} | "
                            f"Response: {response.text[:500]}"
                        )
                    
                    response.raise_for_status()
                    return response.json()
                    
                except requests.exceptions.Timeout:
                    if attempt < actual_max_retries - 1:
                        wait_time = (2 ** attempt) + (attempt * 0.5)
                        logger.warning(
                            f"[{provider_name}_TIMEOUT] Attempt {attempt + 1}/{actual_max_retries} | "
                            f"Waiting {wait_time}s"
                        )
                        time.sleep(wait_time)
                        continue
                    logger.error(f"[{provider_name}_TIMEOUT_FAILED] After {actual_max_retries} attempts")
                    raise
                except requests.exceptions.RequestException as e:
                    if attempt < actual_max_retries - 1:
                        wait_time = (2 ** attempt) + (attempt * 0.5)
                        logger.warning(
                            f"[{provider_name}_REQUEST_ERROR] {str(e)[:200]} | "
                            f"Attempt {attempt + 1}/{actual_max_retries} | Waiting {wait_time}s"
                        )
                        time.sleep(wait_time)
                        continue
                    logger.error(
                        f"[{provider_name}_REQUEST_FAILED] {str(e)[:500]} "
                        f"after {actual_max_retries} attempts"
                    )
                    raise
            
            logger.error(f"[{provider_name}_EXHAUSTED] Failed after {actual_max_retries} attempts")
            raise Exception(f"{provider_name} API failed after {actual_max_retries} attempts")
        
        return wrapper
    return decorator


class OpenAIClient:
    """Lightweight OpenAI API client with native web search via Responses API."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.openai.com/v1"
    
    @retry_with_backoff(provider_name="OPENAI", timeout=90)
    def _make_request(self, payload: Dict, timeout: int = 90) -> requests.Response:
        """Make HTTP request to OpenAI API."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        return requests.post(
            f"{self.base_url}/responses",
            headers=headers,
            json=payload,
            timeout=timeout
        )
        
    def responses_with_web_search(self, query: str, model: str = "gpt-5-mini", max_retries: int = 5) -> Dict[str, Any]:
        """Call OpenAI Responses API with native web search."""
        payload = {
            "model": model,
            "tools": [{"type": "web_search_preview"}],
            "tool_choice": "auto",
            "include": ["web_search_call.action.sources"],
            "input": query
        }
        return self._make_request(payload, max_retries=max_retries)


class PerplexityClient:
    """Lightweight Perplexity API client."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.perplexity.ai"
    
    @retry_with_backoff(provider_name="PERPLEXITY", timeout=60)
    def _make_request(self, payload: Dict, timeout: int = 60) -> requests.Response:
        """Make HTTP request to Perplexity API."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        return requests.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=payload,
            timeout=timeout
        )
        
    def chat_completion(self, messages: List[Dict], model: str = "sonar", max_retries: int = 5) -> Dict[str, Any]:
        """Call Perplexity Chat Completions API."""
        payload = {
            "model": model,
            "messages": messages
        }
        return self._make_request(payload, max_retries=max_retries)


class GeminiClient:
    """Lightweight Google Gemini API client with Google Search."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"
        # Use gemini-2.0-flash for reliable grounding with citations
        self.model = "gemini-2.0-flash"
    
    @retry_with_backoff(provider_name="GEMINI", timeout=60)
    def _make_request(self, payload: Dict, timeout: int = 60) -> requests.Response:
        """Make HTTP request to Gemini API."""
        url = f"{self.base_url}/models/{self.model}:generateContent"
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        return requests.post(url, json=payload, headers=headers, timeout=timeout)
        
    def generate_content(self, prompt: str, max_retries: int = 5) -> Dict[str, Any]:
        """Call Gemini Generate Content API with Google Search."""
        payload = {
            "contents": [{
                "role": "user",
                "parts": [{"text": prompt}]
            }],
            "tools": [{"googleSearch": {}}]
        }
        return self._make_request(payload, max_retries=max_retries)


class ClaudeClient:
    """Lightweight Anthropic Claude API client with web search."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.anthropic.com/v1"
        self.model = "claude-sonnet-4-5"
    
    @retry_with_backoff(provider_name="CLAUDE", timeout=60)
    def _make_request(self, payload: Dict, timeout: int = 60) -> requests.Response:
        """Make HTTP request to Claude API."""
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }
        return requests.post(
            f"{self.base_url}/messages",
            headers=headers,
            json=payload,
            timeout=timeout
        )
        
    def generate_content(self, prompt: str, system_prompt: Optional[str] = None, max_retries: int = 5) -> Dict[str, Any]:
        """Call Claude API with web search tool."""
        payload = {
            "model": self.model,
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
            "tools": [{
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 5
            }]
        }
        
        if system_prompt:
            payload["system"] = system_prompt
        
        return self._make_request(payload, max_retries=max_retries)


def clean_url(url: str) -> str:
    """Clean URL by removing tracking parameters like utm_source, utm_medium, etc."""
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    
    try:
        parsed = urlparse(url)
        query_params = parse_qs(parsed.query, keep_blank_values=True)
        
        tracking_params = {
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'msclkid', '_ga', 'mc_cid', 'mc_eid'
        }
        
        cleaned_params = {k: v for k, v in query_params.items() if k not in tracking_params}
        new_query = urlencode(cleaned_params, doseq=True) if cleaned_params else ''
        
        return urlunparse((
            parsed.scheme, parsed.netloc, parsed.path,
            parsed.params, new_query, parsed.fragment
        ))
    except Exception:
        return url


def extract_citations_from_response(response_text: str) -> List[str]:
    """Extract URLs from response text."""
    import re
    
    url_pattern = r'https?://[^\s<>"{}|\\^`\[\]]+'
    urls = re.findall(url_pattern, response_text)
    
    cleaned_urls = []
    for url in urls:
        url = url.rstrip('.,;:!?)')
        if url:
            cleaned_urls.append(clean_url(url))
    
    return list(set(cleaned_urls))
