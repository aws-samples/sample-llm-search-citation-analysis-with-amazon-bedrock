"""Run tallies of answers already read, as the windowed reads hand them to the views (``shared.kpi_tally``)."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from shared.kpi_engine import Answer
from shared.kpi_tally import RunTally, run_tallies
from shared.visibility_views import trend_view


def tallies_by_keyword(answers_by_keyword: Mapping[str, Iterable[Answer]], owned_domains: Iterable[str] = ()) -> dict[str, list[RunTally]]:
    """Each keyword's answers as one tally per run, oldest first, citation counts against ``owned_domains``."""
    domains = list(owned_domains)
    return {keyword: run_tallies(keyword, answers, domains) for keyword, answers in answers_by_keyword.items()}


def keyword_run_tallies(answers: Iterable[Answer], keywords: Iterable[str], owned_domains: Iterable[str] = ()) -> list[RunTally]:
    """Every run tally of ``answers``, keyword by keyword (in ``keywords`` order), oldest run first."""
    pool = list(answers)
    by_keyword = {keyword: [answer for answer in pool if answer.keyword == keyword] for keyword in keywords}
    return [tally for tallies in tallies_by_keyword(by_keyword, owned_domains).values() for tally in tallies]


def tallied_trend_view(keywords: list[str], answers: Mapping[str, Iterable[Answer]], period: str, *owned: str | Iterable[str]) -> dict[str, Any]:
    """``trend_view`` of answers already read (owned domains optional): each keyword's answers tallied per run first."""
    domains = list(owned[0]) if owned else []
    return trend_view(keywords, tallies_by_keyword(answers, domains), period, domains)
