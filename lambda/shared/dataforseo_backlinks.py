"""DataForSEO Backlinks API calls: summary, link rows, referring domains, top pages and history.

Every call is a billed live ``POST`` of a one-element array, sent with ``idempotent=False``: an HTTP 5xx does not
prove DataForSEO skipped the charge, so a failed call is never re-sent.

The common task asks for live links only, counts indirect (redirect / canonical) links, leaves out the target's
internal links, and puts every rank on DataForSEO's 0-100 scale::

    {target, include_subdomains, include_indirect_links: true, exclude_internal_backlinks: true,
     backlinks_status_type: 'live', rank_scale: 'one_hundred'}

``history/live`` takes only ``{target, date_from, date_to, rank_scale}``: it has no ``include_subdomains`` (so a
domain-scope history includes subdomains) and accepts only a hostname (so an exact page has no history). One
call covers the window from a year before yesterday to yesterday (UTC); DataForSEO answers one item per month.

A subfolder has no summary of its own: its totals are the ``total_count`` of two one-row link requests on the
subfolder's URLs, every link (``as_is``) for the backlinks and one link per domain (``one_per_domain``) for the
referring domains. They run one after the other, so a balance failure on the first spends nothing on the second,
and they count likely spam too, as the summary of a whole domain does.

Prices (DataForSEO's Backlinks price list): $0.024 per request plus $0.000036 per row asked for; a history call is billed
one row per day of its window, about $0.037.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal

from shared import dataforseo_client
from shared.backlink_rows import (
    backlink_row,
    history_rows,
    number,
    referring_domain_row,
    summary_row,
    top_page_row,
)
from shared.backlinks_filters import Tab, build_filters
from shared.backlinks_target import BacklinksTarget

SUMMARY_PATH = '/v3/backlinks/summary/live'
HISTORY_PATH = '/v3/backlinks/history/live'
TABLE_PATHS: dict[Tab, str] = {
    'backlinks': '/v3/backlinks/backlinks/live',
    'referring_domains': '/v3/backlinks/referring_domains/live',
    'top_pages': '/v3/backlinks/domain_pages_summary/live',
}

BACKLINKS_TASK_USD = 0.024
BACKLINKS_ROW_USD = 0.000036
HISTORY_DAYS = 366
"""``date_from`` is a year before ``date_to``; both days count."""

Mode = Literal['one_per_domain', 'as_is']
MODES: tuple[Mode, ...] = ('one_per_domain', 'as_is')

_ROW_MAPPERS = {
    'backlinks': backlink_row,
    'referring_domains': referring_domain_row,
    'top_pages': top_page_row,
}


def backlinks_usd(rows: int) -> float:
    """The price of one request asking for ``rows`` rows."""
    return round(BACKLINKS_TASK_USD + rows * BACKLINKS_ROW_USD, 6)


SUMMARY_USD = backlinks_usd(1)
HISTORY_USD = backlinks_usd(HISTORY_DAYS)


def history_window(today: date) -> tuple[str, str]:
    """``(date_from, date_to)`` as ``YYYY-MM-DD``: yesterday and the same day a year earlier."""
    date_to = today - timedelta(days=1)
    try:
        date_from = date_to.replace(year=date_to.year - 1)
    except ValueError:
        date_from = date_to.replace(year=date_to.year - 1, day=28)
    return date_from.isoformat(), date_to.isoformat()


def common_task(target: BacklinksTarget) -> dict[str, Any]:
    return {
        'target': target.api_target,
        'include_subdomains': target.include_subdomains,
        'include_indirect_links': True,
        'exclude_internal_backlinks': True,
        'backlinks_status_type': 'live',
        'rank_scale': 'one_hundred',
    }


def _post(path: str, task: dict[str, Any]) -> dataforseo_client.TaskResult:
    return dataforseo_client.post_live(path, task, idempotent=False)


def _first_result(result: list[Any]) -> Mapping[str, Any] | None:
    first = result[0] if result else None
    return first if isinstance(first, Mapping) else None


def _items(first: Mapping[str, Any] | None) -> list[Any]:
    items = first.get('items') if first is not None else None
    return items if isinstance(items, list) else []


def fetch_summary(target: BacklinksTarget) -> tuple[dict[str, Any] | None, float]:
    """``(metrics, cost_usd)``; the metrics are ``None`` when DataForSEO has no data for the target."""
    answer = _post(SUMMARY_PATH, common_task(target))
    return summary_row(_first_result(answer.result)), answer.cost_usd


def fetch_history(hostname: str, today: date) -> tuple[list[dict[str, Any]], list[dict[str, Any]], float]:
    """``(trends, new_lost, cost_usd)`` of the last year for ``hostname`` (subdomains always included)."""
    date_from, date_to = history_window(today)
    answer = _post(HISTORY_PATH, {
        'target': hostname, 'date_from': date_from, 'date_to': date_to, 'rank_scale': 'one_hundred',
    })
    trends, new_lost = history_rows(_items(_first_result(answer.result)))
    return trends, new_lost, answer.cost_usd


@dataclass(frozen=True)
class TableQuery:
    """One page of one table, in DataForSEO's terms."""

    tab: Tab
    limit: int
    offset: int
    order_by: list[str]
    filters: list[Any] | None
    mode: Mode | None = None
    """Backlinks only: every link (``as_is``) or each referring domain's strongest link (``one_per_domain``)."""


@dataclass(frozen=True)
class TablePage:
    rows: list[dict[str, Any]]
    total_count: int | None
    cost_usd: float


def table_task(target: BacklinksTarget, query: TableQuery) -> dict[str, Any]:
    task: dict[str, Any] = {
        **common_task(target), 'limit': query.limit, 'offset': query.offset, 'order_by': query.order_by,
    }
    if query.filters:
        task['filters'] = query.filters
    if query.tab == 'backlinks':
        task['mode'] = query.mode or 'one_per_domain'
    return task


def fetch_table(target: BacklinksTarget, query: TableQuery) -> TablePage:
    """One page of ``query.tab``; ``total_count`` is DataForSEO's count of every matching row."""
    answer = _post(TABLE_PATHS[query.tab], table_task(target, query))
    first = _first_result(answer.result)
    mapper = _ROW_MAPPERS[query.tab]
    rows = [mapper(item) for item in _items(first) if isinstance(item, Mapping)]
    total = number(first.get('total_count')) if first is not None else None
    return TablePage(rows=rows, total_count=int(total) if total is not None else None, cost_usd=answer.cost_usd)


def subfolder_totals(target: BacklinksTarget) -> tuple[int | None, int | None, float]:
    """``(backlinks, referring_domains, cost_usd)`` of a subfolder, from two one-row link requests."""
    scope_filters = build_filters('backlinks', {}, target, hide_spam=False).expression
    totals: list[int | None] = []
    cost = 0.0
    for mode in ('as_is', 'one_per_domain'):
        page = fetch_table(target, TableQuery(
            tab='backlinks', limit=1, offset=0, order_by=['rank,desc'], filters=scope_filters, mode=mode,
        ))
        totals.append(page.total_count)
        cost += page.cost_usd
    return totals[0], totals[1], cost
