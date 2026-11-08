"""Business listings and Google Business Profile live calls (``/v3/business_data/...``).

- ``search_listings``: ``business_listings/search/live``. Its coordinate radius is in **whole kilometres**
  (the endpoint rejects fractional radii), at least 1.
- ``listing_categories``: the free ``GET business_listings/categories``; rows sit directly on ``result``.
- ``business_profile``: ``google/my_business_info/live``; ``check_url`` lives on ``result[0]``, not on the item,
  so it is merged in. "No Search Results" (billed) is ``None``.
- ``business_questions``: ``google/questions_and_answers/live``; answered questions (``items``) and unanswered
  ones (``items_without_answers``) are flattened across every result. "No Search Results" is ``[]``.

The Google Business endpoints take a coordinate whose radius is in **metres** (200-199,999), or a location
code, never both: DataForSEO rejects a request carrying both, so ``business_location`` gives the coordinate
precedence. A business is named by exactly one of its name, its ``cid`` or its ``place_id``; the profile, Q&A
and updates endpoints take the last two as ``cid:<cid>`` / ``place_id:<id>`` keywords.

Every provider row is reduced to an allowlist of fields: raw rows carry image URLs, xpaths and tracking blobs
(a listing row is about 9 KB) that would bloat the cache and the API answers.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from shared import dataforseo_client
from shared.dataforseo_keyword_rows import float_or_none, int_or_none, mapping_or_empty, object_list

LISTINGS_SEARCH_PATH = '/v3/business_data/business_listings/search/live'
CATEGORIES_PATH = '/v3/business_data/business_listings/categories'
BUSINESS_INFO_PATH = '/v3/business_data/google/my_business_info/live'
QUESTIONS_PATH = '/v3/business_data/google/questions_and_answers/live'

MIN_RADIUS_METERS = 200
MAX_RADIUS_METERS = 199_999
COORDINATE_DECIMALS = 7
"""About 1 cm: rounding to fewer places would move a point by up to kilometres."""

WEEKDAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')


class IdentifierError(ValueError):
    """Not exactly one of a business name, cid or place id."""


@dataclass(frozen=True)
class BusinessIdentifier:
    """Exactly one way to name a business."""

    name: str | None = None
    cid: str | None = None
    place_id: str | None = None

    def __post_init__(self) -> None:
        if sum(1 for value in (self.name, self.cid, self.place_id) if value) != 1:
            raise IdentifierError('Provide exactly one business identifier: name, cid or place_id')

    @property
    def keyword(self) -> str:
        """The ``keyword`` of the profile, Q&A and updates endpoints."""
        if self.cid:
            return f'cid:{self.cid}'
        if self.place_id:
            return f'place_id:{self.place_id}'
        return dataforseo_client.escape_keyword(self.name or '')

    def as_json(self) -> dict[str, str]:
        return {key: value for key, value in (('name', self.name), ('cid', self.cid), ('place_id', self.place_id))
                if value}


@dataclass(frozen=True)
class Near:
    """A point and a search radius around it."""

    latitude: float
    longitude: float
    radius_km: float = 10.0


def coordinate_number(value: float) -> str:
    """``value`` rounded to 7 decimals, without a trailing ``.0`` (``40`` not ``40.0``)."""
    rounded = round(value, COORDINATE_DECIMALS)
    if rounded == int(rounded):
        return str(int(rounded))
    return repr(rounded)


def business_coordinate(near: Near) -> str:
    """``"lat,lng,radiusMeters"`` for the Google Business endpoints (radius clamped to 200-199,999 m)."""
    meters = min(MAX_RADIUS_METERS, max(MIN_RADIUS_METERS, round(near.radius_km * 1000)))
    return f'{coordinate_number(near.latitude)},{coordinate_number(near.longitude)},{meters}'


def listings_coordinate(near: Near) -> str:
    """``"lat,lng,radiusKm"`` for business listings: whole kilometres, at least 1."""
    kilometres = max(1, round(near.radius_km))
    return f'{coordinate_number(near.latitude)},{coordinate_number(near.longitude)},{kilometres}'


def business_location(near: Near | None, location_code: int) -> dict[str, Any]:
    """The coordinate when there is one, else the location code; never both."""
    if near is not None:
        return {'location_coordinate': business_coordinate(near)}
    return {'location_code': location_code}


def text_or_none(value: object) -> str | None:
    """A non-empty wire string, else ``None``."""
    return value if isinstance(value, str) and value else None


def first_text(row: Mapping[str, Any], *fields: str) -> str | None:
    """The first non-empty string among ``fields`` (e.g. the translated text, then the original)."""
    return next((text for text in (text_or_none(row.get(field)) for field in fields) if text), None)


def cid_text(value: object) -> str | None:
    """A ``cid`` as a string: DataForSEO sends it as a string, older fixtures as a number."""
    if isinstance(value, bool) or not isinstance(value, str | int) or value == '':
        return None
    return str(value)


def _texts(value: object) -> list[str]:
    return [entry for entry in value if isinstance(entry, str) and entry] if isinstance(value, list) else []


def _rating(row: Mapping[str, Any]) -> tuple[float | None, int | None]:
    rating = mapping_or_empty(row.get('rating'))
    return float_or_none(rating.get('value')), int_or_none(rating.get('votes_count'))


def _bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def business_row(row: Mapping[str, Any]) -> dict[str, Any]:
    """The allowlisted fields of a listing, profile or Maps row (rating flattened to value + count)."""
    rating, reviews_count = _rating(row)
    return {
        'title': text_or_none(row.get('title')) or '',
        'category': text_or_none(row.get('category')),
        'additional_categories': _texts(row.get('additional_categories')),
        'address': text_or_none(row.get('address')),
        'phone': text_or_none(row.get('phone')),
        'url': text_or_none(row.get('url')),
        'domain': text_or_none(row.get('domain')),
        'rating': rating,
        'reviews_count': reviews_count,
        'is_claimed': _bool(row.get('is_claimed')),
        'cid': cid_text(row.get('cid')),
        'place_id': text_or_none(row.get('place_id')),
        'latitude': float_or_none(row.get('latitude')),
        'longitude': float_or_none(row.get('longitude')),
        'total_photos': int_or_none(row.get('total_photos')),
    }


def listing_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {**business_row(row), 'description': text_or_none(row.get('description')),
            'check_url': text_or_none(row.get('check_url'))}


@dataclass(frozen=True)
class ListingsQuery:
    """A business listings search; ``None`` filters are not sent."""

    near: Near
    title: str | None = None
    categories: tuple[str, ...] = ()
    min_rating: float | None = None
    min_reviews: int | None = None
    is_claimed: bool | None = None
    sort_by: str = 'relevance'
    limit: int = 20
    offset: int = 0


ORDER_BY = {'rating': ['rating.value,desc'], 'reviews': ['rating.votes_count,desc']}


def listings_body(query: ListingsQuery) -> dict[str, Any]:
    """The listings task: filters are ANDed, ``relevance`` sends no ordering."""
    body: dict[str, Any] = {'location_coordinate': listings_coordinate(query.near), 'limit': query.limit}
    if query.offset:
        body['offset'] = query.offset
    if query.title:
        body['title'] = query.title
    if query.categories:
        body['categories'] = list(query.categories)
    if query.is_claimed is not None:
        body['is_claimed'] = query.is_claimed
    filters: list[Any] = []
    if query.min_rating is not None:
        filters.append(['rating.value', '>=', query.min_rating])
    if query.min_reviews is not None:
        filters.extend(['and'] if filters else [])
        filters.append(['rating.votes_count', '>=', query.min_reviews])
    if filters:
        # One condition is sent bare; several are joined by 'and' in one list.
        body['filters'] = filters[0] if len(filters) == 1 else filters
    if query.sort_by in ORDER_BY:
        body['order_by'] = ORDER_BY[query.sort_by]
    return body


def _first_result(result: list[Any]) -> Mapping[str, Any]:
    return mapping_or_empty(result[0]) if result else {}


def search_listings(query: ListingsQuery) -> tuple[list[dict[str, Any]], float]:
    """``(rows, cost_usd)``; "No Search Results" is an empty, billed answer."""
    task = dataforseo_client.post_live(LISTINGS_SEARCH_PATH, listings_body(query), treat_no_results_as_empty=True)
    rows = object_list(_first_result(task.result).get('items'))
    return [listing_row(row) for row in rows], task.cost_usd


def listing_categories() -> list[dict[str, Any]]:
    """Every business category with its business count (free)."""
    task = dataforseo_client.get_free(CATEGORIES_PATH)
    rows = object_list(task.get('result'))
    return [
        {'category': row['category_name'], 'business_count': int_or_none(row.get('business_count'))}
        for row in rows if isinstance(row.get('category_name'), str) and row['category_name']
    ]


def _clock(value: object) -> str | None:
    time = mapping_or_empty(value)
    hour, minute = int_or_none(time.get('hour')), int_or_none(time.get('minute'))
    return None if hour is None else f'{hour:02d}:{minute or 0:02d}'


def timetable(work_time: object) -> dict[str, list[str]]:
    """Opening hours per weekday as ``"09:00-17:00"`` ranges; a day without ranges is closed (``[]``)."""
    table = mapping_or_empty(mapping_or_empty(mapping_or_empty(work_time).get('work_hours')).get('timetable'))
    hours: dict[str, list[str]] = {}
    for day in WEEKDAYS:
        if day not in table:
            continue
        ranges = [(_clock(entry.get('open')), _clock(entry.get('close'))) for entry in object_list(table[day])]
        hours[day] = [f'{start}-{end}' for start, end in ranges if start and end]
    return hours


def rating_distribution(value: object) -> dict[str, int]:
    """Review counts per star (``"1"``..``"5"``); missing stars count 0."""
    distribution = mapping_or_empty(value)
    return {star: int_or_none(distribution.get(star)) or 0 for star in ('1', '2', '3', '4', '5')}


def profile_row(item: Mapping[str, Any], check_url: object) -> dict[str, Any]:
    work_time = item.get('work_time')
    status = mapping_or_empty(mapping_or_empty(work_time).get('work_hours')).get('current_status')
    return {
        **business_row(item),
        'description': text_or_none(item.get('description')),
        'rating_distribution': rating_distribution(item.get('rating_distribution')),
        'current_status': text_or_none(status),
        'timetable': timetable(work_time),
        'check_url': text_or_none(check_url),
    }


def business_profile(identifier: BusinessIdentifier, near: Near | None, location_code: int,
                     language_code: str) -> tuple[dict[str, Any] | None, float]:
    """``(profile or None, cost_usd)``: ``None`` when no profile matches (still billed)."""
    body = {'keyword': identifier.keyword, **business_location(near, location_code), 'language_code': language_code}
    task = dataforseo_client.post_live(BUSINESS_INFO_PATH, body, treat_no_results_as_empty=True)
    first = _first_result(task.result)
    items = object_list(first.get('items'))
    if task.no_results or not items:
        return None, task.cost_usd
    return profile_row(items[0], first.get('check_url')), task.cost_usd


def _posted_by(row: Mapping[str, Any], kind: str) -> dict[str, Any]:
    """The id, text (translated, else original), author and time of a question or an answer."""
    return {
        f'{kind}_id': text_or_none(row.get(f'{kind}_id')),
        f'{kind}_text': first_text(row, f'{kind}_text', f'original_{kind}_text') or '',
        'profile_name': text_or_none(row.get('profile_name')),
        'time_ago': text_or_none(row.get('time_ago')),
        'timestamp': text_or_none(row.get('timestamp')),
    }


def question_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {**_posted_by(row, 'question'),
            'answers': [_posted_by(answer, 'answer') for answer in object_list(row.get('items'))]}


def business_questions(identifier: BusinessIdentifier, near: Near, language_code: str,
                       depth: int) -> tuple[list[dict[str, Any]], float]:
    """``(questions, cost_usd)``: answered and unanswered questions of every result."""
    body = {'keyword': identifier.keyword, 'location_coordinate': business_coordinate(near),
            'language_code': language_code, 'depth': depth}
    task = dataforseo_client.post_live(QUESTIONS_PATH, body, treat_no_results_as_empty=True)
    questions: list[dict[str, Any]] = []
    for result in object_list(task.result):
        for field in ('items', 'items_without_answers'):
            questions.extend(question_row(row) for row in object_list(result.get(field)))
    return questions, task.cost_usd


__all__ = [
    'BusinessIdentifier',
    'IdentifierError',
    'ListingsQuery',
    'Near',
    'business_coordinate',
    'business_location',
    'business_profile',
    'business_questions',
    'business_row',
    'cid_text',
    'coordinate_number',
    'first_text',
    'listing_categories',
    'listings_coordinate',
    'search_listings',
    'text_or_none',
]
