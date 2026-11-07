"""The end of a rank check run: what each answer means, the keywords' new state and the run's summary.

Runs once per run, after every re-check, while the run still holds the tracker's lock (so nothing else writes
the tracker's keyword state meanwhile). For each answered pair it decides ``found`` / ``not_found`` /
``not_found_unconfirmed`` (``shared.rank_tracking_retry.final_status``) against the state *before* this run,
then:

- the pair gets its ``result_status`` and its history keys (an unanswered pair gets neither: "not checked");
- the keyword's state keeps the best position ever and, per device, the newest result (an older result never
  replaces a newer one);
- the run's summary holds the trend buckets of each device (top 3 / 4-10 / 11-20 / not ranking / not checked).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from shared.rank_tracking_retry import (
    PairAnswer,
    bucket_counts,
    final_status,
    known_position,
)
from shared.rank_tracking_runs import history_key, pair_answer
from shared.rank_tracking_store import tracker_pk

__all__ = ['FinalizedRun', 'finalize_pairs']

LATEST_FIELDS = ('position', 'rank_absolute', 'url', 'serp_features', 'checked_at')


@dataclass(frozen=True)
class FinalizedRun:
    pairs: list[dict[str, Any]]
    """Answered pairs with their ``result_status`` and history keys."""
    states: list[dict[str, Any]]
    answers: list[PairAnswer]
    summary: dict[str, dict[str, int]]


def _by_keyword(pairs: Sequence[Mapping[str, Any]]) -> dict[str, list[Mapping[str, Any]]]:
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for pair in pairs:
        grouped.setdefault(str(pair['keyword_id']), []).append(pair)
    return grouped


def _min(values: Sequence[int | None]) -> int | None:
    known = [value for value in values if value is not None]
    return min(known) if known else None


def _latest(pair: Mapping[str, Any], status: str, run_id: str) -> dict[str, Any]:
    latest = {key: pair[key] for key in LATEST_FIELDS if pair.get(key) is not None}
    latest.update(status=status, run_id=run_id)
    return latest


def _newer(candidate: Mapping[str, Any], existing: object) -> bool:
    if not isinstance(existing, Mapping):
        return True
    return str(candidate.get('checked_at') or '') >= str(existing.get('checked_at') or '')


@dataclass(frozen=True)
class _Context:
    tracker_id: str
    run_id: str
    now: str


def _finalize_keyword(context: _Context, keyword_id: str, pairs: Sequence[Mapping[str, Any]],
                      state: Mapping[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    answers = {str(pair['device']): pair_answer(pair) for pair in pairs}
    best_before = state.get('best_position')
    best_before = best_before if isinstance(best_before, int) else None
    new_state: dict[str, Any] = {
        **state, 'pk': tracker_pk(context.tracker_id), 'sk': f'STATE#{keyword_id}', 'keyword_id': keyword_id,
        'keyword': pairs[0]['keyword'],
    }
    written: list[dict[str, Any]] = []
    for pair in pairs:
        device = str(pair['device'])
        answer = answers[device]
        if not answer.answered:
            continue
        other = _min([entry.position for name, entry in answers.items() if name != device])
        previous = state.get(device)
        previous_status = previous.get('status') if isinstance(previous, Mapping) else None
        status = final_status(True, answer.position, known_position(best_before, other), previous_status)
        checked_at = str(pair.get('checked_at') or context.now)
        stored = {**pair, 'checked_at': checked_at, 'result_status': status,
                  'gsi1pk': history_key(context.tracker_id, keyword_id), 'gsi1sk': f'{checked_at}#{device}'}
        written.append(stored)
        latest = _latest(stored, str(status), context.run_id)
        if _newer(latest, previous):
            new_state[device] = latest
    best = _min([best_before, *(answer.position for answer in answers.values())])
    if best is not None:
        new_state['best_position'] = best
    return written, new_state


def finalize_pairs(tracker_id: str, run_id: str, now: str, devices: Sequence[str], keywords_total: int,
                   pairs: Sequence[Mapping[str, Any]], states: Mapping[str, Mapping[str, Any]]) -> FinalizedRun:
    """The pairs, keyword states and summary to write at the end of run ``run_id``."""
    context = _Context(tracker_id, run_id, now)
    written: list[dict[str, Any]] = []
    new_states: list[dict[str, Any]] = []
    for keyword_id, keyword_pairs in sorted(_by_keyword(pairs).items()):
        keyword_written, state = _finalize_keyword(context, keyword_id, keyword_pairs, states.get(keyword_id) or {})
        written += keyword_written
        if keyword_written:
            new_states.append(state)
    answers = [pair_answer(pair) for pair in pairs]
    summary = {
        device: bucket_counts([answer.position for answer in answers if answer.device == device and answer.answered],
                              keywords_total)
        for device in devices
    }
    return FinalizedRun(pairs=written, states=new_states, answers=answers, summary=summary)
