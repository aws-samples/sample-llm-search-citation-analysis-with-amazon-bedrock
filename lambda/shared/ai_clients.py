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
import os
import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import requests

from shared.markets import (
    Market,
    claude_user_location,
    market_instructions,
    openai_user_location,
    perplexity_user_location,
)
from shared.provider_models import DEFAULT_PROVIDER_MODELS
from shared.secrets import get_api_key

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

# Seconds one HTTP attempt may take. OpenAI's web search answers took up to
# 56 s without a market in the 2.37.0 measurements, so 90 s left no margin;
# Claude's search is no longer capped at five uses and answers with up to
# 4096 tokens. The research worker passes its own, shorter timeout (two
# attempts must fit its 300 s Lambda).
OPENAI_TIMEOUT_SECONDS = 180
PERPLEXITY_TIMEOUT_SECONDS = 60
GEMINI_TIMEOUT_SECONDS = 60
CLAUDE_TIMEOUT_SECONDS = 120


def _with_market(
    payload: dict[str, Any], market: Market | None, user_location: Callable[[Market], dict[str, Any]],
) -> dict[str, Any]:
    """``payload`` with ``market``'s ``instructions`` and its ``user_location`` on the (one) tool; unchanged without a market."""
    if market is not None:
        payload["tools"][0]["user_location"] = user_location(market)
        payload["instructions"] = market_instructions(market)
    return payload


def openai_web_search_payload(query: str, model: str, market: Market | None = None) -> dict[str, Any]:
    """The Responses API body every OpenAI web-search call sends.

    Shared with the Settings model check (``manage-providers.py``) so a model
    is validated against exactly the tool configuration runs will use. The
    ``web_search`` tool (``web_search_preview`` is the legacy one) with
    ``tool_choice: required``: an answer from memory has no citations to
    measure. A market adds its ``instructions`` block and the tool's
    approximate ``user_location``; the query itself never changes.
    """
    payload: dict[str, Any] = {
        "model": model,
        "tools": [{"type": "web_search"}],
        "tool_choice": "required",
        "include": ["web_search_call.action.sources"],
        "input": query,
    }
    return _with_market(payload, market, openai_user_location)


def gemini_generate_url(model: str) -> str:
    """The ``generateContent`` endpoint for ``model`` (v1beta: preview models live only there)."""
    return f"{GEMINI_API_BASE}/models/{model}:generateContent"


def gemini_grounded_payload(prompt: str, market: Market | None = None) -> dict[str, Any]:
    """The ``generateContent`` body with Google Search grounding, shared with the Settings model check.

    Gemini has no location parameter; a market travels only as the
    ``systemInstruction``.
    """
    payload: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "tools": [{"googleSearch": {}}],
    }
    if market is not None:
        payload["systemInstruction"] = {"parts": [{"text": market_instructions(market)}]}
    return payload


PERPLEXITY_API_BASE = "https://api.perplexity.ai"
PERPLEXITY_AGENT_URL = f"{PERPLEXITY_API_BASE}/v1/agent"
PERPLEXITY_MODELS_URL = f"{PERPLEXITY_API_BASE}/v1/models"
PERPLEXITY_MAX_OUTPUT_TOKENS = 4096
ANTHROPIC_API_BASE = "https://api.anthropic.com/v1"
ANTHROPIC_VERSION = "2023-06-01"


def perplexity_agent_payload(
    prompt: str, model: str, market: Market | None = None, *, max_output_tokens: int = PERPLEXITY_MAX_OUTPUT_TOKENS,
) -> dict[str, Any]:
    """The Agent API body (``POST /v1/agent``), shared with the Settings model check.

    The Sonar Chat Completions API was retired on 2026-09-27. On the Agent
    API a model answers from memory unless it is given the ``web_search``
    tool, so the tool is always sent. A market adds its ``instructions`` and
    the tool's ``user_location``.
    """
    payload: dict[str, Any] = {
        "model": model,
        "input": prompt,
        "tools": [{"type": "web_search"}],
        "max_output_tokens": max_output_tokens,
    }
    return _with_market(payload, market, perplexity_user_location)


def perplexity_agent_text(response: dict[str, Any]) -> str:
    """The answer text of an Agent API response: every ``message`` item's text parts, in order."""
    return "".join(
        part.get("text", "")
        for item in response.get("output") or []
        if isinstance(item, dict) and item.get("type") == "message"
        for part in item.get("content") or []
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    )


def anthropic_headers(api_key: str) -> dict[str, str]:
    """The headers every Anthropic API call sends."""
    return {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }


CLAUDE_WEB_SEARCH_TOOL = "web_search_20260318"
CLAUDE_MAX_TOKENS = 4096
#: ``allowed_callers`` value that turns dynamic filtering off (the tool is called by the model directly).
CLAUDE_DIRECT_CALLERS = ("direct",)


def claude_web_search_payload(
    prompt: str,
    model: str,
    *,
    system_prompt: str | None = None,
    max_tokens: int = CLAUDE_MAX_TOKENS,
    market: Market | None = None,
    allowed_callers: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """The Messages API body with the web search tool, shared with the Settings model check.

    A model without web-search support answers 400 to exactly this body, so
    the check proves the tool configuration analysis runs use. The newest
    tool version, with its default dynamic filtering (``allowed_callers``
    unset; ``CLAUDE_DIRECT_CALLERS`` is the fallback for a model that refuses
    it), the full ``response_inclusion`` (``excluded`` drops every citation)
    and no ``max_uses``: citations are not capped. A market goes into
    ``system`` ahead of ``system_prompt`` and into the tool's ``user_location``.
    """
    tool: dict[str, Any] = {"type": CLAUDE_WEB_SEARCH_TOOL, "name": "web_search"}
    if allowed_callers:
        tool["allowed_callers"] = list(allowed_callers)
    if market is not None:
        tool["user_location"] = claude_user_location(market)
    payload: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
        "tools": [tool],
    }
    system = "\n\n".join(part for part in (market_instructions(market) if market else None, system_prompt) if part)
    if system:
        payload["system"] = system
    return payload


def is_claude_caller_refusal(status_code: int, body: str) -> bool:
    """Whether a reply is a model refusing dynamic filtering (a 400 naming ``allowed_callers``)."""
    return status_code == 400 and "allowed_callers" in body


#: In-body web search errors (HTTP 200) worth asking again for.
CLAUDE_RETRYABLE_SEARCH_ERRORS = frozenset({"too_many_requests", "unavailable"})
CLAUDE_SEARCH_ERROR_RETRIES = 2


class ClaudeSearchError(RuntimeError):
    """Claude's web search failed inside a 200 answer (``web_search_tool_result.content.error_code``)."""


def claude_search_error_codes(response: dict[str, Any]) -> list[str]:
    """The ``error_code`` of every failed ``web_search_tool_result`` block, in order."""
    codes: list[str] = []
    for block in response.get("content") or []:
        content = block.get("content") if isinstance(block, dict) and block.get("type") == "web_search_tool_result" else None
        if isinstance(content, dict) and isinstance(content.get("error_code"), str):
            codes.append(content["error_code"])
    return codes

# ``retry_with_backoff``: attempts for timeouts and 5xx when the call names no
# ``max_retries``, and the statuses that are retried at all.
DEFAULT_MAX_RETRIES = 5
RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})

# Extra attempts a 429 earns on top of the caller's ``max_retries``. Throttling
# answers in milliseconds, so waiting it out is cheap — unlike the timeouts the
# caller's budget is sized for (the research worker allows two attempts because
# two of its HTTP timeouts must fit a 300s Lambda). The default three throttled
# waits cost at most ~14s plus jitter; the analysis provider Lambdas, which run
# one provider each with a longer timeout, raise it through
# ``PROVIDER_THROTTLE_EXTRA_ATTEMPTS`` so a per-minute limit is always waited
# out (5 + 12 attempts: at most ~6.6 minutes of waiting, each wait capped at 30s).
THROTTLE_EXTRA_ATTEMPTS = 3
THROTTLE_EXTRA_ATTEMPTS_ENV = 'PROVIDER_THROTTLE_EXTRA_ATTEMPTS'
THROTTLE_MAX_WAIT_SECONDS = 30.0
# ``x-ratelimit-reset`` values above this are epoch seconds (Perplexity sends
# those); smaller positive values are seconds from now.
_EPOCH_THRESHOLD = 1e9


def throttle_extra_attempts() -> int:
    """The extra 429 attempts, from ``PROVIDER_THROTTLE_EXTRA_ATTEMPTS`` (an int >= 0) or the default.

    Read on every call, not at import, so a test (or a Lambda whose
    environment changed) sees the current value. An invalid value falls back
    to ``THROTTLE_EXTRA_ATTEMPTS`` with a warning rather than failing the call.
    """
    # Literal name (not THROTTLE_EXTRA_ATTEMPTS_ENV) so scripts/check-contracts.py
    # can match it to the CDK stack that sets it.
    raw = os.environ.get('PROVIDER_THROTTLE_EXTRA_ATTEMPTS')
    if raw is None or raw.strip() == '':
        return THROTTLE_EXTRA_ATTEMPTS
    try:
        value = int(raw)
    except ValueError:
        value = -1
    if value < 0:
        logger.warning(
            '[THROTTLE_CONFIG] %s=%r is not an integer >= 0; using %s', THROTTLE_EXTRA_ATTEMPTS_ENV, raw, THROTTLE_EXTRA_ATTEMPTS
        )
        return THROTTLE_EXTRA_ATTEMPTS
    return value


def _backoff_seconds(attempt: int) -> float:
    """Exponential backoff for attempt ``attempt`` (0-based): 1s, 2.5s, 5s, 9.5s, 17s."""
    return (2 ** attempt) + (attempt * 0.5)


def _positive_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _provider_wait_seconds(headers: Any) -> float | None:
    """Seconds the provider asked for: ``Retry-After``, else ``x-ratelimit-reset``; ``None`` if neither is usable.

    ``x-ratelimit-reset`` is an epoch timestamp when it is above
    ``_EPOCH_THRESHOLD`` (a reset already in the past means "now", so no
    provider wait), and seconds from now otherwise.
    """
    retry_after = _positive_float(headers.get('Retry-After', ''))
    if retry_after is not None:
        return retry_after
    reset = _positive_float(headers.get('x-ratelimit-reset', ''))
    if reset is None or reset <= _EPOCH_THRESHOLD:
        return reset
    return _positive_float(reset - time.time())


def _throttle_wait_seconds(response: Any, attempt: int) -> float:
    """How long to wait after a 429 before attempt ``attempt + 1``.

    Never earlier than the provider asked (``Retry-After`` or
    ``x-ratelimit-reset``) and never less patient than exponential backoff:
    the longer of the two. Full jitter is added so parallel calls that were
    throttled together do not retry in lockstep and collide again — three
    Perplexity steps fired within 100ms of each other did exactly that, one
    1.0s sleep each, and one of them lost. Capped at
    ``THROTTLE_MAX_WAIT_SECONDS``.
    """
    headers = getattr(response, 'headers', None) or {}
    base = max(_provider_wait_seconds(headers) or 0.0, _backoff_seconds(attempt))
    return min(base + random.uniform(0, base), THROTTLE_MAX_WAIT_SECONDS)


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
            '[%s_FAILED] Status %s after %s attempts | Error: %s', provider_name, response.status_code, attempt + 1, error_body
        )
        return None
    wait_time = _throttle_wait_seconds(response, attempt) if throttled else _backoff_seconds(attempt)
    logger.warning(
        '[%s_RETRY] Status %s | Attempt %s/%s | Waiting %.1fs | Error: %s', provider_name, response.status_code, attempt + 1, budget, wait_time, error_body
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
            logger.error('[%s_TIMEOUT_FAILED] After %s attempts', provider_name, max_retries, exc_info=error)
        else:
            logger.error(
                '[%s_REQUEST_FAILED] %s after %s attempts', provider_name, str(error)[:500], max_retries,
                exc_info=error,
            )
        return None
    wait_time = _backoff_seconds(attempt)
    if timed_out:
        logger.warning('[%s_TIMEOUT] Attempt %s/%s | Waiting %ss', provider_name, attempt + 1, max_retries, wait_time)
    else:
        logger.warning(
            '[%s_REQUEST_ERROR] %s | Attempt %s/%s | Waiting %ss', provider_name, str(error)[:200], attempt + 1, max_retries, wait_time
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


def _is_client_error(error: requests.exceptions.RequestException) -> bool:
    """Whether ``error`` is an HTTP 4xx answer (the request itself was refused)."""
    response = getattr(error, 'response', None)
    status = getattr(response, 'status_code', None)
    return isinstance(error, requests.exceptions.HTTPError) and isinstance(status, int) and 400 <= status < 500


def retry_with_backoff(provider_name: str, timeout: int = 60):
    """
    Decorator for HTTP requests with exponential backoff retry logic.

    The wrapped call's ``max_retries`` keyword (default ``DEFAULT_MAX_RETRIES``)
    bounds the attempts for timeouts and 5xx answers. A 429 gets
    ``throttle_extra_attempts()`` more (env ``PROVIDER_THROTTLE_EXTRA_ATTEMPTS``,
    default 3), with jittered, ``Retry-After`` / ``x-ratelimit-reset``-aware
    waits — throttling is fast to fail and cheap to wait out, so it should not
    spend the budget sized for slow failures. ``RETRYABLE_STATUS_CODES`` are
    retried; any other 4xx raises at once. A call may pass ``timeout`` to
    override the decorator's per-attempt timeout.

    Args:
        provider_name: Name of the provider for logging (e.g., "OPENAI", "PERPLEXITY")
        timeout: Request timeout in seconds
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> dict[str, Any]:
            actual_max_retries = kwargs.pop('max_retries', DEFAULT_MAX_RETRIES)
            call_timeout = kwargs.pop('timeout', timeout)
            throttle_attempts = actual_max_retries + throttle_extra_attempts()

            attempt = 0
            while attempt < throttle_attempts:
                try:
                    response = func(*args, timeout=call_timeout, **kwargs)

                    if response.status_code in RETRYABLE_STATUS_CODES:
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
                            '[%s_ERROR] Status %s | Response: %s', provider_name, response.status_code, response.text[:500]
                        )

                    _raise_for_status_with_body(response)
                    return response.json()

                except requests.exceptions.RequestException as error:
                    # A client error (400, 401, 404, ...) is the provider
                    # refusing this exact request: sending it again cannot
                    # succeed, so it propagates at once rather than spending
                    # the budget sized for slow failures. (A spent 429 budget
                    # lands here too, already exhausted.)
                    if _is_client_error(error):
                        raise
                    wait_time = _request_error_wait(provider_name, error, attempt, actual_max_retries)
                    if wait_time is None:
                        raise
                    time.sleep(wait_time)
                    attempt += 1

            logger.error('[%s_EXHAUSTED] Failed after %s attempts', provider_name, actual_max_retries)
            raise RuntimeError(f"{provider_name} API failed after {actual_max_retries} attempts")

        return wrapper
    return decorator


class _ProviderClient:
    """What every AI engine client holds: its key, its model and the per-attempt HTTP timeout."""

    default_model: str
    default_timeout: int
    #: The provider's retrying POST (``retry_with_backoff``); takes ``max_retries`` and ``timeout``.
    _make_request: Callable[..., dict[str, Any]]

    def __init__(self, api_key: str, model: str | None = None, timeout: int | None = None):
        self.api_key = api_key
        self.model = model or self.default_model
        self.timeout = timeout or self.default_timeout

    def _send_payload(self, payload: dict[str, Any], max_retries: int) -> dict[str, Any]:
        """POST ``payload`` with this client's per-attempt timeout."""
        return self._make_request(payload, max_retries=max_retries, timeout=self.timeout)


class OpenAIClient(_ProviderClient):
    """Lightweight OpenAI API client with native web search via Responses API."""

    default_model = DEFAULT_PROVIDER_MODELS['openai']
    default_timeout = OPENAI_TIMEOUT_SECONDS
    base_url = "https://api.openai.com/v1"

    @retry_with_backoff(provider_name="OPENAI", timeout=OPENAI_TIMEOUT_SECONDS)
    def _make_request(self, payload: dict, timeout: int = OPENAI_TIMEOUT_SECONDS) -> requests.Response:
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

    def responses_with_web_search(
        self, query: str, model: str | None = None, max_retries: int = 5, market: Market | None = None,
    ) -> dict[str, Any]:
        """Call OpenAI Responses API with native web search (``model`` defaults to the client's)."""
        return self._send_payload(openai_web_search_payload(query, model or self.model, market), max_retries)


class PerplexityClient(_ProviderClient):
    """Lightweight Perplexity Agent API client (``POST /v1/agent`` with the web search tool)."""

    default_model = DEFAULT_PROVIDER_MODELS['perplexity']
    default_timeout = PERPLEXITY_TIMEOUT_SECONDS

    @retry_with_backoff(provider_name="PERPLEXITY", timeout=PERPLEXITY_TIMEOUT_SECONDS)
    def _make_request(self, payload: dict, timeout: int = PERPLEXITY_TIMEOUT_SECONDS) -> requests.Response:
        """Make HTTP request to Perplexity API."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        return requests.post(
            PERPLEXITY_AGENT_URL,
            headers=headers,
            json=payload,
            timeout=timeout
        )

    def agent_response(
        self, prompt: str, market: Market | None = None, *, model: str | None = None, max_retries: int = 5,
    ) -> dict[str, Any]:
        """Ask the Agent API ``prompt`` with web search (``model`` defaults to the client's)."""
        return self._send_payload(perplexity_agent_payload(prompt, model or self.model, market), max_retries)


class GeminiClient(_ProviderClient):
    """Lightweight Google Gemini API client with Google Search."""

    default_model = DEFAULT_PROVIDER_MODELS['gemini']
    default_timeout = GEMINI_TIMEOUT_SECONDS

    @retry_with_backoff(provider_name="GEMINI", timeout=GEMINI_TIMEOUT_SECONDS)
    def _make_request(self, payload: dict, timeout: int = GEMINI_TIMEOUT_SECONDS) -> requests.Response:
        """Make HTTP request to Gemini API."""
        url = gemini_generate_url(self.model)
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        return requests.post(url, json=payload, headers=headers, timeout=timeout)

    def generate_content(self, prompt: str, max_retries: int = 5, market: Market | None = None) -> dict[str, Any]:
        """Call Gemini Generate Content API with Google Search."""
        return self._send_payload(gemini_grounded_payload(prompt, market), max_retries)


class ClaudeClient(_ProviderClient):
    """Lightweight Anthropic Claude API client with web search."""

    default_model = DEFAULT_PROVIDER_MODELS['claude']
    default_timeout = CLAUDE_TIMEOUT_SECONDS

    @retry_with_backoff(provider_name="CLAUDE", timeout=CLAUDE_TIMEOUT_SECONDS)
    def _make_request(self, payload: dict, timeout: int = CLAUDE_TIMEOUT_SECONDS) -> requests.Response:
        """Make HTTP request to Claude API."""
        return requests.post(
            f"{ANTHROPIC_API_BASE}/messages",
            headers=anthropic_headers(self.api_key),
            json=payload,
            timeout=timeout
        )

    def _send(self, payload: dict[str, Any], max_retries: int) -> tuple[dict[str, Any], dict[str, Any]]:
        """``(response, payload actually sent)``: once more with direct callers if the model refuses dynamic filtering."""
        try:
            return self._send_payload(payload, max_retries), payload
        except requests.exceptions.HTTPError as error:
            response = error.response
            if response is None or not is_claude_caller_refusal(response.status_code, response.text or ''):
                raise
        logger.warning('[CLAUDE_CALLERS_FALLBACK] %s refused dynamic filtering; retrying with direct callers', self.model)
        direct = {**payload, "tools": [{**tool, "allowed_callers": list(CLAUDE_DIRECT_CALLERS)} for tool in payload["tools"]]}
        return self._send_payload(direct, max_retries), direct

    def generate_content(
        self, prompt: str, system_prompt: str | None = None, max_retries: int = 5, market: Market | None = None,
    ) -> dict[str, Any]:
        """Call Claude API with web search tool.

        A web search that failed inside a 200 answer with a retryable code
        (``CLAUDE_RETRYABLE_SEARCH_ERRORS``) is asked again, up to
        ``CLAUDE_SEARCH_ERROR_RETRIES`` times; after that ``ClaudeSearchError``
        is raised, because an answer whose search failed has no citations to
        measure.
        """
        payload = claude_web_search_payload(prompt, self.model, system_prompt=system_prompt, market=market)
        attempt = 0
        while True:
            response, payload = self._send(payload, max_retries)
            retryable = [code for code in claude_search_error_codes(response) if code in CLAUDE_RETRYABLE_SEARCH_ERRORS]
            if not retryable:
                return response
            if attempt >= CLAUDE_SEARCH_ERROR_RETRIES:
                raise ClaudeSearchError(f"Claude web search failed: {retryable[0]}")
            wait_time = _backoff_seconds(attempt + 1)
            logger.warning(
                '[CLAUDE_SEARCH_RETRY] In-body search error %s | Attempt %s/%s | Waiting %ss',
                retryable[0], attempt + 1, CLAUDE_SEARCH_ERROR_RETRIES + 1, wait_time,
            )
            time.sleep(wait_time)
            attempt += 1


# ---------------------------------------------------------------------------
# Web-search provider registry (keyword research)
# ---------------------------------------------------------------------------

def _run_perplexity(client: PerplexityClient, prompt: str, max_retries: int = 5) -> dict[str, Any]:
    return client.agent_response(prompt, max_retries=max_retries)


def _run_openai(client: OpenAIClient, prompt: str, max_retries: int = 5) -> dict[str, Any]:
    return client.responses_with_web_search(query=prompt, max_retries=max_retries)


def _run_gemini(client: GeminiClient, prompt: str, max_retries: int = 5) -> dict[str, Any]:
    return client.generate_content(prompt, max_retries=max_retries)


def _extract_perplexity_text(response: dict[str, Any]) -> str:
    text = perplexity_agent_text(response)
    if not text:
        logger.warning('Perplexity response has no message text (status %s)', response.get('status'))
    return text


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
    logger.info('Querying %s', provider.provider_id)
    raw_response = provider.run(client, prompt, max_retries=max_retries)
    return provider.extract_text(raw_response)
