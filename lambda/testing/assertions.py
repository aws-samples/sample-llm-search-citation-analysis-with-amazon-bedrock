"""Assertion helpers that narrow types for the checker as well as for the reader."""

from __future__ import annotations


def present[T](value: T | None) -> T:
    """Assert ``value`` is not ``None`` and hand it back narrowed.

    For results typed ``X | None`` such as the research-agent parsers:
    ``present(parse_plan(text, config))['queries']`` fails with a clear
    assertion instead of a ``TypeError`` when the parser gives up, and the
    type checker sees ``X`` from there on.
    """
    assert value is not None
    return value
