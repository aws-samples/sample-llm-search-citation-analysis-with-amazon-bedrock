"""
What one ``seo`` spend makes DataForSEO do: the number of calls and the static price of each.

The estimate of a DataForSEO lookup or SEO job counts the calls the request
can make at most and states the list price per call, computed from the same
price constants the SEO API prices its answers with. It never adds the calls
up into a dollar total and never tracks what was spent: DataForSEO bills each
call it makes, a cached answer costs nothing, and the SEO API never re-sends a
billed call, so a price per call is what the user needs to approve one.

Most counts follow from the request alone. A rank run and a backlinks snapshot
depend on stored data (the tracker's keywords and devices, the tracked
domains), read through the free routes of the same API.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from catalogue import JsonObject, Route

from shared.dataforseo_backlinks import HISTORY_USD, SUMMARY_USD, backlinks_usd
from shared.dataforseo_pricing import GOOGLE_ADS_LIVE_TASK_USD, labs_usd, serp_usd
from shared.local_seo_pricing import BUSINESS_INFO_USD, MAPS_QUEUED_POINT_USD, listings_search_usd, local_serp_usd

#: Reads a free SEO route and answers its JSON body; raises when the API refuses.
Reader = Callable[[Route], Any]

_SEO = '/api/seo'
#: Retry rounds a rank check gives a keyword DataForSEO could not check live, each a queued call.
RANK_RECHECK_ROUNDS = 2


@dataclass(frozen=True)
class SeoCalls:
    """At most ``calls`` DataForSEO calls, each priced by ``per_call``; ``blocker`` says why nothing would run."""

    calls: int
    per_call: str
    blocker: str | None = None


def _usd(value: float) -> str:
    return f'${value:.4f}'


def _research(body: JsonObject) -> SeoCalls:
    limit = int(body.get('limit') or 150)
    clickstream = bool(body.get('clickstream'))
    ads = f'; a Google-Ads-only market makes 1 call at {_usd(GOOGLE_ADS_LIVE_TASK_USD)}'
    if (body.get('mode') or 'auto') == 'auto':
        per_call = _usd(labs_usd(math.ceil(limit / 2), clickstream))
        # Two half-size calls; the related-keywords fallback runs only when they find too few keywords.
        return SeoCalls(3, f'DataForSEO Labs, up to {per_call} per call (2 calls, a 3rd only when they find too few '
                           f'keywords){ads}')
    return SeoCalls(1, f'DataForSEO Labs, up to {_usd(labs_usd(limit, clickstream))}{ads}')


def _serp(body: JsonObject) -> SeoCalls:
    depth = int(body.get('depth') or 20)
    price = serp_usd(depth, 'live', str(body.get('keyword') or ''))
    return SeoCalls(1, f'live Google organic results, {_usd(price)} at depth {depth}')


def _domain_overview(_body: JsonObject) -> SeoCalls:
    return SeoCalls(1, f'DataForSEO Labs, up to {_usd(labs_usd(1))}')


def _ranked_keywords(body: JsonObject) -> SeoCalls:
    rows = int(body.get('page_size') or 50)
    return SeoCalls(1, f'DataForSEO Labs, up to {_usd(labs_usd(rows))} for {rows} rows')


def _backlinks_overview(_body: JsonObject) -> SeoCalls:
    return SeoCalls(2, f'backlinks summary {_usd(SUMMARY_USD)}, a year of history {_usd(HISTORY_USD)} '
                       '(a subfolder makes 2 summary calls and has no history)')


def _backlinks_table(body: JsonObject) -> SeoCalls:
    rows = int(body.get('page_size') or 50)
    return SeoCalls(1, f'backlinks table, up to {_usd(backlinks_usd(rows))} for {rows} rows')


def _businesses(body: JsonObject) -> SeoCalls:
    limit = int(body.get('limit') or 20)
    return SeoCalls(1, f'business listings, up to {_usd(listings_search_usd(limit))} for {limit} rows')


def _profile(_body: JsonObject) -> SeoCalls:
    return SeoCalls(1, f'Google Business Profile, {_usd(BUSINESS_INFO_USD)}')


def _local_serp(body: JsonObject) -> SeoCalls:
    search_type = str(body.get('search_type') or 'maps')
    depth = int(body.get('depth') or 20)
    return SeoCalls(1, f'live {search_type} results, {_usd(local_serp_usd(search_type, depth))}')


def _rank_grid(body: JsonObject) -> SeoCalls:
    size = int(body.get('grid_size') or 3)
    return SeoCalls(size * size, f'one queued Maps call per point of the {size}x{size} grid, '
                                 f'{_usd(MAPS_QUEUED_POINT_USD)} each')


def _site_audit(body: JsonObject) -> SeoCalls:
    pages = int(body.get('max_pages') or 500)
    return SeoCalls(0, f'no DataForSEO call: the own crawler reads up to {pages} pages of your site')


def _domain_snapshot(_body: JsonObject) -> SeoCalls:
    return SeoCalls(2, f'DataForSEO Labs, from {_usd(labs_usd(1))} per call (overview and top keywords)')


def _rank_run(route: Route, read: Reader) -> SeoCalls:
    tracker_id = (route.path_params or {}).get('trackerId', '')
    estimate_path = f'{_SEO}/rank-trackers/estimate'
    answer = read(Route(route.router, 'POST', estimate_path, estimate_path, None, None, {'tracker_id': tracker_id}))
    pairs = int(answer.get('pairs') or 0) if isinstance(answer, dict) else 0
    per_call = (f'one live Google results check per keyword and device, from {_usd(serp_usd(10, "live"))} for the '
                f"first 10 results of the tracker's depth; a keyword not checked live is queued again at most "
                f'{RANK_RECHECK_ROUNDS} times at the queued price')
    return SeoCalls(pairs, per_call, None if pairs else 'The tracker has no keywords to check')


def _backlinks_snapshot(route: Route, read: Reader) -> SeoCalls:
    path = f'{_SEO}/backlinks/snapshots'
    answer = read(Route(route.router, 'GET', path, path, None, None, None))
    domains = answer.get('domains') if isinstance(answer, dict) else None
    count = len(domains) if isinstance(domains, list) else 0
    blocker = None if count else 'No owned or competitor domain is tracked; add them in Settings first'
    return SeoCalls(count, f'one backlinks summary per tracked domain, {_usd(SUMMARY_USD)} each', blocker)


_BY_BODY: dict[str, Callable[[JsonObject], SeoCalls]] = {
    f'{_SEO}/keywords/research': _research,
    f'{_SEO}/serp': _serp,
    f'{_SEO}/domains/overview': _domain_overview,
    f'{_SEO}/domains/keywords': _ranked_keywords,
    f'{_SEO}/backlinks/overview': _backlinks_overview,
    f'{_SEO}/backlinks/rows': _backlinks_table,
    f'{_SEO}/backlinks/referring-domains': _backlinks_table,
    f'{_SEO}/backlinks/top-pages': _backlinks_table,
    f'{_SEO}/local/businesses': _businesses,
    f'{_SEO}/local/profile': _profile,
    f'{_SEO}/local/serp': _local_serp,
    f'{_SEO}/local/jobs': _rank_grid,
    f'{_SEO}/audits': _site_audit,
    f'{_SEO}/domains/snapshots': _domain_snapshot,
}
_BY_ROUTE: dict[str, Callable[[Route, Reader], SeoCalls]] = {
    f'{_SEO}/rank-trackers/{{trackerId}}/runs': _rank_run,
    f'{_SEO}/backlinks/snapshots': _backlinks_snapshot,
}


def seo_calls(route: Route, read: Reader) -> SeoCalls:
    """The DataForSEO calls ``route`` (a request of an ``seo`` spend tool) makes at most, and their price."""
    by_route = _BY_ROUTE.get(route.resource)
    if by_route is not None:
        return by_route(route, read)
    return _BY_BODY[route.resource](route.body or {})
