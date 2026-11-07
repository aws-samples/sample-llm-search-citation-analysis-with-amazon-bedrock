"""What a Domain Overview request researches, and the DataForSEO Labs ``filters`` that narrow it.

* **Target**: a domain or URL as typed (``example.com``, ``https://www.example.com/blog?x=1``) becomes a
  ``ResearchTarget``: the host lower-cased without ``www.``, the path with its trailing slashes, query and
  fragment dropped (casing and %-escapes kept), and a scope. Hosts outside ``[a-z0-9.-]``, without a dot,
  with a numeric or one-letter top-level label, IP addresses and URLs with credentials are refused before
  any paid call: DataForSEO bills a target like ``my_site.com`` and then fails it with "Invalid Field".
* **Scopes**: ``subdomains`` (the host and every subdomain, the default for a bare host), ``domain`` (the
  host only), ``subfolder`` (the path and everything under it, not ``/blogging`` for ``/blog``; the default
  when the input has a path) and ``exact_url`` (one page). A Labs domain target always covers every
  subdomain, so each narrower scope is a set of filter conditions:

  ======================  ==================================================  ===============================
  scope                   ranked_keywords                                     relevant_pages
  ======================  ==================================================  ===============================
  subdomains              none                                                none
  domain                  ``serp_item.domain in [h, www.h]`` (1)              ``page_address like`` for h and www.h (2)
  subfolder               host pin + ``relative_url = p | like p/% | p?%``    ``like %://h/p``, ``/p/%`` for h and www.h (4)
  exact_url               host pin + ``relative_url in [p, p/] | p?% | p/?%`` ``like %://h/p``, ``/p/`` for h and www.h (4)
  ======================  ==================================================  ===============================

  ``relevant_pages`` exposes only the absolute ``page_address``, and its ``regex`` operator refuses any
  pattern holding ``/``, so both the host and the path ride on ``like`` patterns.
* **Budget**: DataForSEO takes at most ``MAX_FILTER_CONDITIONS`` (8) leaf conditions per request, scope
  included. A request over budget raises ``FilterBudgetError`` rather than dropping conditions, so a
  result is never silently broader than the filters the user set.
* **Terms**: include/exclude terms split on ``,`` or ``+``, lower-cased, each one ``ilike`` / ``not_ilike``
  condition (ANDed), with ``\\ % _`` escaped. The free-text search is one OR group of keyword and URL
  (two conditions) on ranked keywords, one ``page_address`` condition on pages.
"""

from __future__ import annotations

import ipaddress
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

Scope = Literal['exact_url', 'subfolder', 'domain', 'subdomains']
SCOPES: tuple[Scope, ...] = ('exact_url', 'subfolder', 'domain', 'subdomains')

MAX_FILTER_CONDITIONS = 8

_HOST_CHARACTERS = re.compile(r'^[a-z\d.-]+$')
_TOP_LABEL = re.compile(r'^(?:[a-z]{2,63}|xn--[a-z\d-]{1,59})$')
_SCHEME = re.compile(r'^[a-zA-Z][a-zA-Z\d+.-]*://')
_TERM_SEPARATORS = re.compile(r'[,+]')
_LIKE_SPECIALS = re.compile(r'[\\%_]')

Clause = list[Any]

KEYWORD_FIELD = 'keyword_data.keyword'
URL_FIELD = 'ranked_serp_element.serp_item.url'
DOMAIN_FIELD = 'ranked_serp_element.serp_item.domain'
RELATIVE_URL_FIELD = 'ranked_serp_element.serp_item.relative_url'
PAGE_FIELD = 'page_address'


class InvalidTargetError(ValueError):
    """The typed domain or URL cannot be researched; ``str(error)`` is the message to show."""


class FilterBudgetError(ValueError):
    """The request needs more filter conditions than DataForSEO accepts."""

    def __init__(self, count: int) -> None:
        super().__init__(f'Too many filter conditions ({count} of {MAX_FILTER_CONDITIONS} max)')
        self.count = count


@dataclass(frozen=True)
class ResearchTarget:
    scope: Scope
    hostname: str
    """Lower-cased, ``www.`` stripped: the Labs ``target``."""
    path: str
    """``''`` for the root, else ``/like/This`` without trailing slashes, query or fragment."""

    @property
    def display(self) -> str:
        """The host, plus the path for the two path scopes."""
        return f'{self.hostname}{self.path}' if self.scope in ('exact_url', 'subfolder') else self.hostname


def _valid_host(hostname: str) -> bool:
    if not hostname or '.' not in hostname or not _HOST_CHARACTERS.match(hostname):
        return False
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        labels = hostname.split('.')
        return all(labels) and not any(label.startswith('-') or label.endswith('-') for label in labels) \
            and bool(_TOP_LABEL.match(labels[-1]))
    return False


def _normalized_path(path: str) -> str:
    return path.rstrip('/')


def parse_research_target(text: str, scope: Scope | None = None) -> ResearchTarget:
    """The ``ResearchTarget`` of a typed domain or URL; ``scope`` defaults from the input (see the module)."""
    trimmed = text.strip()
    if not trimmed:
        raise InvalidTargetError('Enter a domain or URL')
    try:
        parts = urlsplit(trimmed if _SCHEME.match(trimmed) else f'https://{trimmed}')
        raw_host = parts.hostname or ''
    except ValueError as error:
        raise InvalidTargetError('Enter a valid domain like example.com') from error
    if parts.username or parts.password:
        raise InvalidTargetError('URLs with embedded credentials are not supported')
    hostname = raw_host.lower().removeprefix('www.')
    if not _valid_host(hostname):
        raise InvalidTargetError('Enter a valid domain like example.com')
    path = _normalized_path(parts.path)
    if scope == 'subfolder' and not path:
        raise InvalidTargetError('Add a path to use Subfolder (e.g. example.com/blog)')
    return ResearchTarget(scope=scope or ('subfolder' if path else 'subdomains'), hostname=hostname, path=path)


# ---------------------------------------------------------------------------
# Expressions
# ---------------------------------------------------------------------------

def escape_like(term: str) -> str:
    """``term`` with the LIKE wildcards and the escape character escaped."""
    return _LIKE_SPECIALS.sub(lambda match: f'\\{match.group(0)}', term)


def parse_terms(value: str | None) -> list[str]:
    """Comma- or plus-separated terms, trimmed and lower-cased, empty ones dropped."""
    if not value:
        return []
    return [term for term in (part.strip() for part in _TERM_SEPARATORS.split(value.lower())) if term]


def join_clauses(clauses: Sequence[Any], operator: Literal['and', 'or']) -> list[Any]:
    """``[a, op, b, op, c]``: the DataForSEO form of several conditions under one operator."""
    joined: list[Any] = []
    for clause in clauses:
        if joined:
            joined.append(operator)
        joined.append(clause)
    return joined


def count_conditions(clauses: Sequence[Any]) -> int:
    """Leaf conditions in a clause list, through nested groups (the ``and``/``or`` strings do not count)."""
    count = 0
    for clause in clauses:
        if isinstance(clause, list):
            count += count_conditions(clause) if clause and isinstance(clause[0], list) else 1
    return count


def check_budget(count: int) -> None:
    """Raise ``FilterBudgetError`` when ``count`` conditions exceed DataForSEO's limit."""
    if count > MAX_FILTER_CONDITIONS:
        raise FilterBudgetError(count)


@dataclass(frozen=True)
class ScopeFilter:
    clauses: tuple[Any, ...]
    """ANDed in front of the user's filters; empty for ``subdomains``."""

    @property
    def condition_count(self) -> int:
        return count_conditions(list(self.clauses))


def _hosts(target: ResearchTarget) -> list[str]:
    return [target.hostname, f'www.{target.hostname}']


def ranked_keywords_scope(target: ResearchTarget) -> ScopeFilter:
    """The ``ranked_keywords`` conditions of ``target``'s scope."""
    if target.scope == 'subdomains':
        return ScopeFilter(())
    host_pin = [DOMAIN_FIELD, 'in', _hosts(target)]
    if target.scope == 'domain':
        return ScopeFilter((host_pin,))
    path = target.path or '/'
    escaped = escape_like(path)
    if target.scope == 'subfolder':
        alternatives: list[Clause] = [
            [RELATIVE_URL_FIELD, '=', path], [RELATIVE_URL_FIELD, 'like', f'{escaped}/%'],
            [RELATIVE_URL_FIELD, 'like', f'{escaped}?%'],
        ]
    else:
        alternatives = [
            [RELATIVE_URL_FIELD, 'in', [path, f'{path}/']], [RELATIVE_URL_FIELD, 'like', f'{escaped}?%'],
            [RELATIVE_URL_FIELD, 'like', f'{escaped}/?%'],
        ]
    return ScopeFilter((host_pin, join_clauses(alternatives, 'or')))


def relevant_pages_scope(target: ResearchTarget) -> ScopeFilter:
    """The ``relevant_pages`` conditions of ``target``'s scope."""
    if target.scope == 'subdomains':
        return ScopeFilter(())
    hosts = [escape_like(host) for host in _hosts(target)]
    path = escape_like(target.path or '/')
    if target.scope == 'domain':
        patterns = [f'%://{host}/%' for host in hosts]
    elif target.scope == 'subfolder':
        patterns = [pattern for host in hosts for pattern in (f'%://{host}{path}', f'%://{host}{path}/%')]
    else:
        patterns = [pattern for host in hosts for pattern in (f'%://{host}{path}', f'%://{host}{path}/')]
    return ScopeFilter((join_clauses([[PAGE_FIELD, 'like', pattern] for pattern in patterns], 'or'),))


def term_conditions(field: str, include: str | None, exclude: str | None) -> list[Clause]:
    """One ``ilike`` per include term and one ``not_ilike`` per exclude term."""
    return [
        *([field, 'ilike', f'%{escape_like(term)}%'] for term in parse_terms(include)),
        *([field, 'not_ilike', f'%{escape_like(term)}%'] for term in parse_terms(exclude)),
    ]


def range_conditions(field: str, minimum: float | None, maximum: float | None) -> list[Clause]:
    """``>=`` / ``<=`` conditions for the bounds that are set."""
    conditions: list[Clause] = []
    if minimum is not None:
        conditions.append([field, '>=', minimum])
    if maximum is not None:
        conditions.append([field, '<=', maximum])
    return conditions


def scoped_expression(scope: ScopeFilter, conditions: Sequence[Any]) -> list[Any]:
    """Scope clauses and ``conditions`` (an OR group counts each member) ANDed, after checking the budget."""
    check_budget(scope.condition_count + count_conditions(list(conditions)))
    return join_clauses([*scope.clauses, *conditions], 'and')


__all__ = [
    'KEYWORD_FIELD',
    'MAX_FILTER_CONDITIONS',
    'SCOPES',
    'URL_FIELD',
    'FilterBudgetError',
    'InvalidTargetError',
    'ResearchTarget',
    'Scope',
    'ScopeFilter',
    'check_budget',
    'count_conditions',
    'escape_like',
    'join_clauses',
    'parse_research_target',
    'parse_terms',
    'range_conditions',
    'ranked_keywords_scope',
    'relevant_pages_scope',
    'scoped_expression',
    'term_conditions',
]
