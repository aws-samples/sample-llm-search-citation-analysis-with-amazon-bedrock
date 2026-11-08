"""Whether two runs can be compared like for like, and on which answers.

A change between two runs only means something when both measured the same
thing. Each answer belongs to a **cell**: (keyword, persona, AI engine,
market). Enabling an engine, adding a persona or a keyword adds cells that
the earlier run never had; comparing the pooled values would read that change
of mix as a change of visibility. So a comparison keeps only the cells
answered in both runs, and says why when there is nothing fair to compare:

- ``no_previous``: there is no earlier run measured with the same definitions;
- ``scope_changed``: the two runs share no answered cell;
- ``incomplete``: either run answered fewer than ``MIN_ANSWERED_SHARE`` % of
  the answers it planned (failed calls leave holes that are not random);
- ``comparable``: a change may be shown.

Rows are filtered by ``branded`` first: by default only neutral answers
(queries that do not name the brand) are compared, since a branded query
mentions the brand almost by construction.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from shared.config import LLM_PROVIDERS
from shared.kpi_engine import NO_ANSWER, Answer, answer_from_row, filter_branded, percent

COMPARABLE = 'comparable'
SCOPE_CHANGED = 'scope_changed'
INCOMPLETE = 'incomplete'
NO_PREVIOUS = 'no_previous'
#: Every comparison state, in the order they are checked after ``no_previous``.
COMPARISON_STATES: tuple[str, ...] = (NO_PREVIOUS, SCOPE_CHANGED, INCOMPLETE, COMPARABLE)

#: A run that answered less than this share (in %) of its planned answers is incomplete.
MIN_ANSWERED_SHARE = 90.0

#: The rows compared by default: answers to queries that do not name the brand.
DEFAULT_COMPARISON_FILTER = 'neutral'

#: (keyword, persona, engine, market): the identity of one answer across runs.
Cell = tuple[str, str, str, str]


def answer_cell(answer: Answer) -> Cell:
    """The cell of one answer."""
    return (answer.keyword, answer.persona, answer.provider, answer.market_id)


def _branded_row(row: Mapping[str, Any], branded: str) -> bool:
    if branded == 'all':
        return True
    return (row.get('branded') is True) is (branded == 'branded')


def answered_share(rows: Iterable[Mapping[str, Any]], branded: str = DEFAULT_COMPARISON_FILTER) -> float | None:
    """The share (%) of a run's planned answers that the engines answered; ``None`` when nothing was planned.

    Planned answers are the answer-engine rows the run wrote, whatever their
    status. An engine that replied without an answer (``no_answer``, such as a
    results page without an AI Overview) did answer; a failed call did not.
    """
    statuses = [
        row.get('status', 'success') for row in rows
        if row.get('provider') in LLM_PROVIDERS and _branded_row(row, branded)
    ]
    return percent(sum(status in ('success', NO_ANSWER) for status in statuses), len(statuses))


@dataclass(frozen=True)
class PeriodComparison:
    """The comparison of two runs: its state and, when there are any, the answers of the matched cells."""

    state: str
    matched_cells: int = 0
    previous: tuple[Answer, ...] = ()
    current: tuple[Answer, ...] = ()
    answered_share: dict[str, float | None] = field(default_factory=dict)
    """``{'previous': %, 'current': %}`` of the compared rows (see ``answered_share``)."""

    def to_json(self) -> dict[str, Any]:
        """The stored form: the state, the matched cells and both runs' answered shares."""
        return {'state': self.state, 'matched_cells': self.matched_cells, 'answered_share': dict(self.answered_share)}


def _answers(rows: Iterable[Mapping[str, Any]], branded: str) -> dict[Cell, Answer]:
    answers = filter_branded(filter(None, map(answer_from_row, rows)), branded)
    return {answer_cell(answer): answer for answer in answers}


def compare_runs(
    previous_rows: Iterable[Mapping[str, Any]] | None,
    current_rows: Iterable[Mapping[str, Any]],
    branded: str = DEFAULT_COMPARISON_FILTER,
) -> PeriodComparison:
    """Compare two runs' SearchResults rows on the cells answered in both (see the module docstring).

    ``previous_rows`` is ``None`` when there is no comparable earlier run.
    The matched answers are returned for ``comparable`` only.
    """
    if previous_rows is None:
        return PeriodComparison(NO_PREVIOUS)
    before_rows, after_rows = list(previous_rows), list(current_rows)
    shares = {'previous': answered_share(before_rows, branded), 'current': answered_share(after_rows, branded)}
    before, after = _answers(before_rows, branded), _answers(after_rows, branded)
    matched = sorted(before.keys() & after.keys())
    if not matched:
        return PeriodComparison(SCOPE_CHANGED, answered_share=shares)
    if any(share is None or share < MIN_ANSWERED_SHARE for share in shares.values()):
        return PeriodComparison(INCOMPLETE, len(matched), answered_share=shares)
    return PeriodComparison(
        COMPARABLE,
        len(matched),
        previous=tuple(before[cell] for cell in matched),
        current=tuple(after[cell] for cell in matched),
        answered_share=shares,
    )


def answers_by_keyword(answers: Iterable[Answer]) -> dict[str, list[Answer]]:
    """``answers`` grouped by keyword, keywords in first-seen order."""
    grouped: dict[str, list[Answer]] = {}
    for answer in answers:
        grouped.setdefault(answer.keyword, []).append(answer)
    return grouped


__all__ = [
    'COMPARABLE',
    'COMPARISON_STATES',
    'DEFAULT_COMPARISON_FILTER',
    'INCOMPLETE',
    'MIN_ANSWERED_SHARE',
    'NO_PREVIOUS',
    'SCOPE_CHANGED',
    'Cell',
    'PeriodComparison',
    'answer_cell',
    'answered_share',
    'answers_by_keyword',
    'compare_runs',
]
