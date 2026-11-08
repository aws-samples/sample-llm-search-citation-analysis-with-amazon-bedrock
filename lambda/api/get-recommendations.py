"""
Recommendations API — GET /api/recommendations (the Action Center)

Actionable recommendations to improve AI visibility: the rules of
``shared.recommendation_rules`` over every keyword's **latest run**
(visibility gaps, low rankings, provider gaps, competitor dominance, and a
best practice when the rules find little to say), most urgent first, and
optionally a few written by an LLM.

For any report scope (every active keyword without one), complete since
2.45.0 and paged: ``limit`` a page, ``next_token`` for the next, ``total``
(and ``total_count``) and ``by_priority`` over the whole list; the
action-tracking status is joined per page. Live or from the
``recommendations`` artifact, per ``shared.action_scope_serve``.

``use_llm=true`` (first page only) asks a fast-tier model for 3-5 more, from
the page's top five and the ``LLM_PROMPT_KEYWORDS`` keywords a
recommendation would move most (the brand missing, the most competitor
mentions, the worst rank), bounded by the request's deadline.
"""

import json
import logging
import sys
from collections.abc import Sequence
from typing import Any, Literal

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.action_scope_serve import (
    LiveLatests,
    action_list_endpoint,
    action_request,
    limit_param,
    read_live_latests,
    serve_action_list,
)
from shared.answer_queries import query_latest_run_rows
from shared.api_response import success_response
from shared.artifact_recommendations import LLM_PROMPT_KEYWORDS
from shared.brand_visibility import tracked_brand_names
from shared.decorators import api_handler
from shared.llm_json import parse_llm_json
from shared.models import BedrockDeadlineError, ModelRole, invoke_bedrock
from shared.partial_contract import PartialConfig
from shared.recommendation_rules import CONFIGURATION_RECOMMENDATION, by_priority, rule_recommendations
from shared.request_deadline import current_deadline
from shared.scope_params import (
    ReportScope,
    all_active_scope,
    keywords_table_name,
    load_sibling_function,
    scoped_dynamodb_resource,
)
from shared.search_results import search_results_table_name
from shared.snapshot_artifacts import coverage, live_envelope, with_scope_contract
from shared.utils import get_brand_config, get_timestamp, recommendation_id

SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()
dynamodb = scoped_dynamodb_resource()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: Recommendations per page by default, and at most (``limit``).
DEFAULT_LIMIT = 50
MAX_LIMIT = 200

# ``get-reports-overview.py`` loads ``generate_rule_based_recommendations`` by name (a hyphenated sibling).
__all__ = ['generate_rule_based_recommendations', 'handler']

# The LLM pass's role: a fast tier (Haiku by default), so the call fits the request.
LLM_RECOMMENDATIONS_ROLE = ModelRole.GENERATION

# How the LLM pass of a ``use_llm=true`` request went (``llm`` in the response; null when not asked).
LlmOutcome = Literal['ok', 'timed_out', 'failed']


def _live_read(keywords: Sequence[str], config: dict[str, Any]) -> LiveLatests:
    """Every keyword's latest run, turned into its ``actions`` partial (the findings the rules read)."""
    return read_live_latests(keywords, dynamodb.Table(SEARCH_RESULTS_TABLE), PartialConfig(brand_config=config), ('actions',), query_latest_run_rows)


def generate_rule_based_recommendations(config: dict[str, Any], keywords: list[str] | None = None) -> list[dict[str, Any]]:
    """The rules over ``keywords``' latest runs (every active keyword by default), read for this request.

    The executive summary (``get-reports-overview.py``) takes its top
    recommendations from here; the keywords the time budget leaves unread
    are left out.
    """
    if not tracked_brand_names(config)[0]:
        return [dict(CONFIGURATION_RECOMMENDATION)]
    scope_keywords = keywords if keywords is not None else list(all_active_scope(dynamodb.Table(KEYWORDS_TABLE)).keywords)
    return rule_recommendations(_findings(_live_read(scope_keywords, config)))


def _findings(read: LiveLatests) -> list[dict[str, Any]]:
    """The recommendation-rule finding of every keyword read with a latest run."""
    findings = []
    for latest in read.latests:
        run = latest['latest']
        part = run['parts'].get('actions') if run is not None else None
        if part is not None and part.get('findings') is not None:
            findings.append(part['findings'])
    return findings


def _llm_prompt(config: dict[str, Any], context: str, keywords: Sequence[str], keywords_total: int) -> str:
    scope_section = ''
    if keywords:
        listed = '\n'.join(f'- {keyword}' for keyword in keywords)
        more = keywords_total - len(keywords)
        listed += f'\n- … and {more} more keywords' if more > 0 else ''
        scope_section = f'Keywords In Scope (recommend for these only):\n{listed}\n\n'
    return f"""Analyze this AI visibility data and provide 3-5 specific, actionable recommendations.

Context:
{context}

{scope_section}Brand Configuration:
- First Party Brands: {config.get('tracked_brands', {}).get('first_party', [])}
- Competitors: {config.get('tracked_brands', {}).get('competitors', [])}
- Industry: {config.get('industry', 'general')}

Provide recommendations in this JSON format:
[
  {{
    "type": "category",
    "priority": "high/medium/low",
    "title": "Short title",
    "description": "Detailed description",
    "action": "Specific action to take",
    "impact": "Expected impact"
  }}
]

Focus on:
1. Quick wins that can improve visibility immediately
2. Strategic moves to outperform competitors
3. Content and citation opportunities
4. Provider-specific optimizations"""


def generate_llm_recommendations(
    config: dict[str, Any], context: str, keywords: Sequence[str] = (), keywords_total: int = 0,
) -> tuple[list[dict[str, Any]], LlmOutcome]:
    """
    Generate recommendations using LLM for more sophisticated analysis.

    ``keywords`` are the scope's highest-impact keywords (at most
    ``LLM_PROMPT_KEYWORDS``, from the stored or live list), named in the prompt
    so the model recommends for that scope only; ``keywords_total`` is the
    scope's size, the rest counted as "… and N more".

    The call runs on a fast-tier role without thinking, bounded by the
    request's deadline. Returns the recommendations and how the pass went:
    ``ok``, ``timed_out`` (the model did not answer in time) or ``failed``;
    the handler keeps the rule-based list either way.
    """
    try:
        prompt = _llm_prompt(config, context, keywords, keywords_total)
        content = invoke_bedrock(
            prompt, LLM_RECOMMENDATIONS_ROLE, max_tokens=2000, thinking=False, deadline=current_deadline(),
        )
        # Parse JSON array via shared helper; with expect="array" it yields a list or None.
        parsed = parse_llm_json(content, expect="array")
        if isinstance(parsed, list):
            return parsed, 'ok'

    except BedrockDeadlineError:
        logger.warning('LLM recommendations ran out of time; answering the rule-based list')
        return [], 'timed_out'
    except Exception:
        logger.exception("LLM recommendation error")

    return [], 'failed'


def _annotate_with_status(recommendations: list[dict[str, Any]]) -> None:
    """
    Mutate each recommendation in place to add `id` + persisted status.

    The id is the same hash that `recommendation-status.py` looks up in
    DynamoDB. The status fields are merged in when a status row exists;
    otherwise the recommendation gets `status: 'new'` so the response
    shape stays consistent for the frontend.

    Failure to load the status table is non-fatal: the recommendations
    are still surfaced, just without per-row tracking. The failure is
    logged with its traceback.
    """
    for rec in recommendations:
        rec['id'] = recommendation_id(rec)

    rec_ids = [r['id'] for r in recommendations]
    statuses: dict[str, dict[str, Any]] = {}

    if rec_ids:
        try:
            # Loaded lazily, the way the report aggregators load their sibling
            # KPI functions: recommendation-status.py is hyphen-named.
            list_statuses = load_sibling_function(__file__, 'recommendation-status.py', 'list_statuses', '_for_join')
            statuses = list_statuses(rec_ids)
        except Exception:
            logger.exception('recommendation status join skipped')

    for rec in recommendations:
        row = statuses.get(rec['id'])
        rec['status'] = row.get('status', 'new') if row else 'new'
        if row:
            for key in ('updated_at', 'completed_at', 'notes',
                        'related_keyword', 'related_content_id'):
                if key in row:
                    rec[key] = row[key]


def _configuration_body(keywords_total: int) -> dict[str, Any]:
    """The one-recommendation page answered while no first-party brand is configured (it holds for every keyword)."""
    recommendations = [dict(CONFIGURATION_RECOMMENDATION)]
    body = {'recommendations': recommendations, 'total': 1, 'total_count': 1, 'next_token': None, 'by_priority': by_priority(recommendations)}
    return with_scope_contract({**body, 'keywords_truncated': False}, coverage(keywords_total, keywords_total), live_envelope())


@api_handler
@action_list_endpoint({'limit': limit_param(DEFAULT_LIMIT, MAX_LIMIT), 'use_llm': {'type': bool, 'default': False}}, lambda: dynamodb, paged=True)
def handler(event, context, report_scope: ReportScope, use_llm: bool = False, limit: int = DEFAULT_LIMIT, next_token: str | None = None) -> dict[str, Any]:
    """GET /api/recommendations (see the module docstring)."""
    config = get_brand_config()
    if tracked_brand_names(config)[0]:
        request = action_request('recommendations', 'recommendations', {'limit': limit}, report_scope, config, event, next_token)
        listed = serve_action_list(request, dynamodb, dynamodb.Table(SEARCH_RESULTS_TABLE), config)
        if listed.body is None:
            return listed.response or {}
        body = listed.body
    else:
        body = _configuration_body(len(report_scope.keywords))
    page = body['recommendations']
    # The status join reads only this page's ids.
    _annotate_with_status(page)
    llm_keywords = body.pop('llm_keywords', [])
    llm_recommendations: list[dict[str, Any]] = []
    llm_outcome: LlmOutcome | None = None
    if use_llm and page and next_token is None:
        context_str = json.dumps(page[:5], indent=2)
        llm_recommendations, llm_outcome = generate_llm_recommendations(config, context_str, llm_keywords[:LLM_PROMPT_KEYWORDS], len(report_scope.keywords))
    return success_response({
        'generated_at': get_timestamp(),
        'scope': report_scope.describe(),
        **body,
        'llm_enhanced': llm_recommendations or None,
        'llm': llm_outcome,
    }, event)
