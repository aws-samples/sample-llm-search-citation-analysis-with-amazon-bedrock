"""Organic rank checks on DataForSEO's Google SERP API: request bodies, matching and cost estimates.

Request (live ``/v3/serp/google/organic/live/advanced`` or queued ``task_post``):

- desktop searches as Windows, mobile as Android; depth clamped to 10-100 (DataForSEO bills per page of 10
  and rejects other depths);
- ``stop_crawl_on_match`` on the tracked domain ``with_subdomains`` plus ``find_targets_in: ["organic"]``:
  DataForSEO stops paging (and billing pages) once the domain is found in the organic results. Without
  ``find_targets_in`` a sitelink or "People also ask" mention would stop the crawl before the organic listing
  and read as "not ranking";
- the keyword is escaped (DataForSEO decodes %-escapes in posted keywords); queued tasks carry
  ``tag = <keyword_id>#<device>`` so answers are matched by tag, never by order.

Matching: the first ``organic`` item whose domain is the tracked domain or one of its subdomains. Its
position is ``rank_group`` (the organic-only rank people count; ``rank_absolute`` also counts SERP features and
is kept beside it), falling back to ``rank_absolute``. The SERP feature types are the distinct ``type`` of
every item, organic included. "No Search Results" is an empty, billed SERP: checked, not found.

Costs: the per-SERP price of ``shared.dataforseo_pricing`` (live $0.002 + $0.0015 per extra page of 10, queued
$0.0006 + $0.00045, five times that with a search operator). A run's worst case adds two queued retry rounds
for every pair, since any pair may be retried.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from shared.dataforseo_client import escape_keyword, post_live
from shared.dataforseo_keyword_rows import int_or_none, object_list
from shared.dataforseo_locations import MarketCodes
from shared.dataforseo_pricing import clamp_serp_depth, serp_usd

__all__ = [
    'DEVICES',
    'LIVE_PATH',
    'MONTHLY_CHECKS',
    'POST_PATH',
    'RETRY_ROUNDS',
    'TASK_GET_PATH',
    'Device',
    'RankCheck',
    'RunEstimate',
    'live_rank_check',
    'pair_tag',
    'parse_pair_tag',
    'rank_check_result',
    'rank_task',
    'run_estimate',
]

LIVE_PATH = '/v3/serp/google/organic/live/advanced'
POST_PATH = '/v3/serp/google/organic/task_post'
TASK_GET_PATH = '/v3/serp/google/organic/task_get/advanced'

Device = Literal['desktop', 'mobile']
DEVICES: tuple[Device, ...] = ('desktop', 'mobile')
_OS: dict[str, str] = {'desktop': 'windows', 'mobile': 'android'}

RETRY_ROUNDS = 2
"""Queued re-checks of suspicious results after the first pass."""

MONTHLY_CHECKS: dict[str, int] = {'daily': 30, 'weekly': 4, 'monthly': 1, 'manual': 0}
"""Scheduled checks a month, for the monthly estimate."""

LIVE_TIMEOUT_S = 60.0
"""A deep live crawl pages sequentially; the jobs function (not the API) waits for it."""

TAG_SEPARATOR = '#'


@dataclass(frozen=True)
class RankCheck:
    """Where the tracked domain ranks for one keyword on one device."""

    position: int | None
    """``rank_group`` of the first matching organic result; ``None`` = not in the checked depth."""
    rank_absolute: int | None
    url: str | None
    serp_features: tuple[str, ...]


def pair_tag(keyword_id: str, device: str) -> str:
    """The queued task tag of one (keyword, device) pair."""
    return f'{keyword_id}{TAG_SEPARATOR}{device}'


def parse_pair_tag(tag: str) -> tuple[str, str]:
    """``(keyword_id, device)`` of a ``pair_tag``."""
    keyword_id, _separator, device = tag.rpartition(TAG_SEPARATOR)
    return keyword_id, device


def rank_task(keyword: str, codes: MarketCodes, device: str, depth: int, domain: str,
              tag: str | None = None) -> dict[str, Any]:
    """The task body of one rank check; a queued task also carries its ``tag``."""
    task: dict[str, Any] = {
        'keyword': escape_keyword(keyword),
        'location_code': codes.location_code,
        'language_code': codes.language_code,
        'device': device,
        'os': _OS[device],
        'depth': clamp_serp_depth(depth),
        'stop_crawl_on_match': [{'match_value': domain, 'match_type': 'with_subdomains'}],
        'find_targets_in': ['organic'],
    }
    if tag is not None:
        task['tag'] = tag
    return task


def _matches(item_domain: object, target: str) -> bool:
    if not isinstance(item_domain, str):
        return False
    domain = item_domain.lower()
    return domain == target or domain.endswith(f'.{target}')


def _features(items: Iterable[Mapping[str, Any]]) -> tuple[str, ...]:
    seen: dict[str, None] = {}
    for item in items:
        kind = item.get('type')
        if isinstance(kind, str) and kind:
            seen.setdefault(kind, None)
    return tuple(seen)


def rank_check_result(result: Mapping[str, Any] | None, domain: str) -> RankCheck:
    """The tracked domain's rank in one SERP result (``result[0]``; ``None`` = no search results)."""
    items = object_list((result or {}).get('items'))
    target = domain.lower()
    match = next((item for item in items if item.get('type') == 'organic' and _matches(item.get('domain'), target)),
                 None)
    if match is None:
        return RankCheck(position=None, rank_absolute=None, url=None, serp_features=_features(items))
    rank_absolute = int_or_none(match.get('rank_absolute'))
    url = match.get('url')
    return RankCheck(
        position=int_or_none(match.get('rank_group')) or rank_absolute,
        rank_absolute=rank_absolute,
        url=url if isinstance(url, str) else None,
        serp_features=_features(items),
    )


def live_rank_check(keyword: str, codes: MarketCodes, device: str, depth: int, domain: str) -> tuple[RankCheck, float]:
    """One live rank check and its cost; billed, so never retried (``idempotent=False``)."""
    answer = post_live(LIVE_PATH, rank_task(keyword, codes, device, depth, domain), idempotent=False,
                       timeout_s=LIVE_TIMEOUT_S, treat_no_results_as_empty=True)
    first = answer.result[0] if answer.result and isinstance(answer.result[0], Mapping) else None
    return rank_check_result(None if answer.no_results else first, domain), answer.cost_usd


@dataclass(frozen=True)
class RunEstimate:
    """USD upper bounds of one run over ``pairs`` (keyword, device) checks."""

    pairs: int
    check_usd: float
    """The first pass at the run's method (live for manual runs, queued for scheduled ones)."""
    worst_case_usd: float
    """The first pass plus ``RETRY_ROUNDS`` queued re-checks of every pair."""


def run_estimate(keywords: Iterable[str], device_count: int, depth: int,
                 method: Literal['live', 'queued']) -> RunEstimate:
    """The cost of checking ``keywords`` on ``device_count`` devices at ``depth`` by ``method``."""
    check = 0.0
    retries = 0.0
    pairs = 0
    for keyword in keywords:
        check += serp_usd(depth, method, keyword) * device_count
        retries += serp_usd(depth, 'queued', keyword) * device_count * RETRY_ROUNDS
        pairs += device_count
    return RunEstimate(pairs=pairs, check_usd=round(check, 6), worst_case_usd=round(check + retries, 6))
