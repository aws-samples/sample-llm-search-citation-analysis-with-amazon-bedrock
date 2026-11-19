"""
Re-extract stored answers (2.55.0): which stored AI answers a re-extract covers, and how many there are.

A re-extract runs the brand extraction again on stored answers, so answers stored under an older brand-name rule
(``brands_version`` absent or below ``shared.brand_names.BRANDS_VERSION``) get the current one. The filters name
the keywords (groups and/or keyword ids; none = every active keyword), the run days (``since`` / ``until``, UTC,
inclusive) and whether answers already at the current rule are skipped (``only_outdated``, default true).

An answer is a SearchResults row of an answer engine (``provider_type`` ``llm``) that answered (``status``
``success``) with text. The REST route (``api/manage-reextract.py``) counts them for the estimate; the worker
(``search/reextract_worker.py``) reads them page by page.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any, Final

from boto3.dynamodb.conditions import Attr, ConditionBase, Key

from shared.brand_names import BRANDS_VERSION
from shared.keyword_groups import MAX_SCOPE_IDS, query_active_keywords, select_scope, validate_id_list
from shared.markets import keyword_market_id
from shared.request_deadline import Deadline

_ISO_DAY: Final = re.compile(r'\d{4}-\d{2}-\d{2}')
#: Sorts after every character a run timestamp holds after its day (``T``, digits, ``:``, ``.``, ``Z``, ``#``).
_DAY_END: Final = '~'
#: The SearchResults attributes the estimate reads (the count needs only the rule version).
_COUNT_PROJECTION: Final = 'brands_version'


@dataclass(frozen=True)
class ReextractFilters:
    """What a re-extract covers (see the module docstring)."""

    group_ids: tuple[str, ...] = ()
    keyword_ids: tuple[str, ...] = ()
    since: str | None = None
    until: str | None = None
    only_outdated: bool = True

    def as_dict(self) -> dict[str, Any]:
        """The filters as the API echoes them and the job stores them."""
        return {
            'group_ids': list(self.group_ids), 'keyword_ids': list(self.keyword_ids),
            'since': self.since, 'until': self.until, 'only_outdated': self.only_outdated,
        }

    @property
    def every_keyword(self) -> bool:
        return not self.group_ids and not self.keyword_ids


class InvalidFiltersError(ValueError):
    """A filters object the API refuses: raised with ``(message, field)``; ``field`` names the offending field."""

    @property
    def field(self) -> str:
        return str(self.args[1])

    def __str__(self) -> str:
        return str(self.args[0])


def _day(body: Mapping[str, Any], name: str) -> str | None:
    value = body.get(name)
    if value is None or value == '':
        return None
    if not isinstance(value, str) or not _ISO_DAY.fullmatch(value):
        raise InvalidFiltersError(f'{name} must be a date YYYY-MM-DD', name)
    try:
        date.fromisoformat(value)
    except ValueError as error:
        raise InvalidFiltersError(f'{name} must be a date YYYY-MM-DD', name) from error
    return value


def _ids(body: Mapping[str, Any], name: str) -> tuple[str, ...]:
    ids, error = validate_id_list(body.get(name), field=name, limit=MAX_SCOPE_IDS)
    if error is not None or ids is None:
        raise InvalidFiltersError(error or f'{name} must be an array of strings', name)
    return tuple(ids)


def filters_from_body(body: Mapping[str, Any]) -> ReextractFilters:
    """The filters of a request body (or a stored job); raises ``InvalidFiltersError``."""
    since, until = _day(body, 'since'), _day(body, 'until')
    if since and until and since > until:
        raise InvalidFiltersError('since must not be after until', 'since')
    only_outdated = body.get('only_outdated', True)
    if not isinstance(only_outdated, bool):
        raise InvalidFiltersError('only_outdated must be true or false', 'only_outdated')
    return ReextractFilters(_ids(body, 'group_ids'), _ids(body, 'keyword_ids'), since, until, only_outdated)


@dataclass(frozen=True)
class ScopedKeyword:
    """A keyword the filters cover: its text (the SearchResults partition) and market."""

    keyword: str
    market_id: str

    @property
    def order(self) -> tuple[str, str]:
        """Where the keyword sorts: every pass walks the keywords in this order, so a cursor can name one."""
        return (self.keyword.casefold(), self.keyword)


def scoped_keywords(filters: ReextractFilters, active: list[dict[str, Any]]) -> list[ScopedKeyword]:
    """The active keywords ``filters`` cover (in a group named or named by id), one per text, in ``order``."""
    if filters.every_keyword:
        selected = select_scope({'mode': 'all'}, active)
    else:
        selected = []
        if filters.group_ids:
            selected += select_scope({'mode': 'groups', 'group_ids': list(filters.group_ids)}, active)
        if filters.keyword_ids:
            selected += select_scope({'mode': 'keywords', 'keyword_ids': list(filters.keyword_ids)}, active)
    by_text = {item['keyword']: ScopedKeyword(item['keyword'], keyword_market_id(item)) for item in selected}
    return sorted(by_text.values(), key=lambda scoped: scoped.order)


def load_scoped_keywords(filters: ReextractFilters, keywords_table: Any) -> list[ScopedKeyword]:
    """``scoped_keywords`` over every active keyword of ``keywords_table``."""
    return scoped_keywords(filters, query_active_keywords(keywords_table))


def run_key_condition(keyword: str, filters: ReextractFilters) -> ConditionBase:
    """The SearchResults key condition of ``keyword``'s rows on the filters' run days."""
    condition = Key('keyword').eq(keyword)
    sort_key = Key('timestamp_provider')
    if filters.since and filters.until:
        return condition & sort_key.between(filters.since, f'{filters.until}{_DAY_END}')
    if filters.since:
        return condition & sort_key.gte(filters.since)
    if filters.until:
        return condition & sort_key.lte(f'{filters.until}{_DAY_END}')
    return condition


def answered() -> ConditionBase:
    """Rows that are an answer engine's stored answer with text."""
    return (
        Attr('provider_type').eq('llm') & Attr('status').eq('success')
        & Attr('response').exists() & Attr('response').ne('')
    )


def outdated() -> ConditionBase:
    """Rows whose brands were stored under an older brand-name rule than ``BRANDS_VERSION``."""
    return Attr('brands_version').not_exists() | Attr('brands_version').lt(BRANDS_VERSION)


def answer_filter(filters: ReextractFilters) -> ConditionBase:
    """The rows a re-extract with ``filters`` covers among a keyword's rows."""
    return answered() & outdated() if filters.only_outdated else answered()


def is_current(row: Mapping[str, Any]) -> bool:
    """Whether ``row``'s brands are already at the current brand-name rule."""
    version = row.get('brands_version')
    return version is not None and int(version) >= BRANDS_VERSION


@dataclass
class AnswerCount:
    """What the estimate counted: answers to re-extract, answers skipped as current, keywords with an answer."""

    answers: int = 0
    answers_current: int = 0
    keywords: int = 0
    truncated: bool = False


def query_pages(table: Any, params: Mapping[str, Any], *, after: Mapping[str, Any] | None = None) -> Iterator[list[dict[str, Any]]]:
    """Every page a ``table.query(**params)`` answers, from the key ``after`` on (``params`` is not changed)."""
    request = dict(params)
    if after:
        request['ExclusiveStartKey'] = dict(after)
    while True:
        answer = table.query(**request)
        yield list(answer.get('Items') or [])
        if not answer.get('LastEvaluatedKey'):
            return
        request['ExclusiveStartKey'] = answer['LastEvaluatedKey']


class _CountCutError(Exception):
    """The deadline cut a count mid-keyword."""


def _count_keyword(table: Any, keyword: str, filters: ReextractFilters, deadline: Deadline | None) -> tuple[int, int]:
    params: dict[str, Any] = {
        'KeyConditionExpression': run_key_condition(keyword, filters),
        'FilterExpression': answered(),
        'ProjectionExpression': _COUNT_PROJECTION,
    }
    todo = current = 0
    for index, page in enumerate(query_pages(table, params)):
        if index and deadline is not None and deadline.stop_reading('the re-extract count'):
            raise _CountCutError
        for row in page:
            if filters.only_outdated and is_current(row):
                current += 1
            else:
                todo += 1
    return todo, current


def count_answers(
    search_table: Any, keywords: Iterable[ScopedKeyword], filters: ReextractFilters, deadline: Deadline | None,
) -> AnswerCount:
    """How many answers of ``keywords`` a re-extract with ``filters`` covers; ``truncated`` when ``deadline`` cut the count."""
    count = AnswerCount()
    for scoped in keywords:
        if deadline is not None and deadline.stop_reading('the re-extract count'):
            count.truncated = True
            return count
        try:
            todo, current = _count_keyword(search_table, scoped.keyword, filters, deadline)
        except _CountCutError:
            count.truncated = True
            return count
        count.answers += todo
        count.answers_current += current
        count.keywords += 1 if todo else 0
    return count
