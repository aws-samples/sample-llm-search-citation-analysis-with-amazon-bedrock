"""Raw DataForSEO rows and job items shared by the local SEO suites (fictional businesses only)."""

from __future__ import annotations

import json
from typing import Any

import pytest

from shared import local_seo_jobs
from shared.dataforseo_tasks import PostedTasks, TaskOutcome

CAFE_CID = '1234567890'
CAFE_PLACE_ID = 'ChIJexample-cafe'


def raw_business(title: str = 'Acme Cafe', *, cid: str = CAFE_CID, rank: int = 1, domain: str = 'acme.example.org',
                 **extra: Any) -> dict[str, Any]:
    """One raw listing / Maps row, with the bulky fields the projection must drop."""
    return {
        'type': 'maps_search', 'rank_group': rank, 'rank_absolute': rank, 'title': title,
        'category': 'Coffee shop', 'additional_categories': ['Cafe', 7], 'address': '1 Example St',
        'phone': '+1 555 0100', 'url': f'https://{domain}/', 'domain': domain,
        'rating': {'rating_type': 'Max5', 'value': 4.6, 'votes_count': 120, 'rating_max': 5},
        'is_claimed': True, 'cid': cid, 'place_id': CAFE_PLACE_ID, 'latitude': 40.0, 'longitude': -74.0,
        'total_photos': 30, 'main_image': 'https://example.com/image.jpg', 'xpath': '/html/body/div', **extra,
    }


def projected_business(title: str = 'Acme Cafe', *, cid: str = CAFE_CID, domain: str = 'acme.example.org') -> dict[str, Any]:
    """``business_row`` of ``raw_business``."""
    return {
        'title': title, 'category': 'Coffee shop', 'additional_categories': ['Cafe'], 'address': '1 Example St',
        'phone': '+1 555 0100', 'url': f'https://{domain}/', 'domain': domain, 'rating': 4.6, 'reviews_count': 120,
        'is_claimed': True, 'cid': cid, 'place_id': CAFE_PLACE_ID, 'latitude': 40.0, 'longitude': -74.0,
        'total_photos': 30,
    }


def raw_review(rating: int, *, owner_answer: str | None = None, review_id: str = 'r-1') -> dict[str, Any]:
    return {
        'review_id': review_id, 'rating': {'value': rating, 'votes_count': None}, 'timestamp': '2026-10-01 09:00:00 +00:00',
        'time_ago': '2 weeks ago', 'review_text': 'Good coffee', 'profile_name': 'A. Reviewer', 'local_guide': True,
        'owner_answer': owner_answer, 'owner_timestamp': None, 'profile_image_url': 'https://example.com/a.png',
    }


def reviews_task_result(*reviews: dict[str, Any]) -> dict[str, Any]:
    """``result[0]`` of a reviews ``task_get``."""
    return {'title': 'Acme Cafe', 'reviews_count': 120, 'rating': {'value': 4.6}, 'cid': CAFE_CID,
            'place_id': CAFE_PLACE_ID, 'items': list(reviews)}


def posted(accepted: dict[str, str], rejected: dict[str, str] | None = None, cost: float = 0.0108) -> PostedTasks:
    return PostedTasks(accepted=accepted, rejected=rejected or {}, cost_usd=cost)


def completed(result: dict[str, Any] | None) -> TaskOutcome:
    return TaskOutcome(status='completed', result=result, message=None)


PENDING = TaskOutcome(status='pending', result=None, message=None)
FAILED = TaskOutcome(status='failed', result=None, message='Task failed upstream')

GRID_REQUEST: dict[str, Any] = {
    'keyword': 'coffee', 'center': {'latitude': 40.0, 'longitude': -74.0}, 'grid_size': 3, 'spacing_km': 2.0,
    'zoom': 13, 'device': 'mobile', 'language_code': 'en', 'depth': 20,
    'target': {'cid': CAFE_CID, 'place_id': None, 'domains': [], 'name': None},
}
REVIEWS_REQUEST: dict[str, Any] = {
    'identifier': {'cid': CAFE_CID}, 'near': None, 'location_code': 2840, 'language_code': 'en', 'depth': 20,
    'sort_by': 'newest',
}


class MemoryCache:
    """``get_cached`` / ``put_cached`` over a dict (no TTL, no empty-payload rule), as JSON round trips."""

    def __init__(self) -> None:
        self.entries: dict[str, str] = {}

    @staticmethod
    def _key(namespace: str, version: int, params: Any) -> str:
        return f'{namespace}#{version}#{json.dumps(params, sort_keys=True)}'

    def get(self, namespace: str, version: int, params: Any) -> Any:
        raw = self.entries.get(self._key(namespace, version, params))
        return None if raw is None else json.loads(raw)

    def put(self, namespace: str, version: int, params: Any, payload: Any, _ttl: int) -> None:
        self.entries[self._key(namespace, version, params)] = json.dumps(payload)

    def job(self, job_id: str) -> dict[str, Any]:
        return self.get('local-job', 1, {'job_id': job_id})


def install_memory_cache(monkeypatch: pytest.MonkeyPatch) -> MemoryCache:
    """Point the local SEO job store at a fresh ``MemoryCache``."""
    memory = MemoryCache()
    monkeypatch.setattr(local_seo_jobs, 'get_cached', memory.get)
    monkeypatch.setattr(local_seo_jobs, 'put_cached', memory.put)
    return memory


def stored_job(memory: MemoryCache, kind: str, request: dict[str, Any], **fields: Any) -> dict[str, Any]:
    """A job saved in ``memory`` with ``fields`` replacing the new job's defaults."""
    job = {**local_seo_jobs.new_job(kind, request, 0.01), **fields}
    memory.put('local-job', 1, {'job_id': job['job_id']}, job, 0)
    return job


def collecting_job(memory: MemoryCache, kind: str, tasks: dict[str, str], **fields: Any) -> dict[str, Any]:
    """A posted job of ``kind`` whose ``tasks`` are all pending."""
    request = GRID_REQUEST if kind == 'grid' else REVIEWS_REQUEST
    return stored_job(memory, kind, request, status='collecting', tasks=tasks, pending=list(tasks), **fields)


def receipted_job(memory: MemoryCache, kind: str, request: dict[str, Any], status: str) -> dict[str, Any]:
    """A job in ``status`` with the receipt of ``request`` pointing at it."""
    job = stored_job(memory, kind, request, status=status)
    local_seo_jobs.put_receipt(kind, request, job['job_id'])
    return job
