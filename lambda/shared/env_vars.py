"""
Environment variable resolution for DynamoDB table names.

Historical context: the project accumulated three DynamoDB table env-var
naming conventions — bare names (``SEARCH_RESULTS_TABLE``), prefixed names
(``DYNAMODB_TABLE_SEARCH_RESULTS``), and a mix of suffixed variants
(``CITATIONS_TABLE_NAME``). Audit item 12 called this out as a deploy
footgun. Every handler and the CDK stack now use the canonical
``DYNAMODB_TABLE_*`` name only; this helper enforces that prefix so a new
reader cannot reintroduce another convention.

Keep this module tiny and dependency-free so it can live in the shared
layer and import cheaply at cold-start.
"""

from __future__ import annotations

import os
from typing import Literal, overload


@overload
def resolve_table_env(canonical_name: str, *,
                      required: Literal[True] = True) -> str: ...


@overload
def resolve_table_env(canonical_name: str, *,
                      required: Literal[False], default: str) -> str: ...


@overload
def resolve_table_env(canonical_name: str, *,
                      required: Literal[False], default: None = None) -> str | None: ...


def resolve_table_env(canonical_name: str, *,
                      required: bool = True,
                      default: str | None = None) -> str | None:
    """Resolve a DynamoDB table name from its ``DYNAMODB_TABLE_*`` env var.

    The overloads let the type checker see what callers already rely on:
    ``required=True`` (the default) either returns a name or raises, and
    ``required=False`` only yields ``None`` when no ``default`` is given.

    Args:
        canonical_name: The env var name (must be ``DYNAMODB_TABLE_*``).
        required: If True, raise ``KeyError`` when the variable is unset or
            empty. If False, return ``default``.
        default: Value returned when ``required=False`` and nothing resolves.

    Returns:
        The resolved table name, or ``default`` when ``required=False``.

    Raises:
        KeyError: When ``required=True`` and the variable does not resolve.
    """
    if not canonical_name.startswith('DYNAMODB_TABLE_'):
        # Fail fast on misuse — the whole point of this helper is to
        # enforce the prefix convention.
        raise ValueError(
            f"Canonical table env vars must use the DYNAMODB_TABLE_ prefix; "
            f"got {canonical_name!r}"
        )

    value = os.environ.get(canonical_name)
    if value:
        return value

    if required:
        raise KeyError(
            f"{canonical_name} is not set in the Lambda environment. "
            "Check the CDK stack environment block."
        )
    return default
