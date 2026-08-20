"""
Retrying HTTP clients for AI providers, plus the web-search provider registry.

The client classes moved here verbatim from ``lambda/search/api_clients.py``
(bugs.md 3.1) so the keyword-research Lambda reuses the real, retrying
clients instead of carrying drifted simplified copies (which had no
``retry_with_backoff``, a 20s Gemini timeout, and an OpenAI payload missing
``include: web_search_call.action.sources``). ``api_clients`` re-exports
them for the search Lambda's existing imports.

The registry (``WEB_SEARCH_PROVIDERS``) maps each web-search-capable
provider to its secret name, client class, query runner, and response-text
extractor, in fallback preference order. ``get_web_search_clients`` +
``search_with_fallback`` replace keyword-research's private
``get_ai_client`` (whose first two tuple elements were dead at every call
site) and its per-provider extraction copies.
"""

from __future__ import annotations

import functools
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import requests

from shared.secrets import get_api_key

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def retry_with_backoff(
    provider_name: str,
    max_retries: int = 5,
    retryable_codes: set[int] | None = None,
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
        def wrapper(*args, **kwargs) -> dict[str, Any]:
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

                    # Attach the response body to the exception. `requests`
                    # raises `400 Client Error: Bad Request for url: ...` and
                    # nothing else — the body, which is the only place a
                    # provider says *why* it refused, is logged above and then
                    # dropped. `shared.provider_health` classifies on message
                    # text (Anthropic reports credit exhaustion as 400, not
                    # 402), so without the body every billing outage classifies
                    # as `unknown`: non-terminal, so auto-disable never fires,
                    # and the dashboard shows "unrecognised error" instead of
                    # "No credit remaining". That is the 2026-08-14 incident
                    # staying invisible with the fix supposedly in place.
                    try:
                        response.raise_for_status()
                    except requests.exceptions.HTTPError as http_error:
                        raise requests.exceptions.HTTPError(
                            f"{http_error} | {response.text[:500]}",
                            response=response,
                            request=http_error.request,
                        ) from http_error
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
    def _make_request(self, payload: dict, timeout: int = 90) -> requests.Response:
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

    def responses_with_web_search(self, query: str, model: str = "gpt-5-mini", max_retries: int = 5) -> dict[str, Any]:
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
    def _make_request(self, payload: dict, timeout: int = 60) -> requests.Response:
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

    def chat_completion(self, messages: list[dict], model: str = "sonar", max_retries: int = 5) -> dict[str, Any]:
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
        # Use gemini-3-flash-preview for better grounding with more citations
        self.model = "gemini-3-flash-preview"

    @retry_with_backoff(provider_name="GEMINI", timeout=60)
    def _make_request(self, payload: dict, timeout: int = 60) -> requests.Response:
        """Make HTTP request to Gemini API."""
        url = f"{self.base_url}/models/{self.model}:generateContent"
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        return requests.post(url, json=payload, headers=headers, timeout=timeout)

    def generate_content(self, prompt: str, max_retries: int = 5) -> dict[str, Any]:
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
    def _make_request(self, payload: dict, timeout: int = 60) -> requests.Response:
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

    def generate_content(self, prompt: str, system_prompt: str | None = None, max_retries: int = 5) -> dict[str, Any]:
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


# ---------------------------------------------------------------------------
# Web-search provider registry (keyword research / fallback querying)
# ---------------------------------------------------------------------------

def _run_perplexity(client: PerplexityClient, prompt: str) -> dict[str, Any]:
    return client.chat_completion([{"role": "user", "content": prompt}])


def _run_openai(client: OpenAIClient, prompt: str) -> dict[str, Any]:
    return client.responses_with_web_search(query=prompt)


def _run_gemini(client: GeminiClient, prompt: str) -> dict[str, Any]:
    return client.generate_content(prompt)


def _extract_perplexity_text(response: dict[str, Any]) -> str:
    choices = response.get('choices', [])
    if not choices:
        logger.warning(f"Perplexity response has no choices: {response}")
        return ''
    content = choices[0].get('message', {}).get('content', '')
    logger.info(f"Perplexity content length: {len(content)}")
    return content


def _extract_openai_text(response: dict[str, Any]) -> str:
    for item in response.get('output', []):
        if item.get('type') == 'message':
            for content in item.get('content', []):
                if content.get('type') == 'output_text':
                    return content.get('text', '')
    return response.get('output_text', '')


def _extract_gemini_text(response: dict[str, Any]) -> str:
    candidates = response.get('candidates', [])
    if not candidates:
        return ''
    parts = candidates[0].get('content', {}).get('parts', [])
    return ' '.join([part.get('text', '') for part in parts])


@dataclass(frozen=True)
class WebSearchProvider:
    """One registry entry: how to build, call, and read a provider."""

    provider_id: str
    secret_name: str
    client_class: type
    run: Callable[[Any, str], dict[str, Any]]
    extract_text: Callable[[dict[str, Any]], str]


# Fallback preference order (Perplexity first — best native web search for
# research prompts), matching the order keyword-research always used.
WEB_SEARCH_PROVIDERS: tuple[WebSearchProvider, ...] = (
    WebSearchProvider('perplexity', 'perplexity-key', PerplexityClient, _run_perplexity, _extract_perplexity_text),
    WebSearchProvider('openai', 'openai-key', OpenAIClient, _run_openai, _extract_openai_text),
    WebSearchProvider('gemini', 'gemini-key', GeminiClient, _run_gemini, _extract_gemini_text),
)


def get_web_search_clients() -> list[tuple[WebSearchProvider, Any]]:
    """Build ``(provider, client)`` pairs for every configured provider.

    Skips unconfigured providers — ``get_api_key`` returns ``None`` for
    missing, empty, and placeholder keys. Order follows
    ``WEB_SEARCH_PROVIDERS`` preference.
    """
    clients = []
    for provider in WEB_SEARCH_PROVIDERS:
        key = get_api_key(provider.secret_name)
        if key:
            clients.append((provider, provider.client_class(key)))
    return clients


def search_with_fallback(clients: list[tuple[WebSearchProvider, Any]], prompt: str) -> tuple[str, str]:
    """Try each provider in order; return ``(response_text, provider_id)``.

    Any provider error falls through to the next entry; when every provider
    fails, the last error is re-raised.
    """
    last_error = None
    for provider, client in clients:
        try:
            logger.info(f"Trying {provider.provider_id}")
            raw_response = provider.run(client, prompt)
            return provider.extract_text(raw_response), provider.provider_id
        except Exception as e:
            logger.warning(f"{provider.provider_id} failed: {e}")
            last_error = e
            continue
    raise last_error or Exception("All providers failed")
