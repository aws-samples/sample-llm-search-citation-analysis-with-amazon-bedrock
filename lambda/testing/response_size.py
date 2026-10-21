"""Volume-test support: realistic large rows and response-size assertions.

Volume tests feed a handler a large, realistic data set through the usual
MagicMock tables and assert that the proxy response stays within its budget,
measured the way the Lambda runtime measures it (``envelope_bytes``). They
are what stops a route from silently growing back past the 6 MiB cap.

Text defaults to accented Spanish on purpose: ``json.dumps`` writes each
non-ASCII character as a 6-byte escape, which is the growth that ASCII-only
fixtures never show.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from shared.response_budget import PAGE_BUDGET_BYTES, SPILL_THRESHOLD_BYTES, envelope_bytes

# One sentence of answer-like text; 'ó', 'ñ', 'é', 'á' each serialize to 6 bytes.
_SPANISH_SENTENCE = 'La compañía aérea ofrece más opciones de conexión en la región según la opinión de expertos. '


def long_text(characters: int, *, accented: bool = True) -> str:
    """``characters`` characters of answer-like text (accented Spanish by default)."""
    unit = _SPANISH_SENTENCE if accented else 'The airline offers more connection options in the region. '
    repeats = characters // len(unit) + 1
    return (unit * repeats)[:characters]


def response_bytes(response: Mapping[str, Any]) -> int:
    """Size of a proxy response as the Lambda runtime posts it."""
    return envelope_bytes(dict(response))


def assert_within_page_budget(response: Mapping[str, Any], budget: int = PAGE_BUDGET_BYTES) -> None:
    """Fail unless the whole proxy response fits one page budget (default 1 MB).

    The envelope carries about 15% more than the body (second escaping), so a
    page cut at ``PAGE_BUDGET_BYTES`` of body is allowed that margin here.
    """
    size = response_bytes(response)
    allowed = budget + budget // 4
    assert size <= allowed, f'response is {size:,} bytes, over the {allowed:,}-byte page budget'


def assert_below_spill_threshold(response: Mapping[str, Any]) -> None:
    """Fail when the response would be spilled to S3 (or, without the guard, fail with a 502)."""
    size = response_bytes(response)
    assert size < SPILL_THRESHOLD_BYTES, f'response is {size:,} bytes, at or over the spill threshold'
