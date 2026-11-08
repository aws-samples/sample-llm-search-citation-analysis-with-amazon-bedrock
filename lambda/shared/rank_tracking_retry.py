"""Which rank checks are re-checked, which answer is kept, and what a run's results mean.

Google sometimes serves a scraped search a normal-looking page that leaves out sites that really rank. So after
the first pass a (keyword, device) pair is re-checked, through the cheaper queue, up to ``RETRY_ROUNDS`` times
when:

- it was never answered (the call failed or the task never finished);
- the keyword ranked before (``known_position``: its best position in earlier runs on any device, or this run's
  position on the other device) and this check missed it or found it ``RETRY_DROP_POSITIONS`` or more places
  lower;
- the keyword never had a result before and this first check missed it.

When one device of a keyword needs a re-check both are re-checked, since a find on one device makes the
other device's miss suspect. A re-check replaces the stored answer only when it is better (found, or found
higher), or when the pair had no answer yet: the best position found wins.

After the re-checks a miss is ``not_found`` only when the keyword never ranked, or when the previous run's
answer for that device was already a miss (two runs in a row). Otherwise it is ``not_found_unconfirmed``:
stored and shown, so a real drop is visible, but not reported as lost on the strength of one results page.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

__all__ = [
    'BUCKETS',
    'RETRY_DROP_POSITIONS',
    'PairAnswer',
    'ResultStatus',
    'RunOutcome',
    'bucket_counts',
    'final_status',
    'is_better',
    'known_position',
    'needs_retry',
    'retry_keywords',
    'run_outcome',
]

RETRY_DROP_POSITIONS = 10

ResultStatus = Literal['found', 'not_found', 'not_found_unconfirmed']
MISS_STATUSES = frozenset({'not_found', 'not_found_unconfirmed'})
BUCKETS = ('top3', 'top4_10', 'top11_20', 'not_ranking', 'not_checked')


@dataclass(frozen=True)
class PairAnswer:
    """What a run holds for one (keyword, device) pair."""

    keyword_id: str
    device: str
    answered: bool
    position: int | None


def _min_position(*positions: int | None) -> int | None:
    known = [position for position in positions if position is not None]
    return min(known) if known else None


def known_position(best_before: int | None, other_device_position: int | None) -> int | None:
    """The position the keyword is known to reach: its best earlier result or this run's other device."""
    return _min_position(best_before, other_device_position)


def needs_retry(pair: PairAnswer, known: int | None, first_check: bool) -> bool:
    """Whether ``pair``'s answer is suspicious enough to check again."""
    if not pair.answered:
        return True
    if known is None:
        return first_check and pair.position is None
    return pair.position is None or pair.position - known >= RETRY_DROP_POSITIONS


def _by_keyword(pairs: Iterable[PairAnswer]) -> dict[str, dict[str, PairAnswer]]:
    grouped: dict[str, dict[str, PairAnswer]] = {}
    for pair in pairs:
        grouped.setdefault(pair.keyword_id, {})[pair.device] = pair
    return grouped


def _other_position(devices: Mapping[str, PairAnswer], device: str) -> int | None:
    return _min_position(*(pair.position for name, pair in devices.items() if name != device))


def retry_keywords(pairs: Iterable[PairAnswer], best_before: Mapping[str, int | None],
                   seen_before: set[str]) -> list[str]:
    """The keyword ids to re-check (every device of each), in keyword-id order.

    ``best_before`` is each keyword's best earlier position on any device; ``seen_before`` the keywords with
    any earlier result.
    """
    chosen: list[str] = []
    for keyword_id, devices in sorted(_by_keyword(pairs).items()):
        first_check = keyword_id not in seen_before
        for device, pair in devices.items():
            known = known_position(best_before.get(keyword_id), _other_position(devices, device))
            if needs_retry(pair, known, first_check):
                chosen.append(keyword_id)
                break
    return chosen


def is_better(answered: bool, current: int | None, new: int | None) -> bool:
    """Whether a re-check answer ``new`` replaces the stored ``current`` one."""
    if not answered:
        return True
    return new is not None and (current is None or new < current)


def final_status(answered: bool, position: int | None, known: int | None,
                 previous_status: str | None) -> ResultStatus | None:
    """The stored meaning of a pair's final answer; ``None`` = not checked (no result is stored)."""
    if not answered:
        return None
    if position is not None:
        return 'found'
    if known is None or previous_status in MISS_STATUSES:
        return 'not_found'
    return 'not_found_unconfirmed'


def bucket_counts(positions: Iterable[int | None], keywords_total: int) -> dict[str, int]:
    """Trend buckets of one device's answered positions (``None`` = checked, not found)."""
    counts: dict[str, int] = dict.fromkeys(BUCKETS, 0)
    answered = 0
    for position in positions:
        answered += 1
        if position is not None and position <= 3:
            counts['top3'] += 1
        elif position is not None and position <= 10:
            counts['top4_10'] += 1
        elif position is not None and position <= 20:
            counts['top11_20'] += 1
        else:
            counts['not_ranking'] += 1
    counts['not_checked'] = max(0, keywords_total - answered)
    return counts


@dataclass(frozen=True)
class RunOutcome:
    """How a run ended."""

    status: Literal['completed', 'partial', 'failed']
    checked: dict[str, int]
    """Answered keywords per device."""
    keywords_checked: int
    error_message: str | None


def run_outcome(pairs: Sequence[PairAnswer], devices: Sequence[str], keywords_total: int,
                first_error: str | None) -> RunOutcome:
    """``failed`` when nothing was checked, ``partial`` when a device is missing answers, else ``completed``."""
    answered = [pair for pair in pairs if pair.answered]
    checked = {device: sum(1 for pair in answered if pair.device == device) for device in devices}
    keywords_checked = len({pair.keyword_id for pair in answered})
    if keywords_total > 0 and keywords_checked == 0:
        return RunOutcome('failed', checked, 0, first_error or 'No keywords could be checked.')
    if any(count < keywords_total for count in checked.values()):
        detail = ' and '.join(f'{checked[device]} of {keywords_total} {device}' for device in devices)
        suffix = f': {first_error}' if first_error else ''
        return RunOutcome('partial', checked, keywords_checked, f'Checked {detail} keyword(s){suffix}')
    return RunOutcome('completed', checked, keywords_checked, None)
