"""Request-derived values made safe for a log line (CWE-117, log injection).

A CloudWatch log record is one line. A value taken from a request (a path
parameter, a body field, a claim) that carries a line break would end the
record early and start a forged one. ``log_text`` escapes the breaks and
bounds the length, so a value can be logged as itself; CodeQL recognises the
``replace`` of a line break as the sanitizer of its log-injection query.
"""

from __future__ import annotations

LOG_TEXT_LIMIT = 200


def log_text(value: object, limit: int = LOG_TEXT_LIMIT) -> str:
    """``value`` as one line of at most ``limit`` characters: line breaks escaped, the rest cut with an ellipsis."""
    text = str(value).replace('\r\n', '\\n').replace('\n', '\\n').replace('\r', '\\r')
    return text if len(text) <= limit else f'{text[:limit]}…'


__all__ = ['LOG_TEXT_LIMIT', 'log_text']
