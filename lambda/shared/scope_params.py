"""
Report scope from query-string parameters — the plumbing every KPI endpoint shares.

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

A handler wires the scope in three places::

    KEYWORDS_TABLE = keywords_table_name()

    @api_handler
    @validate({**SCOPE_QUERY_PARAMS, 'days': {'type': int, 'default': 30}})
    def handler(event, context, days=30, **scope_params):
        report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE))
        if rejected:
            return rejected
        ...

``**scope_params`` collects exactly the values ``@validate`` injects for
``SCOPE_QUERY_PARAMS``; every other query parameter keeps its own named
argument. Scoped reports then fan out over the resolved keywords with
``query_keyword_rows`` (one projected SearchResults partition per keyword),
and the report aggregators compose KPI functions of sibling handler files
through ``load_sibling_function``.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

from shared.api_response import validation_error
from shared.constants import MAX_KEYWORD_LENGTH
from shared.dynamodb_batch import collect_all_items
from shared.env_vars import resolve_table_env
from shared.keyword_groups import describe_scope, resolve_scope, validate_scope
from shared.module_files import exec_module_file

logger = logging.getLogger(__name__)

MAX_KEYWORD_IDS = 100

#: The most keywords one scoped report covers, and how many of their
#: partitions it reads at a time: keeps a group report inside the 29s API budget.
SCOPE_KEYWORDS_CAP = 100
SCOPE_MAX_WORKERS = 10


SCOPE_QUERY_PARAMS: dict[str, dict[str, Any]] = {
    'keyword': {'type': str, 'max_length': MAX_KEYWORD_LENGTH},
    'group_id': {'type': str, 'max_length': 64},
    'keyword_ids': {'type': str, 'max_length': 8000},
    'scope': {'type': str, 'choices': ['all']},
}
"""``@validate`` rules for the scope parameters; handlers spread them into their own schema."""

SCOPE_PARAMS = tuple(SCOPE_QUERY_PARAMS)


def keywords_table_name() -> str:
    """The Keywords table scopes resolve against: the canonical env name, then the stack default."""
    return resolve_table_env('DYNAMODB_TABLE_KEYWORDS', required=False, default='CitationAnalysis-Keywords')


@dataclass(frozen=True)
class ReportScope:
    """A resolved report scope: how it was asked for and which keywords it covers.

    Every field is required on purpose: a default such as ``{'mode': 'all'}``
    would let a caller silently widen a report to every keyword.
    """

    kind: str
    """``keyword`` | ``group`` | ``keywords`` | ``all``."""
    keywords: tuple[str, ...]
    """Keyword texts, sorted case-insensitively, deduplicated."""
    scope: dict[str, Any]
    """The canonical scope descriptor (same shape as trigger / schedule scopes)."""
    label: str

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
    if descriptor is None:
        # validate_scope returns exactly one of (descriptor, None) / (None, error).
        return None, str(error).replace('scope.', '')

    resolved = resolve_scope(descriptor, keywords_table)
    keywords = tuple(item['keyword'] for item in resolved)
    return ReportScope(kind=kind, keywords=keywords, scope=descriptor, label=describe_scope(descriptor)), None


def all_active_scope(keywords_table: Any) -> ReportScope:
    """The default for all-keyword endpoints: every active keyword."""
    descriptor = {'mode': 'all'}
    resolved = resolve_scope(descriptor, keywords_table)
    return ReportScope(kind='all', keywords=tuple(item['keyword'] for item in resolved), scope=descriptor, label=describe_scope(descriptor))


def scope_from_request(
    event: dict[str, Any], params: dict[str, Any] | None, keywords_table: Any, *, required: bool = False
) -> tuple[ReportScope | None, dict[str, Any] | None]:
    """``parse_scope_params`` for a handler: the scope, or the 400 response to send instead.

    ``required`` rejects a missing scope as well (one-keyword endpoints);
    otherwise ``(None, None)`` means "no scope given, apply the endpoint's default".
    """
    scope, error = parse_scope_params(params, keywords_table)
    if error:
        return None, validation_error(error, event, 'scope')
    if required and scope is None:
        return None, validation_error('Provide keyword, group_id or keyword_ids', event, 'keyword')
    return scope, None


def scope_keywords_from_request(
    event: dict[str, Any], params: dict[str, Any] | None, keywords_table: Any
) -> tuple[list[str] | None, dict[str, Any] | None]:
    """``scope_from_request`` for handlers that only need the keyword texts.

    ``(None, None)`` without a scope (the handler applies its default),
    ``(keywords, None)`` for a scope with active keywords, and ``(None, 400)``
    for a malformed scope or one that resolves to no active keyword (an unknown
    group, or one whose members are all paused), refused on the ``scope`` field
    the way ``trigger-keyword-analysis`` refuses a run of that scope, rather
    than handed on as an empty list that a loader would read as "all keywords".
    """
    report_scope, rejected = scope_from_request(event, params, keywords_table)
    if rejected or report_scope is None:
        return None, rejected
    if not report_scope.keywords:
        return None, validation_error(f'No active keywords match the selected scope ({report_scope.label}).', event, 'scope')
    return list(report_scope.keywords), None


def scoped_dynamodb_resource() -> Any:
    """A DynamoDB resource with enough pooled connections for ``map_scope_keywords``' threads."""
    return boto3.resource('dynamodb', config=Config(max_pool_connections=50))


def map_scope_keywords[ResultT](
    keywords: Sequence[str],
    compute: Callable[[str], ResultT],
    fallback: Callable[[str], ResultT],
) -> list[ResultT]:
    """``compute(keyword)`` for every keyword, ``SCOPE_MAX_WORKERS`` at a time, in ``keywords`` order.

    A keyword whose ``compute`` raises is logged and answered with
    ``fallback(keyword)``: one broken partition must not sink a group report.
    """
    def guarded(keyword: str) -> ResultT:
        try:
            return compute(keyword)
        except Exception:
            logger.exception('Scoped report failed for %r', keyword)
            return fallback(keyword)

    if not keywords:
        return []
    with ThreadPoolExecutor(max_workers=min(SCOPE_MAX_WORKERS, len(keywords))) as pool:
        return list(pool.map(guarded, keywords))


def query_keyword_rows(table: Any, keyword: str, projection: str) -> list[dict[str, Any]]:
    """Every SearchResults row of one keyword (projected), following pagination.

    The per-keyword read behind every scoped report: each keyword text a scope
    resolves to is one partition of the table. ``projection`` names the
    attributes to read, with ``#ts`` standing for the reserved word
    ``timestamp``; it never includes the LLM response text, so a 60-keyword
    group does not pull megabytes of prose through one 29s API request.
    """
    return collect_all_items(
        table.query,
        KeyConditionExpression=Key('keyword').eq(keyword),
        ProjectionExpression=projection,
        ExpressionAttributeNames={'#ts': 'timestamp'},
    )


def load_sibling_function(anchor_file: str, filename: str, attr: str, alias_suffix: str) -> Callable:
    """Import function ``attr`` from the hyphen-named handler file ``filename`` next to ``anchor_file``.

    The report aggregators (``/reports/overview``, ``/reports/competitor``)
    compose KPI functions that live in other handler files, which ``import``
    cannot reach. The module is registered in ``sys.modules`` as
    ``<snake_name><alias_suffix>`` so it never collides with the copy a router
    Lambda loads through ``shared.router.HandlerLoader``. Raises ``ImportError``
    when the file cannot be loaded and ``AttributeError`` when it has no ``attr``.
    """
    module = exec_module_file(
        filename.replace('-', '_').replace('.py', alias_suffix),
        os.path.join(os.path.dirname(os.path.abspath(anchor_file)), filename),
    )
    if module is None:
        raise ImportError(f"Could not load sibling module {filename!r}")
    fn = getattr(module, attr, None)
    if fn is None:
        raise AttributeError(f"{filename} has no attribute {attr!r}")
    return fn
