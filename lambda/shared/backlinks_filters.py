"""Filters, spam rule and sort of the three backlinks tables, in DataForSEO's ``filters`` / ``order_by`` syntax.

A DataForSEO filter expression is a list of conditions ``[field, operator, value]`` joined by ``"and"`` /
``"or"``, where a nested list is a group. The tables send, ANDed in this order:

1. the subfolder scope group (4 conditions): the API has no prefix targeting, so a subfolder is
   ``url_to`` (backlinks) or ``url`` (top pages) ``like`` ``%://host/path`` or ``%://host/path/%``, for the host
   with and without ``www.``;
2. the user's filters: include terms (``,`` or ``+`` separated) as one ``ilike %term%`` OR group, exclude terms as
   ``not_ilike`` conditions, numeric ranges as ``>=`` / ``<=``, and the flags;
3. the spam rule (2 conditions), on unless "Include likely spam" is chosen: a spam score below 40, or no score at
   all (an unknown score is not evidence of spam). The same rule applies to backlinks (``backlink_spam_score``) and
   to referring domains (``backlinks_spam_score``, never the target's own score); top pages carry no spam score.

DataForSEO accepts at most 8 conditions per request. The count is checked here, before the paid call, and an
expression over the budget is refused with the count rather than truncated, which would silently answer a
different question. The dashboard counts the same way and does not send such a request.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from shared.backlinks_target import BacklinksTarget
from shared.dataforseo_domain_scope import escape_like, join_clauses, parse_terms
from shared.string_lists import bounded_text

Tab = Literal['backlinks', 'referring_domains', 'top_pages']
TABS: tuple[Tab, ...] = ('backlinks', 'referring_domains', 'top_pages')

MAX_FILTER_CONDITIONS = 8
SUBFOLDER_FILTER_CONDITIONS = 4
SPAM_FILTER_CONDITIONS = 2
SPAM_THRESHOLD = 40
"""A spam score at or above this hides the row unless likely spam is included."""

_MAX_TERM_TEXT = 500


class FilterError(ValueError):
    """The filters are malformed or exceed the condition budget; the message is fit to show the user."""


@dataclass(frozen=True)
class _Field:
    key: str
    kind: Literal['include', 'exclude', 'min', 'max', 'flag', 'equals', 'link_type']
    api_field: str


def _ranges(key: str, api_field: str) -> tuple[_Field, _Field]:
    return _Field(f'min_{key}', 'min', api_field), _Field(f'max_{key}', 'max', api_field)


TAB_FIELDS: dict[Tab, tuple[_Field, ...]] = {
    'backlinks': (
        _Field('include', 'include', 'url_from'),
        _Field('exclude', 'exclude', 'url_from'),
        *_ranges('domain_rank', 'domain_from_rank'),
        *_ranges('link_rank', 'rank'),
        *_ranges('spam_score', 'backlink_spam_score'),
        _Field('link_type', 'link_type', 'dofollow'),
        _Field('hide_lost', 'flag', 'is_lost'),
        _Field('hide_broken', 'flag', 'is_broken'),
        _Field('domain_from', 'equals', 'domain_from'),
    ),
    'referring_domains': (
        _Field('include', 'include', 'domain'),
        _Field('exclude', 'exclude', 'domain'),
        *_ranges('backlinks', 'backlinks'),
        *_ranges('rank', 'rank'),
        *_ranges('spam_score', 'backlinks_spam_score'),
    ),
    'top_pages': (
        _Field('include', 'include', 'url'),
        _Field('exclude', 'exclude', 'url'),
        *_ranges('backlinks', 'backlinks'),
        *_ranges('referring_domains', 'referring_domains'),
        *_ranges('rank', 'rank'),
    ),
}

SPAM_FIELDS: dict[Tab, str | None] = {
    'backlinks': 'backlink_spam_score',
    'referring_domains': 'backlinks_spam_score',
    'top_pages': None,
}

SORT_FIELDS: dict[Tab, dict[str, str]] = {
    'backlinks': {
        'rank': 'rank', 'domain_from_rank': 'domain_from_rank', 'spam_score': 'backlink_spam_score',
        'first_seen': 'first_seen',
    },
    'referring_domains': {
        'domain': 'domain', 'backlinks': 'backlinks', 'referring_pages': 'referring_pages', 'rank': 'rank',
        'spam_score': 'backlinks_spam_score', 'first_seen': 'first_seen', 'broken_backlinks': 'broken_backlinks',
    },
    'top_pages': {
        'backlinks': 'backlinks', 'referring_domains': 'referring_domains', 'rank': 'rank',
        'broken_backlinks': 'broken_backlinks',
    },
}

DEFAULT_SORT: dict[Tab, str] = {'backlinks': 'first_seen', 'referring_domains': 'backlinks', 'top_pages': 'backlinks'}
"""Newest links first; the strongest referring domains and pages first."""
LINK_TYPES = ('all', 'dofollow', 'nofollow')

# ---------------------------------------------------------------------------
# Parsing the request's filters
# ---------------------------------------------------------------------------


def _number(key: str, value: object) -> float | None:
    """A number or numeric string; ``""`` / ``None`` is unset; anything else (or not finite) is refused."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise FilterError(f'{key} must be a number')
    try:
        number = float(value) if isinstance(value, int | float | str) else math.nan
    except ValueError as exc:
        raise FilterError(f'{key} must be a number') from exc
    if not math.isfinite(number):
        raise FilterError(f'{key} must be a number')
    return int(number) if number.is_integer() else number


def _text(key: str, value: object) -> str | None:
    error = FilterError(f'{key} must be text of at most {_MAX_TERM_TEXT} characters')
    text = bounded_text(value, _MAX_TERM_TEXT, error)
    return text.lower() if text else None


def _flag(key: str, value: object) -> bool | None:
    if value is None or value is False:
        return None
    if value is not True:
        raise FilterError(f'{key} must be true or false')
    return True


def _link_type(value: object) -> str | None:
    if value is None or value == 'all':
        return None
    if value not in LINK_TYPES:
        raise FilterError(f'link_type must be one of {", ".join(LINK_TYPES)}')
    return str(value)


def _parsed_value(spec: _Field, value: object) -> Any:
    if spec.kind in ('min', 'max'):
        return _number(spec.key, value)
    if spec.kind == 'flag':
        return _flag(spec.key, value)
    if spec.kind == 'link_type':
        return _link_type(value)
    return _text(spec.key, value)


def parse_filters(tab: Tab, raw: object) -> dict[str, Any]:
    """The request's ``filters`` object for ``tab``, normalized with unset fields dropped (cache-key stable)."""
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise FilterError('filters must be an object')
    specs = {spec.key: spec for spec in TAB_FIELDS[tab]}
    unknown = sorted(str(key) for key in raw if key not in specs)
    if unknown:
        raise FilterError(f'Unknown filter for this table: {unknown[0]}')
    parsed = {key: _parsed_value(specs[key], value) for key, value in raw.items()}
    return {key: value for key, value in parsed.items() if value is not None}


# ---------------------------------------------------------------------------
# Building the expression
# ---------------------------------------------------------------------------


def _include_group(api_field: str, text: str | None) -> list[Any] | None:
    conditions = [[api_field, 'ilike', f'%{escape_like(term)}%'] for term in parse_terms(text)]
    if not conditions:
        return None
    return conditions[0] if len(conditions) == 1 else join_clauses(conditions, 'or')


def _field_clauses(spec: _Field, value: Any) -> list[list[Any]]:
    if spec.kind == 'exclude':
        return [[spec.api_field, 'not_ilike', f'%{escape_like(term)}%'] for term in parse_terms(value)]
    if spec.kind == 'min':
        return [[spec.api_field, '>=', value]]
    if spec.kind == 'max':
        return [[spec.api_field, '<=', value]]
    if spec.kind == 'flag':
        return [[spec.api_field, '=', False]]
    if spec.kind == 'link_type':
        return [[spec.api_field, '=', value == 'dofollow']]
    return [[spec.api_field, '=', value]]


def user_clauses(tab: Tab, filters: Mapping[str, Any]) -> tuple[list[Any], int]:
    """``(clauses, conditions)`` of the parsed user filters: the include group first, then the rest in field order."""
    clauses: list[Any] = []
    conditions = 0
    for spec in TAB_FIELDS[tab]:
        value = filters.get(spec.key)
        if value is None:
            continue
        if spec.kind == 'include':
            group = _include_group(spec.api_field, value)
            if group is not None:
                clauses.insert(0, group)
                conditions += len(parse_terms(value))
            continue
        added = _field_clauses(spec, value)
        clauses.extend(added)
        conditions += len(added)
    return clauses, conditions


def subfolder_group(api_field: str, target: BacklinksTarget) -> list[Any]:
    """The 4-condition OR group matching ``target``'s subfolder and everything under it (with and without www.)."""
    path = escape_like(target.path)
    hosts = [escape_like(target.hostname), escape_like(f'www.{target.hostname}')]
    conditions = [
        condition
        for host in hosts
        for condition in ([api_field, 'like', f'%://{host}{path}'], [api_field, 'like', f'%://{host}{path}/%'])
    ]
    return join_clauses(conditions, 'or')


def spam_group(api_field: str) -> list[Any]:
    """Below the spam threshold, or no score at all."""
    return [[api_field, '<', SPAM_THRESHOLD], 'or', [api_field, '=', None]]


SCOPE_URL_FIELDS: dict[Tab, str | None] = {'backlinks': 'url_to', 'referring_domains': None, 'top_pages': 'url'}
"""The absolute-URL field a subfolder is matched on; referring domains have none (no subfolder breakdown)."""


@dataclass(frozen=True)
class BuiltFilters:
    expression: list[Any] | None
    """``None`` when nothing is filtered (the request then carries no ``filters``)."""
    conditions: int


def condition_limit(tab: Tab, target: BacklinksTarget, *, hide_spam: bool) -> int:
    """How many conditions the user's own filters may use: 8 minus the scope's and the spam rule's."""
    used = SUBFOLDER_FILTER_CONDITIONS if target.scope == 'subfolder' and SCOPE_URL_FIELDS[tab] else 0
    if hide_spam and SPAM_FIELDS[tab]:
        used += SPAM_FILTER_CONDITIONS
    return MAX_FILTER_CONDITIONS - used


def build_filters(tab: Tab, filters: Mapping[str, Any], target: BacklinksTarget, *, hide_spam: bool) -> BuiltFilters:
    """The full ``filters`` expression of one table request; raises ``FilterError`` over the 8-condition budget."""
    clauses: list[Any] = []
    conditions = 0
    scope_field = SCOPE_URL_FIELDS[tab]
    if target.scope == 'subfolder' and scope_field:
        clauses.append(subfolder_group(scope_field, target))
        conditions += SUBFOLDER_FILTER_CONDITIONS
    own, own_conditions = user_clauses(tab, filters)
    clauses.extend(own)
    conditions += own_conditions
    spam_field = SPAM_FIELDS[tab]
    if hide_spam and spam_field:
        clauses.append(spam_group(spam_field))
        conditions += SPAM_FILTER_CONDITIONS
    if conditions > MAX_FILTER_CONDITIONS:
        raise FilterError(f'Too many filter conditions ({conditions} of {MAX_FILTER_CONDITIONS} max).')
    return BuiltFilters(expression=join_clauses(clauses, 'and') if clauses else None, conditions=conditions)


def order_by(tab: Tab, sort_field: str | None, sort_order: str) -> list[str]:
    """``["<api field>,<asc|desc>"]``; an unknown sort field is refused."""
    field = sort_field or DEFAULT_SORT[tab]
    api_field = SORT_FIELDS[tab].get(field)
    if api_field is None:
        raise FilterError(f'sort_field must be one of {", ".join(SORT_FIELDS[tab])}')
    return [f'{api_field},{sort_order}']
