"""
Rank tracking API (``/api/seo/rank-trackers``; shapes in ``web/src/types/api/seoRankTracking.ts``):

- GET    /rank-trackers                  - active trackers, their latest run, the brand's domains to offer
- POST   /rank-trackers                  - create (or reactivate an archived) tracker (Admin)
- POST   /rank-trackers/estimate         - USD estimate of a tracker's runs (free, no DataForSEO call)
- GET    /rank-trackers/{id}             - one tracker and its keywords
- PUT    /rank-trackers/{id}             - change devices, depth, schedule or keyword scope / group (Admin)
- DELETE /rank-trackers/{id}             - archive; the history is kept (Admin)
- POST   /rank-trackers/{id}/keywords    - add extra keywords (Admin); DELETE ?keyword_ids=a,b removes them (Admin)
- GET    /rank-trackers/{id}/runs        - the latest run; POST starts a manual run (Admin)
- GET    /rank-trackers/{id}/results?period=1d|7d|30d|90d
- GET    /rank-trackers/{id}/history?keyword_id=&days=   (at most 365 days)
- GET    /rank-trackers/{id}/trend?days=

Creating, editing, scheduling and running a tracker spend money, so those routes are Admin-only. A manual run is
never made here: the route takes the tracker's lock and starts the ``CitationAnalysis-SeoRankCheck`` state machine
(live checks run in the jobs function, beyond the API's 29 s limit) and answers 202 with the run and its worst-case
cost (the checks plus two queued re-check rounds). A tracker is one (domain, market); creating it again while it
is active answers 409 ``TRACKER_EXISTS``, while it is archived reactivates it. An edit that races another write
answers 409 ``CONFLICT``. Creating, editing and archiving a tracker move its own EventBridge Scheduler schedule
(``shared.rank_tracking_timer``) to its next slot, or delete it when the tracker is archived or ``manual``.

A tracker's keywords are the Settings keywords of its ``keyword_scope`` (``all``: every active keyword of its
market, the default; ``group``: one keyword group), resolved at every read and run, plus optional extra keywords
added by hand. A body with a ``group_id`` and no ``keyword_scope`` means ``group``.
"""

import re
import sys
from collections.abc import Callable, Mapping
from dataclasses import replace
from functools import partial, wraps
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from seo_http import (
    MARKET_ID_FIELD,
    body_list,
    brand_config,
    keyword_id_list,
    keyword_list,
    resolve_market,
    seo_error,
    seo_route,
)

from shared.api_response import api_response, success_response
from shared.auth import ADMIN_GROUP, require_group
from shared.dataforseo_locations import market_codes
from shared.dataforseo_rank import MONTHLY_CHECKS, run_estimate
from shared.decorators import json_object_body, validate
from shared.rank_tracking_reads import (
    MAX_HISTORY_DAYS,
    PERIOD_DAYS,
    history,
    latest_run_json,
    results,
    run_json,
    tracker_json,
    trend,
)
from shared.rank_tracking_runs import begin_run, latest_run
from shared.rank_tracking_runtime import keywords_table, start_execution
from shared.rank_tracking_schedule import SCHEDULES, format_timestamp, next_check_at
from shared.rank_tracking_store import (
    DEVICE_CHOICES,
    KEYWORD_SCOPES,
    MAX_KEYWORDS,
    KeywordSelection,
    StaleWriteError,
    TrackedKeyword,
    Tracker,
    active_keywords_for,
    add_keywords,
    device_list,
    get_tracker,
    list_keywords,
    list_trackers,
    normalize_tracked_domain,
    put_tracker,
    rank_table,
    remove_keywords,
    select_run_keywords,
    tracker_id_for,
)
from shared.rank_tracking_timer import sync_schedule
from shared.utils import utc_now

Handler = Callable[..., dict[str, Any]]

PATH = re.compile(r'/rank-trackers(?:/(?P<tracker>[A-Za-z0-9-]+)(?:/(?P<sub>[a-z]+))?)?/?$')
MAX_REMOVE_PER_REQUEST = 200
"""Keyword ids one DELETE removes (they travel in the query string, which API Gateway caps)."""
GROUP_ID_FIELD: dict[str, Any] = {'type': str, 'max_length': 64}
DEPTH_FIELD: dict[str, Any] = {'type': int, 'min': 10, 'max': 100}
SCOPE_FIELD: dict[str, Any] = {'type': str, 'choices': list(KEYWORD_SCOPES)}

CREATE_SCHEMA: dict[str, dict[str, Any]] = {
    'domain': {'required': True, 'type': str, 'min_length': 1, 'max_length': 255},
    'market_id': MARKET_ID_FIELD,
    'devices': {'type': str, 'choices': list(DEVICE_CHOICES), 'default': 'mobile'},
    'depth': {**DEPTH_FIELD, 'default': 30},
    'schedule': {'type': str, 'choices': list(SCHEDULES), 'default': 'weekly'},
    'keyword_scope': SCOPE_FIELD,
    'group_id': GROUP_ID_FIELD,
}
UPDATE_SCHEMA: dict[str, dict[str, Any]] = {
    'devices': {'type': str, 'choices': list(DEVICE_CHOICES)},
    'depth': DEPTH_FIELD,
    'schedule': {'type': str, 'choices': list(SCHEDULES)},
    'keyword_scope': SCOPE_FIELD,
    'group_id': GROUP_ID_FIELD,
}
ESTIMATE_SCHEMA: dict[str, dict[str, Any]] = {
    **UPDATE_SCHEMA, 'tracker_id': {'type': str, 'max_length': 64}, 'market_id': MARKET_ID_FIELD,
}
RESULTS_SCHEMA: dict[str, dict[str, Any]] = {'period': {'type': str, 'choices': list(PERIOD_DAYS), 'default': '7d'}}
HISTORY_SCHEMA: dict[str, dict[str, Any]] = {
    'keyword_id': {'required': True, 'type': str, 'min_length': 1, 'max_length': 64},
    'days': {'type': int, 'min': 1, 'max': MAX_HISTORY_DAYS, 'default': MAX_HISTORY_DAYS},
}
TREND_SCHEMA: dict[str, dict[str, Any]] = {'days': {'type': int, 'min': 1, 'max': MAX_HISTORY_DAYS, 'default': 90}}


def _now_text() -> str:
    return format_timestamp(utc_now())


def _not_found(event: dict[str, Any]) -> dict[str, Any]:
    return seo_error(404, 'NOT_FOUND', 'Rank tracker not found', event)


def _scheduled_slot(schedule: str) -> str | None:
    slot = next_check_at(schedule, None, utc_now())
    return format_timestamp(slot) if slot else None


def _store(tracker: Tracker) -> Tracker:
    """Write ``tracker`` over the version it was read at; a lost race raises ``StaleWriteError`` (409)."""
    return put_tracker(rank_table(), tracker, tracker.version)


def _scheduled(stored: Tracker) -> Tracker:
    """``stored`` after its own EventBridge schedule was moved to its slot (or deleted: archived, manual)."""
    sync_schedule(stored, utc_now())
    return stored


def _resolving_tracker(func: Handler, *, active_only: bool) -> Handler:
    @wraps(func)
    def resolved(event: dict[str, Any], context: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        tracker = get_tracker(rank_table(), str(kwargs.pop('tracker_id')))
        if tracker is None or (active_only and not tracker.is_active):
            return _not_found(event)
        return func(event, context, *args, tracker=tracker, **kwargs)

    return resolved


def with_tracker(*, active_only: bool = True) -> Callable[[Handler], Handler]:
    """Resolve the route's ``tracker_id`` to its ``Tracker`` (404 when missing or, if ``active_only``, archived).

    Goes innermost, below ``@require_group`` and ``@validate``, so a refused caller or request is answered first.
    """
    return partial(_resolving_tracker, active_only=active_only)


def _requested_keywords(body: Mapping[str, Any], depth: int | None,
                        event: dict[str, Any]) -> tuple[list[str], dict[str, Any] | None]:
    """The optional ``keywords`` of a create or estimate body, and a refusal of them or of ``depth``."""
    if depth is not None and depth % 10:
        return [], seo_error(400, 'VALIDATION_ERROR', 'depth must be a multiple of 10 between 10 and 100', event,
                             'depth')
    if body.get('keywords') in (None, []):
        return [], None
    entries, error = keyword_list(body.get('keywords'), 'keywords', MAX_KEYWORDS)
    if entries is None:
        return [], seo_error(400, 'VALIDATION_ERROR', error or 'keywords is invalid', event, 'keywords')
    return entries, None


def _selection(tracker: Tracker, active: list[dict[str, Any]] | None = None) -> KeywordSelection:
    """``tracker``'s keywords; ``active`` = the Keywords rows already read for it (read here when ``None``)."""
    rows = active_keywords_for(keywords_table(), [tracker]) if active is None else active
    return select_run_keywords(rank_table(), rows, tracker)


def _tracker_body(tracker: Tracker, active: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The API tracker without its latest run (a write's answer)."""
    return tracker_json(tracker, _selection(tracker, active))


def _with_latest_run(tracker: Tracker, active: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return tracker_json(tracker, _selection(tracker, active), latest_run(rank_table(), tracker.tracker_id))


def _run_keywords(tracker: Tracker) -> list[TrackedKeyword]:
    return _selection(tracker).keywords


def _scope_refusal(tracker: Tracker, event: dict[str, Any]) -> dict[str, Any] | None:
    """A 400 when ``tracker`` is to check a keyword group without naming one."""
    if tracker.keyword_scope == 'group' and not tracker.group_id:
        return seo_error(400, 'VALIDATION_ERROR', 'Choose the keyword group to track', event, 'group_id')
    return None


# ---------------------------------------------------------------------------
# Trackers
# ---------------------------------------------------------------------------

def handle_list(event: dict[str, Any], _context: Any, **_kwargs: Any) -> dict[str, Any]:
    config = brand_config()
    competitors = config.get('competitor_domains')
    trackers = [tracker for tracker in list_trackers(rank_table()) if tracker.is_active]
    active = active_keywords_for(keywords_table(), trackers)
    return success_response({
        'trackers': [_with_latest_run(tracker, active) for tracker in trackers],
        'owned_domains': list(config.get('first_party_domains') or []),
        'competitor_domains': {str(name): list(domains) for name, domains in competitors.items()}
        if isinstance(competitors, Mapping) else {},
    }, event)


@require_group(ADMIN_GROUP)
@json_object_body
@validate(CREATE_SCHEMA)
def handle_create(event: dict[str, Any], _context: Any, *, body: dict[str, Any], domain: str, market_id: str | None,
                  devices: str, depth: int, schedule: str, keyword_scope: str | None, group_id: str | None,
                  **_kwargs: Any) -> dict[str, Any]:
    tracked = normalize_tracked_domain(domain)
    if tracked is None:
        return seo_error(400, 'VALIDATION_ERROR', 'domain must be a host name such as example.com', event, 'domain')
    keywords, refusal = _requested_keywords(body, depth, event)
    if refusal is not None:
        return refusal
    resolved_id, market = resolve_market(market_id)
    market_codes(market)
    tracker_id = tracker_id_for(tracked, resolved_id)
    existing = get_tracker(rank_table(), tracker_id)
    if existing is not None and existing.is_active:
        return seo_error(409, 'TRACKER_EXISTS', 'This domain is already tracked in this market', event)
    scope = keyword_scope or ('group' if group_id else 'all')
    now = _now_text()
    tracker = Tracker(
        tracker_id=tracker_id, domain=tracked, market_id=resolved_id, devices=devices, depth=depth,
        schedule=schedule, keyword_scope=scope, group_id=(group_id or None) if scope == 'group' else None,
        next_check_at=_scheduled_slot(schedule), created_at=existing.created_at if existing else now, updated_at=now,
        last_checked_at=existing.last_checked_at if existing else None,
    )
    refusal = _scope_refusal(tracker, event)
    if refusal is not None:
        return refusal
    added = add_keywords(rank_table(), tracker_id, keywords, now)
    tracker = replace(tracker, keyword_count=len(list_keywords(rank_table(), tracker_id)))
    stored = _scheduled(put_tracker(rank_table(), tracker, existing.version if existing else None))
    return success_response({'tracker': _tracker_body(stored), 'keywords_added': added}, event, 201)


@with_tracker()
def handle_detail(event: dict[str, Any], _context: Any, *, tracker: Tracker, **_kwargs: Any) -> dict[str, Any]:
    return success_response({
        'tracker': _with_latest_run(tracker),
        'keywords': [{'keyword_id': entry.keyword_id, 'keyword': entry.keyword, 'source': entry.source}
                     for entry in _run_keywords(tracker)],
    }, event)


def _scope_changes(tracker: Tracker, settings: Mapping[str, Any]) -> dict[str, Any]:
    """The ``keyword_scope`` / ``group_id`` changes of ``settings``: a group alone means the ``group`` scope."""
    scope, group = settings.get('keyword_scope'), settings.get('group_id')
    if scope is None and group is not None:
        # Clearing the group of a group tracker leaves it on every keyword of its market.
        scope = 'group' if group else ('all' if tracker.keyword_scope == 'group' else tracker.keyword_scope)
    if scope is None:
        return {}
    return {'keyword_scope': scope, 'group_id': (group or tracker.group_id) if scope == 'group' else None}


def _edited(tracker: Tracker, settings: Mapping[str, Any]) -> Tracker:
    """``tracker`` with the ``devices`` / ``depth`` / ``schedule`` / scope of ``settings`` that are set."""
    changes: dict[str, Any] = {'updated_at': _now_text(), **_scope_changes(tracker, settings)}
    for field in ('devices', 'depth'):
        if settings.get(field) is not None:
            changes[field] = settings[field]
    schedule = settings.get('schedule')
    # The slot is re-chosen only when the schedule really changes, so saving other fields keeps its time.
    if schedule is not None and (schedule != tracker.schedule or not tracker.next_check_at):
        changes.update(schedule=schedule, next_check_at=_scheduled_slot(schedule))
    return replace(tracker, **changes)


@require_group(ADMIN_GROUP)
@json_object_body
@validate(UPDATE_SCHEMA)
@with_tracker()
def handle_update(event: dict[str, Any], _context: Any, *, body: dict[str, Any], tracker: Tracker,
                  **settings: Any) -> dict[str, Any]:
    _keywords, refusal = _requested_keywords({**body, 'keywords': None}, settings.get('depth'), event)
    edited = _edited(tracker, settings)
    refusal = refusal or _scope_refusal(edited, event)
    if refusal is not None:
        return refusal
    stored = _scheduled(_store(edited))
    return success_response({'tracker': _with_latest_run(stored)}, event)


@require_group(ADMIN_GROUP)
@with_tracker()
def handle_archive(event: dict[str, Any], _context: Any, *, tracker: Tracker, **_kwargs: Any) -> dict[str, Any]:
    stored = _scheduled(_store(replace(tracker, is_active=False, updated_at=_now_text())))
    return success_response({'tracker': _tracker_body(stored)}, event)


# ---------------------------------------------------------------------------
# Keywords
# ---------------------------------------------------------------------------

def _counted(event: dict[str, Any], tracker: Tracker, field: str, changed: int) -> dict[str, Any]:
    """Store the tracker's new keyword count and answer ``{field: changed, keyword_count}``."""
    count = len(list_keywords(rank_table(), tracker.tracker_id))
    _store(replace(tracker, keyword_count=count, updated_at=_now_text()))
    return success_response({field: changed, 'keyword_count': count}, event)


@require_group(ADMIN_GROUP)
@json_object_body
@body_list('keywords', keyword_list, MAX_KEYWORDS)
@with_tracker()
def handle_add_keywords(event: dict[str, Any], _context: Any, *, tracker: Tracker, keywords: list[str],
                        **_kwargs: Any) -> dict[str, Any]:
    if len(list_keywords(rank_table(), tracker.tracker_id)) + len(keywords) > MAX_KEYWORDS:
        return seo_error(400, 'VALIDATION_ERROR', f'A tracker holds at most {MAX_KEYWORDS} keywords', event, 'keywords')
    return _counted(event, tracker, 'added', add_keywords(rank_table(), tracker.tracker_id, keywords, _now_text()))


@require_group(ADMIN_GROUP)
def handle_remove_keywords(event: dict[str, Any], context: Any, **kwargs: Any) -> dict[str, Any]:
    raw = str((event.get('queryStringParameters') or {}).get('keyword_ids') or '')
    keyword_ids, error = keyword_id_list([part for part in raw.split(',') if part.strip()], 'keyword_ids',
                                         MAX_REMOVE_PER_REQUEST)
    if keyword_ids is None:
        return seo_error(400, 'VALIDATION_ERROR', error or 'keyword_ids is invalid', event, 'keyword_ids')
    return _remove_keywords(event, context, keyword_ids=keyword_ids, **kwargs)


@with_tracker()
def _remove_keywords(event: dict[str, Any], _context: Any, *, tracker: Tracker, keyword_ids: list[str],
                     **_kwargs: Any) -> dict[str, Any]:
    return _counted(event, tracker, 'removed', remove_keywords(rank_table(), tracker.tracker_id, keyword_ids))


# ---------------------------------------------------------------------------
# Estimates and runs
# ---------------------------------------------------------------------------

def _estimate_json(every: list[str], tracker: Tracker) -> dict[str, Any]:
    texts = every[:MAX_KEYWORDS]
    device_count = len(device_list(tracker.devices))
    manual = run_estimate(texts, device_count, tracker.depth, 'live')
    scheduled = run_estimate(texts, device_count, tracker.depth, 'queued')
    checks = MONTHLY_CHECKS[tracker.schedule]
    return {
        'keyword_count': len(texts),
        'scope_keyword_count': len(every),
        'max_keywords': MAX_KEYWORDS,
        'pairs': manual.pairs,
        'manual': {'check_usd': manual.check_usd, 'worst_case_usd': manual.worst_case_usd},
        'scheduled': {'check_usd': scheduled.check_usd, 'worst_case_usd': scheduled.worst_case_usd},
        'checks_per_month': checks,
        'monthly_usd': round(scheduled.worst_case_usd * checks, 6),
    }


NEW_TRACKER = Tracker(tracker_id='', domain='', market_id='global', devices='mobile', depth=30, schedule='weekly',
                      created_at='', updated_at='')
"""The defaults a tracker not yet created is estimated with."""


@json_object_body
@validate(ESTIMATE_SCHEMA)
def handle_estimate(event: dict[str, Any], _context: Any, *, body: dict[str, Any], tracker_id: str | None,
                    **settings: Any) -> dict[str, Any]:
    extra, refusal = _requested_keywords(body, settings.get('depth'), event)
    if refusal is not None:
        return refusal
    base = get_tracker(rank_table(), tracker_id) if tracker_id else replace(
        NEW_TRACKER, market_id=resolve_market(settings.get('market_id'))[0])
    if base is None:
        return _not_found(event)
    draft = replace(_edited(base, {**settings, 'schedule': None}), schedule=settings.get('schedule') or base.schedule)
    scope_refusal = _scope_refusal(draft, event)
    if scope_refusal is not None:
        return scope_refusal
    every = list(dict.fromkeys([*(entry.keyword for entry in _selection(draft).every), *extra]))
    return success_response(_estimate_json(every, draft), event)


@with_tracker(active_only=False)
def handle_latest_run(event: dict[str, Any], _context: Any, *, tracker: Tracker, **_kwargs: Any) -> dict[str, Any]:
    return success_response({'run': latest_run_json(rank_table(), tracker.tracker_id)}, event)


@require_group(ADMIN_GROUP)
@with_tracker()
def handle_start_run(event: dict[str, Any], _context: Any, *, tracker: Tracker, **_kwargs: Any) -> dict[str, Any]:
    keywords = _run_keywords(tracker)
    if not keywords:
        return seo_error(400, 'NO_KEYWORDS', 'The tracker has no keywords: add keywords in Settings > Keywords', event)
    estimate = run_estimate([entry.keyword for entry in keywords], len(device_list(tracker.devices)),
                            tracker.depth, 'live')
    run, blocking = begin_run(rank_table(), start_execution, tracker, 'manual', utc_now())
    if run is None:
        return api_response(409, {'error': 'A rank check of this tracker is already running', 'code': 'RUN_ACTIVE',
                                  'run_id': blocking}, event)
    return success_response({'run': run_json(run), 'estimated_cost_usd': estimate.worst_case_usd}, event, 202)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def _about(event: dict[str, Any], tracker: Tracker, **fields: Any) -> dict[str, Any]:
    """A read's answer: the tracker id and ``fields``."""
    return success_response({'tracker_id': tracker.tracker_id, **fields}, event)


@validate(RESULTS_SCHEMA)
@with_tracker()
def handle_results(event: dict[str, Any], _context: Any, *, tracker: Tracker, period: str,
                   **_kwargs: Any) -> dict[str, Any]:
    return success_response(results(rank_table(), tracker, _run_keywords(tracker), period, utc_now()), event)


@validate(HISTORY_SCHEMA)
@with_tracker(active_only=False)
def handle_history(event: dict[str, Any], _context: Any, *, tracker: Tracker, keyword_id: str, days: int,
                   **_kwargs: Any) -> dict[str, Any]:
    points = history(rank_table(), tracker.tracker_id, keyword_id, days, utc_now())
    return _about(event, tracker, keyword_id=keyword_id, depth=tracker.depth, points=points)


@validate(TREND_SCHEMA)
@with_tracker(active_only=False)
def handle_trend(event: dict[str, Any], _context: Any, *, tracker: Tracker, days: int, **_kwargs: Any) -> dict[str, Any]:
    return _about(event, tracker, days=days, points=trend(rank_table(), tracker.tracker_id, days, utc_now()))


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

TRACKER_ROUTES: dict[tuple[str, str | None], Handler] = {
    ('GET', None): handle_detail,
    ('PUT', None): handle_update,
    ('DELETE', None): handle_archive,
    ('POST', 'keywords'): handle_add_keywords,
    ('DELETE', 'keywords'): handle_remove_keywords,
    ('GET', 'runs'): handle_latest_run,
    ('POST', 'runs'): handle_start_run,
    ('GET', 'results'): handle_results,
    ('GET', 'history'): handle_history,
    ('GET', 'trend'): handle_trend,
}
COLLECTION_ROUTES: dict[tuple[str, str | None], Handler] = {
    ('GET', None): handle_list,
    ('POST', None): handle_create,
    ('POST', 'estimate'): handle_estimate,
}


def _route(method: str, path: str) -> tuple[Handler | None, dict[str, str]]:
    """The handler of ``method`` on ``path`` and its path keywords (``tracker_id``)."""
    match = PATH.search(path)
    if match is None:
        return None, {}
    tracker, sub = match.group('tracker'), match.group('sub')
    if tracker is None or (tracker == 'estimate' and sub is None):
        return COLLECTION_ROUTES.get((method, tracker)), {}
    return TRACKER_ROUTES.get((method, sub)), {'tracker_id': tracker}


def dispatch(event: dict[str, Any], context: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
    """Route by method and path below ``/rank-trackers``; an unknown route answers 404, a lost write race 409."""
    handler_func, path_keywords = _route(str(event.get('httpMethod') or 'GET').upper(), str(event.get('path') or ''))
    if handler_func is None:
        return seo_error(404, 'NOT_FOUND', 'Unknown rank tracking route', event)
    try:
        return handler_func(event, context, *args, **path_keywords, **kwargs)
    except StaleWriteError:
        return seo_error(409, 'CONFLICT', 'The tracker changed meanwhile; reload it and try again', event)


handler = seo_route({'GET': dispatch, 'POST': dispatch, 'PUT': dispatch, 'DELETE': dispatch})
