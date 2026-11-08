"""Queued Google Business tasks: reviews and profile updates (posts).

Both are posted to ``task_post`` at priority 2 (high priority usually settles within 10-40 s; the normal queue
takes minutes) and collected with the free ``task_get``. DataForSEO bills a task when it is posted, so a post is
never re-sent, not even after a 5xx: a 5xx does not prove the charge was skipped. A pending task is collected
again later at no cost.

Reviews take the business's native ``cid`` / ``place_id`` fields (or its name as the keyword); updates take the
``cid:`` / ``place_id:`` keyword form.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from shared import dataforseo_tasks
from shared.dataforseo_business import (
    BusinessIdentifier,
    Near,
    business_location,
    cid_text,
    first_text,
    text_or_none,
)
from shared.dataforseo_client import DataForSeoError, escape_keyword
from shared.dataforseo_keyword_rows import float_or_none, int_or_none, mapping_or_empty, object_list

REVIEWS_POST_PATH = '/v3/business_data/google/reviews/task_post'
REVIEWS_GET_PATH = '/v3/business_data/google/reviews/task_get'
UPDATES_POST_PATH = '/v3/business_data/google/my_business_updates/task_post'
UPDATES_GET_PATH = '/v3/business_data/google/my_business_updates/task_get'
HIGH_PRIORITY = 2
TASK_TAG = 'business'

REVIEW_SORTS = ('newest', 'highest_rating', 'lowest_rating', 'relevant')


@dataclass(frozen=True)
class BusinessTask:
    """What a queued business task needs: the business, where to look for it and how much to fetch."""

    identifier: BusinessIdentifier
    near: Near | None
    location_code: int
    language_code: str
    depth: int


def reviews_body(task: BusinessTask, sort_by: str) -> dict[str, Any]:
    identifier = task.identifier
    if identifier.cid:
        target: dict[str, Any] = {'cid': identifier.cid}
    elif identifier.place_id:
        target = {'place_id': identifier.place_id}
    else:
        target = {'keyword': escape_keyword(identifier.name or '')}
    return {**target, **business_location(task.near, task.location_code), 'language_code': task.language_code,
            'depth': task.depth, 'sort_by': sort_by, 'tag': TASK_TAG}


def updates_body(task: BusinessTask) -> dict[str, Any]:
    return {'keyword': task.identifier.keyword, **business_location(task.near, task.location_code),
            'language_code': task.language_code, 'depth': task.depth, 'tag': TASK_TAG}


def _post_one(path: str, body: dict[str, Any], pingback_url: str | None) -> tuple[str, float]:
    """``(task_id, cost_usd)`` of one posted task; a refused entry raises with the cost it was billed."""
    posted = dataforseo_tasks.post_tasks(path, [body], priority=HIGH_PRIORITY, pingback_url=pingback_url)
    task_id = posted.accepted.get(TASK_TAG)
    if task_id is None:
        message = posted.rejected.get(TASK_TAG) or 'DataForSEO did not accept the task'
        raise DataForSeoError('INTERNAL_ERROR', message, cost_usd=posted.cost_usd)
    return task_id, posted.cost_usd


def post_reviews(task: BusinessTask, sort_by: str = 'newest', pingback_url: str | None = None) -> tuple[str, float]:
    return _post_one(REVIEWS_POST_PATH, reviews_body(task, sort_by), pingback_url)


def post_updates(task: BusinessTask, pingback_url: str | None = None) -> tuple[str, float]:
    return _post_one(UPDATES_POST_PATH, updates_body(task), pingback_url)


def _texts_of(row: Mapping[str, Any], *fields: str) -> dict[str, str | None]:
    return {field: text_or_none(row.get(field)) for field in fields}


def review_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        **_texts_of(row, 'review_id', 'timestamp', 'time_ago'),
        'rating': float_or_none(mapping_or_empty(row.get('rating')).get('value')),
        'review_text': first_text(row, 'review_text', 'original_review_text'),
        'local_guide': row.get('local_guide') is True,
        **_texts_of(row, 'profile_name', 'owner_answer', 'owner_timestamp'),
    }


def review_summary(reviews: list[dict[str, Any]]) -> dict[str, Any]:
    """Star histogram of the fetched reviews and the share of them the owner answered (``None`` without reviews)."""
    histogram: dict[str, int] = dict.fromkeys(('1', '2', '3', '4', '5'), 0)
    for review in reviews:
        rating = review['rating']
        if rating is not None and 1 <= rating <= 5:
            histogram[str(round(rating))] += 1
    answered = sum(1 for review in reviews if review['owner_answer'])
    return {
        'histogram': histogram,
        'owner_response_rate': round(answered / len(reviews), 4) if reviews else None,
    }


def reviews_result(result: Mapping[str, Any] | None) -> dict[str, Any]:
    """The collected reviews, the business totals DataForSEO reports, and their summary."""
    first = mapping_or_empty(result)
    reviews = [review_row(row) for row in object_list(first.get('items'))]
    return {
        'totals': {
            'title': text_or_none(first.get('title')),
            'reviews_count': int_or_none(first.get('reviews_count')),
            'rating': float_or_none(mapping_or_empty(first.get('rating')).get('value')),
            'cid': cid_text(first.get('cid')),
            'place_id': text_or_none(first.get('place_id')),
        },
        'reviews': reviews,
        'summary': review_summary(reviews),
    }


def update_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        **_texts_of(row, 'author', 'post_date', 'timestamp'),
        'post_text': first_text(row, 'post_text', 'snippet'),
        'url': text_or_none(row.get('url')),
        'links': [_texts_of(link, 'title', 'url') for link in object_list(row.get('links'))],
    }


def updates_result(result: Mapping[str, Any] | None) -> dict[str, Any]:
    return {'updates': [update_row(row) for row in object_list(mapping_or_empty(result).get('items'))]}


def collect_reviews(task_id: str) -> dataforseo_tasks.TaskOutcome:
    """The free ``task_get`` of a reviews task."""
    return dataforseo_tasks.get_task(REVIEWS_GET_PATH, task_id)


def collect_updates(task_id: str) -> dataforseo_tasks.TaskOutcome:
    return dataforseo_tasks.get_task(UPDATES_GET_PATH, task_id)


__all__ = [
    'REVIEW_SORTS',
    'BusinessTask',
    'collect_reviews',
    'collect_updates',
    'post_reviews',
    'post_updates',
    'reviews_body',
    'reviews_result',
    'updates_body',
    'updates_result',
]
