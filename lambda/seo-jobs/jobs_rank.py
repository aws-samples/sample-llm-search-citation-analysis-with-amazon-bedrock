"""Rank tracking steps of the SEO jobs function (``rank.*``), run by ``CitationAnalysis-SeoRankCheck``.

The state machine carries only ``{tracker_id, run_id, round, wait_index, wait_seconds, next}``; keywords, pairs
and results stay in DynamoDB (Step Functions caps state at 256 KiB). A task sends it as
``{"step": "rank.<name>", "state": {...}}``; every step returns that small state with ``next`` naming where the
state machine goes:

- ``rank.prepare``: refuse a run that is no longer pending (``stop``); fail it when the tracker is archived, its
  market cannot be checked or it has no keywords; else write one pending pair per keyword and device and mark
  the run running. ``next`` = ``live`` (manual runs) or ``queued`` (scheduled runs).
- ``rank.live``: live checks (paid; never retried by the state machine). ``next`` = ``live`` while pairs remain
  after the step's time budget, ``finalize`` after a login / balance failure, else ``retry``.
- ``rank.post``: queue the pending pairs (paid; never retried). ``next`` = ``wait`` (with the first wait) or
  ``retry`` when nothing was queued, ``finalize`` after a login / balance failure.
- ``rank.collect``: free polls. ``next`` = ``collect`` (more than one step's worth queued), ``wait`` (with the
  next wait) or ``retry`` after the last poll.
- ``rank.plan_retry``: choose the pairs to re-check (``shared.rank_tracking_retry``); ``next`` = ``queued``
  for another round, else ``finalize``.
- ``rank.finalize``: store what each answer means, the keyword state and the summary; end the run as
  ``completed`` / ``partial`` / ``failed`` and free the tracker.
- ``rank.fail``: the state machine's catch-all; fails a still-active run and frees the tracker.
- ``rank.tick``: the scheduler (``shared.rank_tracking_scheduler``), run by an EventBridge rule.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import suppress
from dataclasses import replace
from typing import Any

from shared.dataforseo_locations import UnsupportedMarketError
from shared.dataforseo_rank import RETRY_ROUNDS
from shared.rank_tracking_checks import QUEUED_WAITS_S, CheckProgress, collect_queued, post_pending, run_live
from shared.rank_tracking_finalize import finalize_pairs
from shared.rank_tracking_retry import retry_keywords, run_outcome
from shared.rank_tracking_runs import (
    fail_run,
    get_run,
    load_pairs,
    load_states,
    pair_answer,
    release_lock,
    save_items,
    set_run_status,
    write_pairs,
)
from shared.rank_tracking_runtime import UnknownMarketError, keywords_table, market_codes_for, start_execution
from shared.rank_tracking_schedule import format_timestamp
from shared.rank_tracking_scheduler import tick
from shared.rank_tracking_store import (
    StaleWriteError,
    Tracker,
    get_tracker,
    put_tracker,
    rank_table,
    resolve_run_keywords,
)
from shared.utils import utc_now

logger = logging.getLogger(__name__)

TRACKER_WRITE_ATTEMPTS = 3


class MissingTrackerError(LookupError):
    """The run's tracker does not exist."""


def _state(event: dict[str, Any], next_step: str, **changes: Any) -> dict[str, Any]:
    keys = ('tracker_id', 'run_id', 'round', 'wait_index', 'wait_seconds')
    state = {key: event[key] for key in keys if key in event}
    state.setdefault('round', 0)
    return {**state, **changes, 'next': next_step}


def _tracker(event: dict[str, Any]) -> Tracker:
    tracker = get_tracker(rank_table(), str(event['tracker_id']))
    if tracker is None:
        raise MissingTrackerError(event['tracker_id'])
    return tracker


def _stop(event: dict[str, Any], code: str, message: str) -> dict[str, Any]:
    fail_run(rank_table(), str(event['tracker_id']), str(event['run_id']), code, message, utc_now())
    return _state(event, 'stop')


def prepare(event: dict[str, Any]) -> dict[str, Any]:
    table = rank_table()
    run = get_run(table, str(event['tracker_id']), str(event['run_id']))
    if run is None or run.get('status') != 'pending':
        return _state(event, 'stop')
    tracker = get_tracker(table, str(event['tracker_id']))
    if tracker is None or not tracker.is_active:
        return _stop(event, 'ARCHIVED', 'The tracker has been archived.')
    try:
        market_codes_for(tracker.market_id)
    except (UnknownMarketError, UnsupportedMarketError):
        return _stop(event, 'UNSUPPORTED_MARKET', 'The tracker market cannot be checked.')
    keywords = resolve_run_keywords(table, keywords_table(), tracker)
    if not keywords:
        return _stop(event, 'NO_KEYWORDS', 'The tracker has no keywords.')
    write_pairs(table, tracker, str(run['run_id']), keywords)
    set_run_status(table, run, ('pending',), status='running', keywords_total=len(keywords))
    return _state(event, 'live' if run.get('method') == 'live' else 'queued', round=0)


def _checked(event: dict[str, Any], check: Callable[..., CheckProgress]) -> CheckProgress:
    """Run a paid check step (``run_live`` / ``post_pending``) over the run's pairs."""
    tracker = _tracker(event)
    table = rank_table()
    return check(table, tracker, market_codes_for(tracker.market_id), load_pairs(table, str(event['run_id'])))


def live(event: dict[str, Any]) -> dict[str, Any]:
    progress = _checked(event, run_live)
    if progress.fatal_code:
        return _state(event, 'finalize')
    return _state(event, 'live' if progress.remaining else 'retry')


def post(event: dict[str, Any]) -> dict[str, Any]:
    if _checked(event, post_pending).fatal_code:
        return _state(event, 'finalize')
    if not any(pair.get('status') == 'queued' for pair in load_pairs(rank_table(), str(event['run_id']))):
        return _state(event, 'retry')
    return _state(event, 'wait', wait_index=0, wait_seconds=QUEUED_WAITS_S[0])


def collect(event: dict[str, Any]) -> dict[str, Any]:
    tracker = _tracker(event)
    table = rank_table()
    wait_index = int(event.get('wait_index') or 0)
    last_poll = wait_index >= len(QUEUED_WAITS_S) - 1
    progress = collect_queued(table, tracker, load_pairs(table, str(event['run_id'])), last_poll)
    if progress.capped:
        return _state(event, 'collect')
    if progress.remaining and not last_poll:
        return _state(event, 'wait', wait_index=wait_index + 1, wait_seconds=QUEUED_WAITS_S[wait_index + 1])
    return _state(event, 'retry')


def plan_retry(event: dict[str, Any]) -> dict[str, Any]:
    round_number = int(event.get('round') or 0)
    if round_number >= RETRY_ROUNDS:
        return _state(event, 'finalize')
    table = rank_table()
    pairs = load_pairs(table, str(event['run_id']))
    states = load_states(table, str(event['tracker_id']))
    best = {keyword_id: state.get('best_position') for keyword_id, state in states.items()}
    seen = {keyword_id for keyword_id, state in states.items() if 'desktop' in state or 'mobile' in state}
    chosen = set(retry_keywords([pair_answer(pair) for pair in pairs], best, seen))
    if not chosen:
        return _state(event, 'finalize')
    save_items(table, [{**pair, 'status': 'pending'} for pair in pairs if pair['keyword_id'] in chosen])
    logger.info('rank.plan_retry round=%d keywords=%d', round_number + 1, len(chosen))
    return _state(event, 'queued', round=round_number + 1)


def _first_error(pairs: list[dict[str, Any]]) -> str | None:
    return next((str(pair['error_code']) for pair in pairs if pair.get('error_code') and not pair.get('answered')),
                None)


def _mark_checked(tracker_id: str, checked_at: str) -> None:
    """Record a finished run on the tracker; re-read and retry when an edit raced the write."""
    table = rank_table()
    for _attempt in range(TRACKER_WRITE_ATTEMPTS):
        tracker = get_tracker(table, tracker_id)
        if tracker is None:
            return
        with suppress(StaleWriteError):
            put_tracker(table, replace(tracker, last_checked_at=checked_at, last_skip_reason=None), tracker.version)
            return
    logger.warning('rank.finalize could not record last_checked_at on %s', tracker_id)


def finalize(event: dict[str, Any]) -> dict[str, Any]:
    table = rank_table()
    tracker_id, run_id = str(event['tracker_id']), str(event['run_id'])
    run = get_run(table, tracker_id, run_id)
    if run is None or run.get('status') != 'running':
        release_lock(table, tracker_id, run_id)
        return _state(event, 'stop')
    now = format_timestamp(utc_now())
    devices = [str(device) for device in run.get('devices') or []]
    total = int(run.get('keywords_total') or 0)
    pairs = load_pairs(table, run_id)
    finalized = finalize_pairs(tracker_id, run_id, now, devices, total, pairs, load_states(table, tracker_id))
    first_error = _first_error(pairs)
    outcome = run_outcome(finalized.answers, devices, total, first_error)
    save_items(table, finalized.pairs)
    save_items(table, finalized.states)
    set_run_status(table, run, ('running',), status=outcome.status, checked=outcome.checked,
                   keywords_checked=outcome.keywords_checked, error_message=outcome.error_message,
                   error_code=first_error if outcome.status == 'failed' else None, summary=finalized.summary,
                   completed_at=now)
    if outcome.status != 'failed':
        _mark_checked(tracker_id, now)
    release_lock(table, tracker_id, run_id)
    return _state(event, 'stop', status=outcome.status)


def fail(event: dict[str, Any]) -> dict[str, Any]:
    return _stop(event, 'WORKFLOW_FAILED', 'The rank check stopped unexpectedly.')


def scheduler_tick(_event: dict[str, Any]) -> dict[str, Any]:
    return tick(rank_table(), keywords_table(), start_execution, utc_now())


Step = Callable[[dict[str, Any]], dict[str, Any]]


def _from_state_machine(step: Step) -> Step:
    """``step`` called with the run state a task sends under ``state`` (or with the event itself)."""
    def run(event: dict[str, Any]) -> dict[str, Any]:
        state = event.get('state')
        return step(state if isinstance(state, dict) else event)

    return run


STEPS: dict[str, Step] = {
    'rank.prepare': _from_state_machine(prepare),
    'rank.live': _from_state_machine(live),
    'rank.post': _from_state_machine(post),
    'rank.collect': _from_state_machine(collect),
    'rank.plan_retry': _from_state_machine(plan_retry),
    'rank.finalize': _from_state_machine(finalize),
    'rank.fail': _from_state_machine(fail),
    'rank.tick': scheduler_tick,
}
