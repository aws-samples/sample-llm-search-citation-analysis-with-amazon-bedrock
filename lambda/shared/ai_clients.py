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
extractor. ``get_web_search_clients`` builds a client per configured
provider and ``run_web_search`` runs one prompt against one of them; the
keyword-research state machine fans those out as parallel steps (one per
provider) so a slow or failing provider costs its own step, not the job.
"""

from __future__ import annotations

import functools
import logging
import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import requests

from shared.secrets import get_api_key

# Extra attempts a 429 earns on top of the caller's ``max_retries``. Throttling
# answers in milliseconds, so waiting it out is cheap — unlike the timeouts the
# caller's budget is sized for (the research worker allows two attempts because
# OpenAI's 90s timeout must fit a 300s Lambda). Three throttled waits cost at
# most ~14s plus jitter.
THROTTLE_EXTRA_ATTEMPTS = 3
THROTTLE_MAX_WAIT_SECONDS = 30.0


def _backoff_seconds(attempt: int) -> float:
    """Exponential backoff for attempt ``attempt`` (0-based): 1s, 2.5s, 5s, 9.5s, 17s."""
    return (2 ** attempt) + (attempt * 0.5)


def _throttle_wait_seconds(response: Any, attempt: int) -> float:
    """How long to wait after a 429 before attempt ``attempt + 1``.

    Honours a numeric ``Retry-After`` header when the provider sends one,
    otherwise exponential backoff; either way full jitter is added so parallel
    steps that were throttled together do not retry in lockstep and collide
    again — three Perplexity steps fired within 100ms of each other did exactly
    that, one 1.0s sleep each, and one of them lost.
    """
    retry_after = None
    headers = getattr(response, 'headers', None) or {}
    try:
        retry_after = float(headers.get('Retry-After', ''))
    except (TypeError, ValueError):
        retry_after = None
    base = retry_after if retry_after is not None and retry_after > 0 else _backoff_seconds(attempt)
    return min(base + random.uniform(0, base), THROTTLE_MAX_WAIT_SECONDS)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _status_retry_wait(
    provider_name: str,
    response: requests.Response,
    attempt: int,
    *,
    max_retries: int,
    throttle_attempts: int,
) -> float | None:
    """Seconds to wait before retrying a retryable status, or ``None`` once its budget is spent.

    A 429 draws on ``throttle_attempts`` with jittered, ``Retry-After``-aware
    waits; every other retryable status draws on ``max_retries`` with plain
    backoff. Logs the attempt either way — the ``_RETRY`` / ``_FAILED`` tags
    are what ``scripts/quick-error-check.sh`` filters on.
    """
    error_body = response.text[:200] if response.text else "No error body"
    throttled = response.status_code == 429
    budget = throttle_attempts if throttled else max_retries
    if attempt >= budget - 1:
        logger.error(
            f"[{provider_name}_FAILED] Status {response.status_code} "
            f"after {attempt + 1} attempts | Error: {error_body}"
        )
        return None
    wait_time = _throttle_wait_seconds(response, attempt) if throttled else _backoff_seconds(attempt)
    logger.warning(
        f"[{provider_name}_RETRY] Status {response.status_code} | "
        f"Attempt {attempt + 1}/{budget} | "
        f"Waiting {wait_time:.1f}s | Error: {error_body}"
    )
    return wait_time


def _request_error_wait(
    provider_name: str,
    error: requests.exceptions.RequestException,
    attempt: int,
    max_retries: int,
) -> float | None:
    """Seconds to wait before retrying a failed request, or ``None`` once ``max_retries`` is spent.

    Timeouts keep their own log tags (``_TIMEOUT`` / ``_TIMEOUT_FAILED``) so
    they stay distinguishable from connection and HTTP errors
    (``_REQUEST_ERROR`` / ``_REQUEST_FAILED``). The final failure is logged
    with the traceback of ``error``.
    """
    timed_out = isinstance(error, requests.exceptions.Timeout)
    if attempt >= max_retries - 1:
        if timed_out:
            logger.error(f"[{provider_name}_TIMEOUT_FAILED] After {max_retries} attempts", exc_info=error)
        else:
            logger.error(
                f"[{provider_name}_REQUEST_FAILED] {str(error)[:500]} after {max_retries} attempts",
                exc_info=error,
            )
        return None
    wait_time = _backoff_seconds(attempt)
    if timed_out:
        logger.warning(f"[{provider_name}_TIMEOUT] Attempt {attempt + 1}/{max_retries} | Waiting {wait_time}s")
    else:
        logger.warning(
            f"[{provider_name}_REQUEST_ERROR] {str(error)[:200]} | "
            f"Attempt {attempt + 1}/{max_retries} | Waiting {wait_time}s"
        )
    return wait_time


def _raise_for_status_with_body(response: requests.Response) -> None:
    """``raise_for_status`` with the response body appended to the error message.

    `requests` raises `400 Client Error: Bad Request for url: ...` and nothing
    else — the body, which is the only place a provider says *why* it refused,
    is logged by the caller and then dropped. `shared.provider_health`
    classifies on message text (Anthropic reports credit exhaustion as 400, not
    402), so without the body every billing outage classifies as `unknown`:
    non-terminal, so auto-disable never fires, and the dashboard shows
    "unrecognised error" instead of "No credit remaining". That is the
    2026-08-14 incident staying invisible with the fix supposedly in place.
    """
    try:
        response.raise_for_status()
    except requests.exceptions.HTTPError as http_error:
        raise requests.exceptions.HTTPError(
            f"{http_error} | {response.text[:500]}",
            response=response,
            request=http_error.request,
        ) from http_error


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
        max_retries: Maximum number of retry attempts for timeouts and 5xx
            answers. A 429 gets ``THROTTLE_EXTRA_ATTEMPTS`` more, with jittered,
            ``Retry-After``-aware waits — throttling is fast to fail and cheap
            to wait out, so it should not spend the budget sized for slow failures.
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
            throttle_attempts = actual_max_retries + THROTTLE_EXTRA_ATTEMPTS

            attempt = 0
            while attempt < throttle_attempts:
                try:
                    response = func(*args, timeout=timeout, **kwargs)

                    if response.status_code in retryable_codes:
                        wait_time = _status_retry_wait(
                            provider_name, response, attempt,
                            max_retries=actual_max_retries, throttle_attempts=throttle_attempts,
                        )
                        if wait_time is not None:
                            time.sleep(wait_time)
                            attempt += 1
                            continue

                    if response.status_code != 200:
                        logger.error(
                            f"[{provider_name}_ERROR] Status {response.status_code} | "
                            f"Response: {response.text[:500]}"
                        )

                    # An HTTPError raised here is a RequestException, so a
                    # non-retryable status still consumes the caller's retry
                    # budget below before it propagates.
                    _raise_for_status_with_body(response)
                    return response.json()

                except requests.exceptions.RequestException as error:
                    wait_time = _request_error_wait(provider_name, error, attempt, actual_max_retries)
                    if wait_time is None:
                        raise
                    time.sleep(wait_time)
                    attempt += 1

            logger.error(f"[{provider_name}_EXHAUSTED] Failed after {actual_max_retries} attempts")
            raise RuntimeError(f"{provider_name} API failed after {actual_max_retries} attempts")

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
# Web-search provider registry (keyword research)
# ---------------------------------------------------------------------------

def _run_perplexity(client: PerplexityClient, prompt: str, max_retries: int = 5) -> dict[str, Any]:
    return client.chat_completion([{"role": "user", "content": prompt}], max_retries=max_retries)


def _run_openai(client: OpenAIClient, prompt: str, max_retries: int = 5) -> dict[str, Any]:
    return client.responses_with_web_search(query=prompt, max_retries=max_retries)


def _run_gemini(client: GeminiClient, prompt: str, max_retries: int = 5) -> dict[str, Any]:
    return client.generate_content(prompt, max_retries=max_retries)


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
    run: Callable[..., dict[str, Any]]
    extract_text: Callable[[dict[str, Any]], str]


# Display / step order (Perplexity first — best native web search for
# research prompts), matching the order keyword-research always used.
WEB_SEARCH_PROVIDERS: tuple[WebSearchProvider, ...] = (
    WebSearchProvider('perplexity', 'perplexity-key', PerplexityClient, _run_perplexity, _extract_perplexity_text),
    WebSearchProvider('openai', 'openai-key', OpenAIClient, _run_openai, _extract_openai_text),
    WebSearchProvider('gemini', 'gemini-key', GeminiClient, _run_gemini, _extract_gemini_text),
)


def get_web_search_provider(provider_id: str) -> WebSearchProvider | None:
    """Registry entry for ``provider_id``, or ``None`` for an unknown id."""
    return next((provider for provider in WEB_SEARCH_PROVIDERS if provider.provider_id == provider_id), None)


def get_web_search_clients() -> list[tuple[WebSearchProvider, Any]]:
    """Build ``(provider, client)`` pairs for every configured provider.

    Skips unconfigured providers — ``get_api_key`` returns ``None`` for
    missing, empty, and placeholder keys. Order follows
    ``WEB_SEARCH_PROVIDERS``.
    """
    clients = []
    for provider in WEB_SEARCH_PROVIDERS:
        key = get_api_key(provider.secret_name)
        if key:
            clients.append((provider, provider.client_class(key)))
    return clients


def run_web_search(provider: WebSearchProvider, client: Any, prompt: str, *, max_retries: int = 5) -> str:
    """Run ``prompt`` against one provider and return the response text.

    ``max_retries`` bounds the client's in-process HTTP retries; the caller
    (a Step Functions step with its own budget) decides how many it can
    afford. Errors propagate — the step, not this function, records them.
    """
    logger.info(f"Querying {provider.provider_id}")
    raw_response = provider.run(client, prompt, max_retries=max_retries)
    return provider.extract_text(raw_response)
