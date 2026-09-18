"""
Report scope from query-string parameters.

Every read endpoint that reports on keywords accepts exactly one of::

    keyword=<text>            one keyword (the pre-2.4.0 contract, unchanged)
    group_id=<id>             every active keyword in one keyword group
    keyword_ids=<id,id,...>   a set of keywords by id (at most 100)
    scope=all                 every active keyword, as a group summary
    (nothing)                 the endpoint's own default: one-keyword endpoints
                              answer 400, all-keyword endpoints cover every
                              active keyword

The scope is resolved server-side into keyword *texts* (SearchResults and
Citations are keyed by keyword text) with ``shared.keyword_groups.resolve_scope``,
so the KPI formulas stay in one place instead of being re-implemented per
client. Group and id scopes only ever cover *active* keywords.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from shared.keyword_groups import describe_scope, resolve_scope, validate_scope

MAX_KEYWORD_IDS = 100
SCOPE_PARAMS = ('keyword', 'group_id', 'keyword_ids', 'scope')


@dataclass(frozen=True)
class ReportScope:
    """A resolved report scope: how it was asked for and which keywords it covers."""

    kind: str
    """``keyword`` | ``group`` | ``keywords`` | ``all``."""
    keywords: tuple[str, ...]
    """Keyword texts, sorted case-insensitively, deduplicated."""
    scope: dict[str, Any] = field(default_factory=lambda: {'mode': 'all'})
    """The canonical scope descriptor (same shape as trigger / schedule scopes)."""
    label: str = 'all active keywords'

    @property
    def is_single_keyword(self) -> bool:
        return self.kind == 'keyword'

    def describe(self) -> dict[str, Any]:
        """The ``scope`` block echoed in responses."""
        return {**self.scope, 'kind': self.kind, 'label': self.label, 'keyword_count': len(self.keywords)}


def _split_ids(raw: str) -> list[str]:
    return [part.strip() for part in raw.split(',') if part.strip()]


def parse_scope_params(params: dict[str, Any] | None, keywords_table: Any) -> tuple[ReportScope | None, str | None]:
    """Turn query-string parameters into a resolved ``ReportScope``.

    Returns ``(scope, None)``, ``(None, None)`` when no scope parameter is
    present (the caller applies its default), or ``(None, error)`` when the
    parameters are contradictory or malformed.
    """
    params = params or {}
    present = [name for name in SCOPE_PARAMS if str(params.get(name) or '').strip()]
    if not present:
        return None, None
    if len(present) > 1:
        return None, f"Use only one of {', '.join(SCOPE_PARAMS)}"

    name = present[0]
    value = str(params[name]).strip()

    if name == 'keyword':
        return ReportScope(kind='keyword', keywords=(value,), scope={'mode': 'keyword', 'keyword': value}, label=value), None

    if name == 'scope':
        if value != 'all':
            return None, "scope must be 'all' (use group_id or keyword_ids for a narrower scope)"
        return all_active_scope(keywords_table), None

    if name == 'group_id':
        descriptor, error = validate_scope({'mode': 'groups', 'group_ids': [value]})
        kind = 'group'
    else:
        ids = _split_ids(value)
        if len(ids) > MAX_KEYWORD_IDS:
            return None, f'keyword_ids accepts at most {MAX_KEYWORD_IDS} ids'
        descriptor, error = validate_scope({'mode': 'keywords', 'keyword_ids': ids})
        kind = 'keywords'
    if error:
        return None, error.replace('scope.', '')

    resolved = resolve_scope(descriptor, keywords_table)
    keywords = tuple(item['keyword'] for item in resolved)
    return ReportScope(kind=kind, keywords=keywords, scope=descriptor, label=describe_scope(descriptor)), None


def all_active_scope(keywords_table: Any) -> ReportScope:
    """The default for all-keyword endpoints: every active keyword."""
    descriptor = {'mode': 'all'}
    resolved = resolve_scope(descriptor, keywords_table)
    return ReportScope(kind='all', keywords=tuple(item['keyword'] for item in resolved), scope=descriptor, label=describe_scope(descriptor))
