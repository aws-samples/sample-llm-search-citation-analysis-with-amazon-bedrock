"""The paid part of a rank check run: live checks, queued posts and the free collection of queued tasks.

Every paid call is made at most once per pair and round: a pair is marked ``sent`` and stored *before* its call,
and only ``pending`` pairs are sent, so a repeated or resumed step never pays for a pair again. A call that
fails leaves the pair unanswered (``error``); the re-check rounds pick it up through the queue.

- Live (manual runs): ``KEYWORDS_PER_BATCH`` keywords at a time, all their devices in parallel, results stored
  per batch. A step stops after ``LIVE_STEP_BUDGET_S`` and the state machine calls it again for the rest.
- Queued (scheduled runs and every re-check round): ``task_post`` in chunks of 100, each task with the round's
  ``pingback_url`` (``shared.dataforseo_callbacks``). A failed post does not stop the others (earlier chunks are
  already paid for and must be collected).
- Collect: once DataForSEO has called back for every queued task (or the wait timed out), free ``task_get`` of at
  most ``TASK_GETS_PER_COLLECT`` queued tasks per step, ``TASK_GET_CONCURRENCY`` at a time. A task still running
  then is left unanswered (``TASK_TIMEOUT``) for the re-check rounds.

Login, balance and configuration failures (``FATAL_CODES``) end the checking at once: every later call would
fail the same way.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_locations import MarketCodes
from shared.dataforseo_rank import (
    POST_PATH,
    TASK_GET_PATH,
    live_rank_check,
    pair_tag,
    rank_check_result,
    rank_task,
)
from shared.dataforseo_tasks import MAX_TASKS_PER_POST, TaskOutcome, get_task, post_tasks
from shared.rank_tracking_runs import apply_check, apply_error, save_items
from shared.rank_tracking_schedule import format_timestamp
from shared.rank_tracking_store import Tracker
from shared.utils import utc_now

__all__ = [
    'FATAL_CODES',
    'KEYWORDS_PER_BATCH',
    'TASK_GETS_PER_COLLECT',
    'CheckProgress',
    'collect_queued',
    'post_pending',
    'run_live',
]

logger = logging.getLogger(__name__)

KEYWORDS_PER_BATCH = 10
LIVE_STEP_BUDGET_S = 600.0
"""Leaves the 15-minute jobs function room to store the last batch."""
TASK_GETS_PER_COLLECT = 500
TASK_GET_CONCURRENCY = 25
FATAL_CODES = frozenset({'NOT_CONFIGURED', 'AUTH_FAILED', 'BILLING_ISSUE'})

_clock = time.monotonic


@dataclass(frozen=True)
class CheckProgress:
    remaining: int
    """Pairs still to send (live, post) or still queued (collect)."""
    fatal_code: str | None = None
    capped: bool = False
    """Collect: the step reached ``TASK_GETS_PER_COLLECT`` with more queued tasks to read."""


def _now() -> str:
    return format_timestamp(utc_now())


def _mark_sent(table: Any, pairs: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    sent = [{**pair, 'status': 'sent'} for pair in pairs]
    save_items(table, sent)
    return sent


def _fail_all(table: Any, pairs: Sequence[Mapping[str, Any]], code: str) -> None:
    save_items(table, [apply_error(pair, code) for pair in pairs])


def _live_one(pair: Mapping[str, Any], tracker: Tracker, codes: MarketCodes) -> tuple[dict[str, Any], str | None]:
    try:
        check, _cost = live_rank_check(str(pair['keyword']), codes, str(pair['device']), tracker.depth, tracker.domain)
    except DataForSeoError as error:
        logger.warning('rank.live failed: code=%s status=%s', error.code, error.provider_status)
        return apply_error(pair, error.code), error.code
    return apply_check(pair, check, _now()), None


def _batches(pairs: Sequence[Mapping[str, Any]]) -> list[list[Mapping[str, Any]]]:
    """Pairs grouped by ``KEYWORDS_PER_BATCH`` keywords (every device of a keyword in the same batch)."""
    batches: list[list[Mapping[str, Any]]] = []
    keywords: list[str] = []
    for pair in pairs:
        if pair['keyword_id'] not in keywords:
            if len(keywords) % KEYWORDS_PER_BATCH == 0:
                batches.append([])
            keywords.append(str(pair['keyword_id']))
        batches[-1].append(pair)
    return batches


def run_live(table: Any, tracker: Tracker, codes: MarketCodes, pairs: Sequence[Mapping[str, Any]]) -> CheckProgress:
    """Live-check the ``pending`` pairs, batch by batch, until done, out of time or a fatal failure."""
    pending = [pair for pair in pairs if pair.get('status') == 'pending']
    started = _clock()
    batches = _batches(pending)
    for index, batch in enumerate(batches):
        if _clock() - started > LIVE_STEP_BUDGET_S:
            return CheckProgress(remaining=sum(len(rest) for rest in batches[index:]))
        sent = _mark_sent(table, batch)
        with ThreadPoolExecutor(max_workers=len(sent)) as pool:
            outcomes = list(pool.map(lambda pair: _live_one(pair, tracker, codes), sent))
        save_items(table, [item for item, _code in outcomes])
        fatal = next((code for _item, code in outcomes if code in FATAL_CODES), None)
        if fatal is not None:
            _fail_all(table, [pair for rest in batches[index + 1:] for pair in rest], fatal)
            return CheckProgress(remaining=0, fatal_code=fatal)
    return CheckProgress(remaining=0)


def _post_chunk(table: Any, tracker: Tracker, codes: MarketCodes, chunk: Sequence[Mapping[str, Any]],
                pingback_url: str | None) -> str | None:
    """Post one chunk; the error code when the whole post failed."""
    sent = _mark_sent(table, chunk)
    tasks = [rank_task(str(pair['keyword']), codes, str(pair['device']), tracker.depth, tracker.domain,
                       tag=pair_tag(str(pair['keyword_id']), str(pair['device']))) for pair in sent]
    try:
        posted = post_tasks(POST_PATH, tasks, pingback_url=pingback_url)
    except DataForSeoError as error:
        logger.warning('rank.post failed: code=%s status=%s', error.code, error.provider_status)
        _fail_all(table, sent, error.code)
        return error.code
    updated = []
    for pair in sent:
        tag = pair_tag(str(pair['keyword_id']), str(pair['device']))
        task_id = posted.accepted.get(tag)
        updated.append({**pair, 'status': 'queued', 'task_id': task_id} if task_id else apply_error(pair, 'REJECTED'))
    save_items(table, updated)
    return None


def post_pending(table: Any, tracker: Tracker, codes: MarketCodes, pairs: Sequence[Mapping[str, Any]],
                 pingback_url: str | None = None) -> CheckProgress:
    """Queue every ``pending`` pair, 100 per post; a failed post does not stop the next one."""
    pending = [pair for pair in pairs if pair.get('status') == 'pending']
    chunks = [pending[start:start + MAX_TASKS_PER_POST] for start in range(0, len(pending), MAX_TASKS_PER_POST)]
    for index, chunk in enumerate(chunks):
        code = _post_chunk(table, tracker, codes, chunk, pingback_url)
        if code in FATAL_CODES:
            _fail_all(table, [pair for rest in chunks[index + 1:] for pair in rest], str(code))
            return CheckProgress(remaining=0, fatal_code=code)
    return CheckProgress(remaining=0)


def _read_task(task_id: str) -> TaskOutcome:
    try:
        return get_task(TASK_GET_PATH, task_id)
    except DataForSeoError as error:
        logger.info('rank.collect poll failed, still pending: code=%s', error.code)
        return TaskOutcome(status='pending', result=None, message=error.code)


def _collected(pair: Mapping[str, Any], outcome: TaskOutcome, domain: str) -> dict[str, Any] | None:
    if outcome.status == 'completed':
        return apply_check(pair, rank_check_result(outcome.result, domain), _now())
    if outcome.status == 'failed':
        return apply_error(pair, 'TASK_FAILED')
    return None


def collect_queued(table: Any, tracker: Tracker, pairs: Sequence[Mapping[str, Any]], last_poll: bool = True,
                   read: Callable[[str], TaskOutcome] = _read_task) -> CheckProgress:
    """Read up to ``TASK_GETS_PER_COLLECT`` queued tasks; on the ``last_poll`` the unfinished are dropped."""
    queued = [pair for pair in pairs if pair.get('status') == 'queued' and pair.get('task_id')]
    batch = queued[:TASK_GETS_PER_COLLECT]
    with ThreadPoolExecutor(max_workers=TASK_GET_CONCURRENCY) as pool:
        outcomes = list(pool.map(lambda pair: read(str(pair['task_id'])), batch))
    changed: list[dict[str, Any]] = []
    still_queued: list[Mapping[str, Any]] = list(queued[TASK_GETS_PER_COLLECT:])
    for pair, outcome in zip(batch, outcomes, strict=True):
        updated = _collected(pair, outcome, tracker.domain)
        if updated is None:
            still_queued.append(pair)
        else:
            changed.append(updated)
    capped = len(queued) > TASK_GETS_PER_COLLECT
    if last_poll and not capped:
        changed += [apply_error(pair, 'TASK_TIMEOUT') for pair in still_queued]
        still_queued = []
    save_items(table, changed)
    return CheckProgress(remaining=len(still_queued), capped=capped)
