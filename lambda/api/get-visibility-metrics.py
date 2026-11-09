"""
Visibility Metrics API — GET /api/visibility

Where the brand stands now in a scope (exactly one of ``keyword=``,
``group_id=``, ``keyword_ids=`` or ``scope=all``): every KPI of
``docs/kpi-definitions.md`` over each keyword's latest analysis run, pooled,
its change since each keyword's previous run (like for like), the brand
leaderboard of those answers, and a row per keyword. One response shape for
every scope; formulas in ``shared.kpi_engine``.

Optional: ``query_prompt_id`` keeps one persona's answers of the latest run;
``brand`` narrows the leaderboard to matching brand names.
"""

from typing import Any

from shared.answer_queries import query_last_two_runs_rows
from shared.api_response import success_response
from shared.brand_visibility import tracked_brand_names
from shared.decorators import api_handler, validate
from shared.kpi_engine import BRANDED_FILTERS, Answer, answers_from_rows, filter_branded, owned_domains_from
from shared.scope_params import (
    BRAND_FILTER_PARAMS,
    PERSONA_FILTER_PARAMS,
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    scoped_dynamodb_resource,
)
from shared.scoped_reports import capped_scope, read_scope_keywords, required_report_scope, scope_read_fields
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config
from shared.visibility_views import visibility_view

# One latest-run read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()


def load_last_two_runs(keywords: list[str]) -> tuple[dict[str, list[Answer]], dict[str, list[Answer]], tuple[str, ...]]:
    """Each keyword's answers in its latest run and in the run before, read in parallel, and the keywords left unread.

    A keyword whose read fails has no answers (logged by ``map_scope_keywords``):
    one broken partition must not sink the whole view. A keyword the time
    budget left unread is in neither map.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    runs = read_scope_keywords(
        keywords,
        lambda keyword: tuple(answers_from_rows(rows) for rows in query_last_two_runs_rows(table, keyword)),
        lambda _keyword: ([], []),
    )
    latest = {keyword: answers[0] for keyword, answers in runs.values.items()}
    previous = {keyword: answers[1] for keyword, answers in runs.values.items()}
    return latest, previous, runs.skipped


def _unclassified_keywords(run: dict[str, list[Answer]]) -> list[str]:
    """The keywords whose run holds an answer stored before the branded flag existed."""
    return [keyword for keyword, answers in run.items() if any(not answer.branded_classified for answer in answers)]


def scope_visibility(
    scope: ReportScope,
    owned_domains: list[str],
    *,
    persona: str | None,
    brand: str | None,
    branded: str = 'all',
    tracked_brands: list[str] | None = None,
) -> dict[str, Any]:
    """The visibility view of ``scope``, capped at ``SCOPE_KEYWORDS_CAP`` keywords and the request's time budget.

    A keyword the budget stopped is missing from ``keywords`` and from the
    pooled KPIs; ``keywords_truncated`` then says the view is partial.
    """
    keywords, scope_fields = capped_scope(scope)
    latest_run, previous_run, skipped = load_last_two_runs(keywords)
    latest, previous = (
        {keyword: filter_branded(answers, branded) for keyword, answers in run.items()}
        for run in (latest_run, previous_run)
    )
    # Like for like: a filtered view compares a keyword with its previous run only when that run's rows were
    # classified (2.43+). An older run reads every answer as neutral, so its delta would mix two definitions.
    unclassified = _unclassified_keywords(previous_run) if branded != 'all' else []
    for keyword in unclassified:
        previous[keyword] = []
    view = visibility_view(
        list(latest), latest, owned_domains, previous_by_keyword=previous, persona=persona, brand=brand,
        tracked_brands=tracked_brands or (),
    )
    return {
        **scope_read_fields(scope_fields, skipped),
        'branded': branded,
        'change_unclassified_keywords': len(unclassified),
        # Keywords whose latest run predates the flag: a filtered view reads their answers as neutral, so it says so.
        'unclassified_keywords': len(_unclassified_keywords(latest_run)) if branded != 'all' else 0,
        'citations_configured': bool(owned_domains),
        **view,
    }


@api_handler
@validate({
    'branded': {'type': str, 'choices': list(BRANDED_FILTERS), 'default': 'all'},
    **SCOPE_QUERY_PARAMS,
    **BRAND_FILTER_PARAMS,
    **PERSONA_FILTER_PARAMS,
})
@required_report_scope(lambda: dynamodb.Table(KEYWORDS_TABLE))
def handler(event, context, report_scope, brand=None, query_prompt_id=None, branded='all'):
    """GET /api/visibility — the KPIs of a scope's latest runs (see the module docstring).

    ``branded`` (``neutral`` | ``branded`` | ``all``, default ``all``) keeps the
    answers to queries that do not name the brand, that do, or every answer.
    """
    config = get_brand_config()
    first_party, competitors = tracked_brand_names(config)
    return success_response(
        scope_visibility(
            report_scope, owned_domains_from(config), persona=query_prompt_id, brand=brand, branded=branded,
            tracked_brands=[*first_party, *competitors],
        ),
        event,
    )
