"""
Classification of one audit fetch: ``ok``, ``blocked``, ``rate_limited`` or ``error``.

The order matters:

1. no response (status 0) is an ``error``;
2. 429 is ``rate_limited`` *before* any challenge check: a CDN rate-limit rule sets the same
   ``cf-mitigated`` header as a bot challenge, and a temporary limit must not be reported as a block;
3. a ``cf-mitigated`` header, 401 / 403, and 202 (WAF challenge pages answer 202) are ``blocked``;
4. a 2xx page whose title or body is a bot challenge, or a 503 carrying challenge markers, is ``blocked``
   (challenges are reported as blocks, never as missing content);
5. anything else is ``ok`` (a 404 or 500 is a real answer of the site).

Only the first 4,000 characters of the body are inspected.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

FetchClass = Literal['ok', 'blocked', 'rate_limited', 'error']

SNIPPET_CHARS = 4_000
SUCCESS_CHALLENGE_MARKERS = (
    '<title>just a moment...</title>',
    'attention required! | cloudflare',
    '/.well-known/sgcaptcha/',
)
UNAVAILABLE_CHALLENGE_MARKERS = (
    'just a moment...',
    'challenge-platform',
    'cf-browser-verification',
    'attention required! | cloudflare',
    'verifying you are human',
)


def classify_fetch(status: int, headers: Mapping[str, str], body_snippet: str) -> FetchClass:
    """The fetch class of a response (``headers`` keys lower-cased)."""
    if status == 0:
        return 'error'
    if status == 429:
        return 'rate_limited'
    if 'cf-mitigated' in headers or status in (401, 403, 202):
        return 'blocked'
    snippet = body_snippet[:SNIPPET_CHARS].lower()
    if 200 <= status < 300 and any(marker in snippet for marker in SUCCESS_CHALLENGE_MARKERS):
        return 'blocked'
    if status == 503 and any(marker in snippet for marker in UNAVAILABLE_CHALLENGE_MARKERS):
        return 'blocked'
    return 'ok'
