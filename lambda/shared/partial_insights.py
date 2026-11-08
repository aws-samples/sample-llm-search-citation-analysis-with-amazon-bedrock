"""
The ``insights`` partial (track S4): one keyword's mergeable fact partials for the insights report.

``build`` turns one keyword's run rows into ``insights_engine.keyword_partial``:
per engine the additive KPI counts (``kpi_tally``) and per first-party brand
its counts, the keyword's prompt-by-engine row, its citations by owner and
owned page, and its competitor sightings. ``merge`` is
``insights_engine.merge_partials``. The rules stay in ``insights_engine`` /
``insights_citations``; this only makes their inputs additive across keywords.
"""

from __future__ import annotations

from shared.insights_citations import competitor_domains_from
from shared.insights_engine import keyword_partial, merge_partials
from shared.kpi_engine import answers_from_rows, owned_domains_from
from shared.partial_contract import Partial, PartialConfig, RunRows

PREVIOUS_RUN = False


def build(rows: RunRows, config: PartialConfig) -> Partial | None:
    """The keyword's fact partial of this run; ``None`` when the run holds no answer."""
    answers = answers_from_rows(rows)
    if not answers:
        return None
    brand_config = config.brand_config
    return keyword_partial(answers[0].keyword, answers, owned_domains_from(brand_config), competitor_domains_from(brand_config))


def merge(acc: Partial | None, part: Partial) -> Partial:
    """``acc`` with one keyword's partial added (sums; the prompt rows keep the weakest 50)."""
    return merge_partials(acc, part)


__all__ = ['PREVIOUS_RUN', 'build', 'merge']
