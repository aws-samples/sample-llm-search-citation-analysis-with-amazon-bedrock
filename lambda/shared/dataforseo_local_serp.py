"""Google Maps and Local Finder results (``/v3/serp/google/maps`` and ``/v3/serp/google/local_finder``).

- ``local_serp``: one live Maps or Local Finder page around a point. Maps is always given a zoom: without one
  DataForSEO infers it and city queries come back with one result or none. ``search_places`` is off so the
  page lists the businesses of the query rather than a single place card. "No Search Results" (billed) is empty.
- ``post_grid_tasks`` / ``collect_grid_task``: one queued Maps task per rank-grid point, posted together at
  priority 2 and tagged with the point's index; ids are read back by that echoed tag, never by response order.
  The post is billed and never re-sent; collecting a task is free.
- ``match_business``: where a business appears in a result list, by ``cid``, then ``place_id``, then website
  domain, then a case-insensitive name match; its rank is ``rank_absolute``, else ``rank_group``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from shared import dataforseo_client, dataforseo_tasks
from shared.dataforseo_business import business_row, coordinate_number
from shared.dataforseo_keyword_rows import int_or_none, mapping_or_empty, object_list

LIVE_PATHS = {
    'maps': '/v3/serp/google/maps/live/advanced',
    'local_finder': '/v3/serp/google/local_finder/live/advanced',
}
MAPS_TASK_POST_PATH = '/v3/serp/google/maps/task_post'
MAPS_TASK_GET_PATH = '/v3/serp/google/maps/task_get/advanced'
HIGH_PRIORITY = 2
DEFAULT_ZOOM = 12
MIN_ZOOM = 4
MAX_ZOOM = 18


@dataclass(frozen=True)
class LocalSearch:
    """One local results request; ``zoom`` applies to Maps only."""

    keyword: str
    latitude: float
    longitude: float
    language_code: str
    search_type: str = 'maps'
    device: str = 'mobile'
    depth: int = 20
    zoom: int = DEFAULT_ZOOM


@dataclass(frozen=True)
class BusinessTarget:
    """How to recognise one business in a result list; empty fields are not compared."""

    cid: str | None = None
    place_id: str | None = None
    domains: tuple[str, ...] = ()
    name: str | None = None

    @property
    def is_empty(self) -> bool:
        return not (self.cid or self.place_id or self.domains or self.name)


def local_coordinate(latitude: float, longitude: float, zoom: int | None = None) -> str:
    """``"lat,lng"`` or ``"lat,lng,{zoom}z"``."""
    point = f'{coordinate_number(latitude)},{coordinate_number(longitude)}'
    return point if zoom is None else f'{point},{zoom}z'


def _os(device: str) -> str:
    return 'windows' if device == 'desktop' else 'android'


def local_body(search: LocalSearch) -> dict[str, Any]:
    is_maps = search.search_type == 'maps'
    body: dict[str, Any] = {
        'keyword': dataforseo_client.escape_keyword(search.keyword),
        'location_coordinate': local_coordinate(search.latitude, search.longitude, search.zoom if is_maps else None),
        'language_code': search.language_code,
        'device': search.device,
        'os': _os(search.device),
        'depth': search.depth,
    }
    if is_maps:
        body['search_places'] = False
    return body


def local_item(row: Mapping[str, Any]) -> dict[str, Any]:
    """The allowlisted fields of one Maps / Local Finder result."""
    return {
        **business_row(row),
        'rank_group': int_or_none(row.get('rank_group')),
        'rank_absolute': int_or_none(row.get('rank_absolute')),
    }


def result_items(result: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    return [local_item(row) for row in object_list(mapping_or_empty(result).get('items'))]


def local_serp(search: LocalSearch) -> tuple[list[dict[str, Any]], str | None, float]:
    """``(items, check_url, cost_usd)`` of one live page."""
    task = dataforseo_client.post_live(LIVE_PATHS[search.search_type], local_body(search),
                                       treat_no_results_as_empty=True)
    first = mapping_or_empty(task.result[0]) if task.result else {}
    check_url = first.get('check_url')
    return result_items(first), check_url if isinstance(check_url, str) else None, task.cost_usd


def grid_task_bodies(keyword: str, points: Sequence[tuple[float, float]], zoom: int, device: str,
                     language_code: str, depth: int) -> list[dict[str, Any]]:
    """One Maps task per point, tagged with the point's index."""
    escaped = dataforseo_client.escape_keyword(keyword)
    return [
        {
            'keyword': escaped,
            'location_coordinate': local_coordinate(latitude, longitude, zoom),
            'language_code': language_code,
            'device': device,
            'os': _os(device),
            'depth': depth,
            'search_places': False,
            'tag': str(index),
        }
        for index, (latitude, longitude) in enumerate(points)
    ]


def post_grid_tasks(bodies: list[dict[str, Any]], pingback_url: str | None = None) -> dataforseo_tasks.PostedTasks:
    """Post every grid point in one billed request (never re-sent); each calls ``pingback_url`` when ready."""
    return dataforseo_tasks.post_tasks(MAPS_TASK_POST_PATH, bodies, priority=HIGH_PRIORITY, pingback_url=pingback_url)


def collect_grid_task(task_id: str) -> dataforseo_tasks.TaskOutcome:
    """The free ``task_get`` of one grid point."""
    return dataforseo_tasks.get_task(MAPS_TASK_GET_PATH, task_id)


def _host(value: str) -> str:
    host = value.strip().lower()
    for prefix in ('https://', 'http://'):
        host = host.removeprefix(prefix)
    host = host.split('/', 1)[0]
    return host.removeprefix('www.')


def _domain_matches(item_domain: str | None, domains: tuple[str, ...]) -> bool:
    if not item_domain:
        return False
    host = _host(item_domain)
    return any(host == owned or host.endswith(f'.{owned}') for owned in (_host(domain) for domain in domains) if owned)


def _matches(item: Mapping[str, Any], target: BusinessTarget, field: str) -> bool:
    if field == 'cid':
        return bool(target.cid) and item.get('cid') == target.cid
    if field == 'place_id':
        return bool(target.place_id) and item.get('place_id') == target.place_id
    if field == 'domain':
        return bool(target.domains) and _domain_matches(item.get('domain'), target.domains)
    name = (target.name or '').strip().lower()
    return bool(name) and name in str(item.get('title') or '').lower()


def match_business(items: Sequence[Mapping[str, Any]], target: BusinessTarget) -> Mapping[str, Any] | None:
    """The first item matching the strongest identifier the target has (cid > place_id > domain > name)."""
    for field in ('cid', 'place_id', 'domain', 'name'):
        for item in items:
            if _matches(item, target, field):
                return item
    return None


def business_identity(item: Mapping[str, Any]) -> dict[str, Any]:
    """The title, ``cid`` and ``place_id`` of a matched result."""
    return {'title': item.get('title'), 'cid': item.get('cid'), 'place_id': item.get('place_id')}


def item_rank(item: Mapping[str, Any]) -> int | None:
    """``rank_absolute``, else ``rank_group``, else ``None``."""
    for field in ('rank_absolute', 'rank_group'):
        rank = item.get(field)
        if isinstance(rank, int) and not isinstance(rank, bool):
            return rank
    return None


__all__ = [
    'DEFAULT_ZOOM',
    'MAX_ZOOM',
    'MIN_ZOOM',
    'BusinessTarget',
    'LocalSearch',
    'business_identity',
    'collect_grid_task',
    'grid_task_bodies',
    'item_rank',
    'local_body',
    'local_coordinate',
    'local_serp',
    'match_business',
    'post_grid_tasks',
    'result_items',
]
