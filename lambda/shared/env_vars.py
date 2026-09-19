"""
Environment variable resolution with legacy-name migration support.

Historical context: the project accumulated three DynamoDB table env-var
naming conventions — bare names (``SEARCH_RESULTS_TABLE``), prefixed names
(``DYNAMODB_TABLE_SEARCH_RESULTS``), and a mix of suffixed variants
(``CITATIONS_TABLE_NAME``). Audit item 12 called this out as a deploy
footgun: renaming any handler's env-var requires a coordinated CDK deploy
or Python/CDK go out of sync and the Lambda can't cold-start.

This helper reads the canonical ``DYNAMODB_TABLE_*`` name first and falls
back to any legacy names passed in. That means:

- Python code can be deployed independently of CDK (new name first).
- CDK can set both old and new env vars during the transition so any
  Lambda version works with any stack version.
- Once every handler has migrated, the transitional mapping in CDK can
  be cleaned up and this helper's fallback path becomes dead code —
  at which point the legacy-name list can be removed from each caller.

Keep this module tiny and dependency-free so it can live in the shared
layer and import cheaply at cold-start.
"""

from __future__ import annotations

import os
from typing import Literal, overload


@overload
def resolve_table_env(canonical_name: str, *legacy_names: str,
                      required: Literal[True] = True) -> str: ...


@overload
def resolve_table_env(canonical_name: str, *legacy_names: str,
                      required: Literal[False], default: str) -> str: ...


@overload
def resolve_table_env(canonical_name: str, *legacy_names: str,
                      required: Literal[False], default: None = None) -> str | None: ...


def resolve_table_env(canonical_name: str, *legacy_names: str,
                      required: bool = True,
                      default: str | None = None) -> str | None:
    """Resolve a DynamoDB table name from env vars with legacy fallback.

    The overloads let the type checker see what callers already rely on:
    ``required=True`` (the default) either returns a name or raises, and
    ``required=False`` only yields ``None`` when no ``default`` is given.

    Args:
        canonical_name: The preferred env var name (must be
            ``DYNAMODB_TABLE_*``). Tried first.
        *legacy_names: Historical env var names to try as fallback, in
            priority order. Present here to unblock Python-side migration
            while CDK still sets the old names.
        required: If True, raise ``KeyError`` when none of the candidates
            resolve to a non-empty value. If False, return ``default``.
        default: Value returned when ``required=False`` and nothing resolves.

    Returns:
        The resolved table name, or ``default`` when ``required=False``.

    Raises:
        KeyError: When ``required=True`` and no env var resolves.
    """
    if not canonical_name.startswith('DYNAMODB_TABLE_'):
        # Fail fast on misuse — the whole point of this helper is to
        # enforce the prefix convention.
        raise ValueError(
            f"Canonical table env vars must use the DYNAMODB_TABLE_ prefix; "
            f"got {canonical_name!r}"
        )

    for name in (canonical_name, *legacy_names):
        value = os.environ.get(name)
        if value:
            return value

    if required:
        candidates = ", ".join([canonical_name, *legacy_names])
        raise KeyError(
            f"None of {{{candidates}}} are set in the Lambda environment. "
            "Check the CDK stack environment block."
        )
    return default
