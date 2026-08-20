"""
Classify AI provider failures and record provider health.

Why this exists
---------------
On 2026-08-14 a production run reported ``success_rate: 100.0`` while Claude
returned nothing for every query. The cause was Anthropic replying
``400 {"message": "Your credit balance is too low..."}``; the search Lambda
caught it, logged it, returned an empty result, and the pipeline carried on. The
same condition was still live on 2026-08-19, so every run in between measured
brand visibility with one of the configured providers silently absent.

A provider that cannot answer is not the same as a provider that answered with
nothing to report, and the system has to be able to tell the difference. This
module turns a raw exception into one of a small set of *categories*, because
the category is what determines both the message a user can act on and whether
it is worth retrying at all.

Why not query the provider for its balance
------------------------------------------
No provider exposes remaining credit. Anthropic and OpenAI both offer
usage/cost Admin APIs that report *historical spend* and require a separate,
more privileged admin key than the inference keys this system stores; neither
reports a balance, and the remaining seven providers offer nothing comparable.
Deriving "out of credit" from spend would additionally require knowing the
budget. The error response is the authoritative, free, uniform signal — so
detection is based on classifying it.
"""

from __future__ import annotations

import logging
from typing import Any

from .utils import get_timestamp

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

#: The provider has no money left. Retrying cannot succeed until a human acts.
INSUFFICIENT_CREDIT = 'insufficient_credit'

#: The key is missing, malformed, revoked, or lacks access to the model.
INVALID_KEY = 'invalid_key'

#: Throttled. Genuinely transient — retrying later is expected to work.
RATE_LIMITED = 'rate_limited'

#: The request did not complete in time. Transient.
TIMEOUT = 'timeout'

#: Anything unrecognised. Deliberately not treated as terminal.
UNKNOWN = 'unknown'

#: Categories a human must resolve; retrying is pure waste until they do.
TERMINAL_CATEGORIES = frozenset({INSUFFICIENT_CREDIT, INVALID_KEY})

#: Consecutive terminal failures before a provider is auto-disabled.
#: 3 rather than 1 so a one-off mis-classification cannot switch off a working
#: provider, and low enough that a genuinely dead provider stops burning retry
#: budget within a single run.
AUTO_DISABLE_THRESHOLD = 3


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

# Ordered most-specific first. Anthropic signals credit exhaustion with HTTP
# **400**, not 402, so status codes alone are not sufficient — the message text
# is the reliable discriminator and must be checked first.
_CREDIT_MARKERS = (
    'credit balance is too low',      # Anthropic
    'insufficient_quota',             # OpenAI
    'exceeded your current quota',    # OpenAI
    'billing_not_active',
    'payment required',
    'insufficient funds',
    'insufficient credit',
    'out of credits',
    # Deliberately NOT 'quota exceeded'. Google returns
    # `429 RESOURCE_EXHAUSTED — "Quota exceeded for quota metric 'Generate
    # Content API requests per minute'"` for ordinary per-minute throttling.
    # Because credit markers are checked before rate-limit markers, that
    # substring would classify routine Gemini throttling as terminal and
    # auto-disable a perfectly healthy provider after three bursts. OpenAI's
    # spent-account phrasing is already covered by 'exceeded your current
    # quota' above, so the broader form bought nothing and cost a provider.
)

_INVALID_KEY_MARKERS = (
    'invalid api key',
    'incorrect api key',
    'invalid_api_key',
    # Anthropic's literal wording is `invalid x-api-key`, which matches none of
    # the forms above. It only classified at all via the `authentication_error`
    # envelope, so this is the direct match rather than an incidental one.
    'x-api-key',
    'authentication_error',
    'unauthorized',
    'api key not valid',
    'permission denied',
    'forbidden',
)

_RATE_LIMIT_MARKERS = (
    'rate limit',
    'rate_limit',
    'too many requests',
    'overloaded',
    'slow down',
)

_TIMEOUT_MARKERS = (
    'timeout',
    'timed out',
    'read timed out',
    'connection aborted',
)


def classify_provider_error(error: object, status_code: int | None = None) -> str:
    """Map a provider failure to one of the module's categories.

    Args:
        error: The exception or message. Stringified, so anything works.
        status_code: HTTP status when the caller knows it. Only consulted after
            message matching, because Anthropic reports credit exhaustion as
            400 — a status-first rule would mislabel it as a bad request.

    Returns:
        One of ``INSUFFICIENT_CREDIT``, ``INVALID_KEY``, ``RATE_LIMITED``,
        ``TIMEOUT``, ``UNKNOWN``.

    Unrecognised failures return ``UNKNOWN`` rather than a terminal category on
    purpose: ``UNKNOWN`` never auto-disables a provider, so a message this
    module has not seen before degrades to "keep trying and stay visible"
    instead of switching a working provider off.
    """
    text = str(error).lower()

    if any(marker in text for marker in _CREDIT_MARKERS):
        return INSUFFICIENT_CREDIT
    if any(marker in text for marker in _RATE_LIMIT_MARKERS):
        return RATE_LIMITED
    if any(marker in text for marker in _INVALID_KEY_MARKERS):
        return INVALID_KEY
    if any(marker in text for marker in _TIMEOUT_MARKERS):
        return TIMEOUT

    # Status codes are the fallback, not the primary signal.
    if status_code == 402:
        return INSUFFICIENT_CREDIT
    if status_code == 429:
        return RATE_LIMITED
    if status_code in (401, 403):
        return INVALID_KEY
    if status_code in (408, 504):
        return TIMEOUT

    return UNKNOWN


def describe_category(category: str) -> str:
    """A short, user-facing explanation for a category.

    Returned to the dashboard so a provider card can say what is actually
    wrong instead of "error".
    """
    return {
        INSUFFICIENT_CREDIT: 'No credit remaining on this provider account',
        INVALID_KEY: 'API key rejected — check or replace the key',
        RATE_LIMITED: 'Rate limited by the provider',
        TIMEOUT: 'Provider did not respond in time',
        UNKNOWN: 'Provider returned an unrecognised error',
    }.get(category, 'Provider returned an unrecognised error')


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def record_provider_failure(
    table: Any,
    provider_id: str,
    error: object,
    *,
    status_code: int | None = None,
    now: str | None = None,
) -> dict[str, Any]:
    """Record a provider failure, auto-disabling after repeated terminal errors.

    Increments ``consecutive_failures`` and stores the classified category so
    the dashboard can explain the problem. When the category is terminal
    (no credit, bad key) and the count reaches ``AUTO_DISABLE_THRESHOLD``, the
    provider is set ``enabled = false`` so runs stop paying retry cost on a
    provider that cannot answer until a human intervenes.

    Only *terminal* categories auto-disable. Rate limits and timeouts are
    transient — disabling on those would take a healthy provider offline for
    a temporary blip.

    Bookkeeping never masks the original failure: all DynamoDB errors are
    swallowed and logged, because the caller is already handling a provider
    error and a secondary write failure must not replace it.

    Returns:
        ``{'category': str, 'consecutive_failures': int, 'auto_disabled': bool}``.
        On a write failure the counts are best-effort and ``auto_disabled`` is
        False.
    """
    category = classify_provider_error(error, status_code)
    timestamp = now or get_timestamp()
    message = str(error)[:500]
    outcome = {'category': category, 'consecutive_failures': 0, 'auto_disabled': False}

    try:
        response = table.update_item(
            Key={'provider_id': provider_id},
            UpdateExpression=(
                'SET last_error = :err, last_error_at = :ts, '
                'last_error_category = :cat, updated_at = :ts '
                'ADD consecutive_failures :one'
            ),
            ExpressionAttributeValues={
                ':err': message,
                ':ts': timestamp,
                ':cat': category,
                ':one': 1,
            },
            ReturnValues='UPDATED_NEW',
        )
        failures = int(response.get('Attributes', {}).get('consecutive_failures', 0))
        outcome['consecutive_failures'] = failures
    except Exception as exc:
        logger.error(
            'provider_health_write_failed provider=%s category=%s error=%s',
            provider_id, category, type(exc).__name__,
        )
        return outcome

    if category in TERMINAL_CATEGORIES and failures >= AUTO_DISABLE_THRESHOLD:
        outcome['auto_disabled'] = _disable_provider(table, provider_id, category, timestamp)

    logger.warning(
        'provider_failure provider=%s category=%s consecutive=%d auto_disabled=%s',
        provider_id, category, outcome['consecutive_failures'], outcome['auto_disabled'],
    )
    return outcome


def _disable_provider(table: Any, provider_id: str, category: str, timestamp: str) -> bool:
    """Set ``enabled = false`` and record why. Returns True on success."""
    try:
        table.update_item(
            Key={'provider_id': provider_id},
            UpdateExpression=(
                'SET enabled = :off, disabled_reason = :cat, '
                'disabled_at = :ts, auto_disabled = :true'
            ),
            ExpressionAttributeValues={
                ':off': False,
                ':cat': category,
                ':ts': timestamp,
                ':true': True,
            },
        )
        logger.error(
            'provider_auto_disabled provider=%s category=%s after=%d consecutive failures',
            provider_id, category, AUTO_DISABLE_THRESHOLD,
        )
        return True
    except Exception as exc:
        logger.error(
            'provider_auto_disable_failed provider=%s error=%s',
            provider_id, type(exc).__name__,
        )
        return False


def record_provider_success(table: Any, provider_id: str, *, now: str | None = None) -> None:
    """Clear the failure streak after a provider answers successfully.

    Resetting matters: without it, three failures spread across weeks would
    eventually disable a provider that works nearly all the time. The threshold
    is meant to catch *consecutive* failures.

    Deliberately does NOT re-enable an auto-disabled provider. Re-enabling is
    the user's decision, made in Settings once they have fixed the underlying
    problem — flipping it back automatically would hide that anything happened.
    """
    try:
        table.update_item(
            Key={'provider_id': provider_id},
            UpdateExpression=(
                'SET last_success_at = :ts, consecutive_failures = :zero, '
                'last_error = :none, last_error_category = :none'
            ),
            ExpressionAttributeValues={
                ':ts': now or get_timestamp(),
                ':zero': 0,
                ':none': None,
            },
        )
    except Exception as exc:
        logger.warning(
            'provider_health_success_write_failed provider=%s error=%s',
            provider_id, type(exc).__name__,
        )


__all__ = [
    'AUTO_DISABLE_THRESHOLD',
    'INSUFFICIENT_CREDIT',
    'INVALID_KEY',
    'RATE_LIMITED',
    'TERMINAL_CATEGORIES',
    'TIMEOUT',
    'UNKNOWN',
    'classify_provider_error',
    'describe_category',
    'record_provider_failure',
    'record_provider_success',
]
