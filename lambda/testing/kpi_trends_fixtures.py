"""Support for the trend preset tests (``shared.artifact_trends``): KeywordLatest objects and the live trend oracle."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, cast

from shared.answer_queries import history_since
from shared.artifact_trends import TRENDS_BUILDER, trend_body, trends_artifacts
from shared.keyword_run_kpis import tally_item
from shared.kpi_engine import answers_from_rows
from shared.kpi_tally import RunTally, run_tallies
from shared.partial_contract import KeywordLatest
from shared.snapshot_artifacts import SnapshotScope, decode_snapshot_cursor
from testing.kpi_row_strategies import KEYWORDS
from testing.snapshot_fakes import FakeSnapshotArtifacts

#: The build of the window tests: four days after the strategies' newest run, so 7, 30 and 90 days hold different runs.
BUILT = datetime(2026, 10, 5, 7, 0, tzinfo=UTC)
#: The keywords of the strategies (``testing.kpi_row_strategies``) in scope order.
SCOPE = sorted(KEYWORDS, key=str.casefold)

SCOPE_ALL = SnapshotScope(scope_dir='all', kind='all', group_id=None, market_id=None, keywords_total=0)


def answer_row(keyword: str, index: int, timestamp: str = '2026-10-01T06:00:00.000000Z') -> dict[str, Any]:
    """One openai answer to ``keyword`` naming the first party at a rank that varies with ``index``."""
    return {
        'keyword': keyword, 'timestamp': timestamp, 'provider': 'openai', 'status': 'success',
        'query_prompt_id': 'default', 'timestamp_provider': f'{timestamp}#openai#default',
        'brands': [{'name': 'Hotel Sol', 'classification': 'first_party', 'rank': 1 + index % 5}], 'citations': [],
    }


def keyword_tallies(keywords: Sequence[str], rows: Iterable[Mapping[str, Any]], owned: Sequence[str]) -> dict[str, list[RunTally]]:
    """Each keyword's run tallies of ``rows`` (every brand), oldest first: the oracle's input."""
    answers = answers_from_rows(list(rows))
    return {keyword: run_tallies(keyword, [answer for answer in answers if answer.keyword == keyword], owned) for keyword in keywords}


def entry(tally: RunTally, *, brands: bool = True) -> dict[str, Any]:
    """``tally`` as a KeywordLatest block stores it (the KeywordRunKpis row without the keyword)."""
    stored = {key: value for key, value in tally_item(tally, built_at='').items() if key not in ('keyword', 'built_at')}
    if not brands:
        stored.pop('brands', None)
    return stored


def trend_doc(keyword: str, tallies: Sequence[RunTally], owned: Sequence[str], *, block: str = 'history') -> KeywordLatest:
    """A KeywordLatest object whose ``block`` holds every run of ``tallies``: ``history`` (with brands), ``tallies`` or ``recent`` (base only)."""
    newest = tallies[-1].timestamp if tallies else None
    part = {'kpi': {'owned_domains': list(owned)}}
    doc: dict[str, Any] = {
        'v': 1, 'keyword': keyword, 'keyword_id': '', 'config': '',
        'latest': {'timestamp': newest, 'parts': part} if newest else {'timestamp': '', 'parts': part},
        'previous': None,
    }
    if block == 'recent':
        doc['recent'] = [{**entry(tally, brands=False), 'run_timestamp': tally.timestamp} for tally in tallies]
    elif block == 'tallies':
        doc['tallies'] = {tally.timestamp: entry(tally) for tally in tallies}
    else:
        doc['history'] = [entry(tally) for tally in tallies]
    return cast('KeywordLatest', doc)


def trend_artifacts(docs: Iterable[KeywordLatest], keywords_total: int, now: datetime) -> FakeSnapshotArtifacts:
    """The ``trends`` artifacts of ``docs`` built at ``now``, as a stored build."""
    acc = None
    for doc in docs:
        acc = TRENDS_BUILDER.fold(acc, doc, SCOPE_ALL)
    return FakeSnapshotArtifacts(trends_artifacts(acc, now), keywords_total=keywords_total)


def oracle_trend(keywords: Sequence[str], tallies: Mapping[str, Sequence[RunTally]], owned: Sequence[str], period: str, days: int, now: datetime) -> dict[str, Any]:
    """The live trend fields over every run from ``days`` before ``now`` (``/trends`` with the keyword cap removed)."""
    since = history_since(days, now)
    window = {keyword: [tally for tally in tallies.get(keyword, ()) if tally.timestamp >= since] for keyword in keywords}
    return trend_body(list(keywords), window, period, days, since, list(owned))


def offset_pages(serve_page: Callable[[int], Mapping[str, Any] | None], list_key: str) -> list[Any]:
    """Every row of a snapshot list read page by page: ``serve_page(offset)`` from 0, following each page's ``next_token``."""
    rows: list[Any] = []
    offset: int | None = 0
    while offset is not None:
        page = serve_page(offset)
        if page is None:
            msg = 'a page the build should hold is missing'
            raise AssertionError(msg)
        rows.extend(page[list_key])
        cursor = decode_snapshot_cursor(page['next_token']) if page['next_token'] else None
        offset = cursor.offset if cursor else None
    return rows
