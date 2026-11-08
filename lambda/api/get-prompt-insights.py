"""
Prompt Insights API — GET /api/prompt-insights

Which prompts (keywords) lead to brand mentions: the winning prompts (the
first party in the top 3), the losing ones (absent or below 5th) and the
opportunities (competitors named, the first party not), each classified from
every answer of the keyword's **latest run** (``shared.prompt_classification``).

Each list holds the ``limit`` best prompts of its whole ranking, with
``<list>_total`` and ``<list>_next_token``; the same GET with ``type=<the
list's type>`` and that ``next_token`` answers its next page (2.45.0 wave 5).
``summary`` counts every prompt of the scope (any report scope; every active
keyword without one). Where the
lists come from, live or the ``prompts`` snapshot artifact, and the 202 of a
scope not built yet: ``shared.action_scope_serve``. ``truncated`` mirrors
``keywords_truncated``.
"""

import sys
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared import action_scope_serve as action_lists
from shared.api_response import success_response, validation_error
from shared.artifact_prompts import STORED_PER_LIST
from shared.brand_visibility import tracked_brand_names
from shared.decorators import api_handler
from shared.scope_params import ReportScope, scoped_dynamodb_resource
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config

dynamodb = scoped_dynamodb_resource()

SEARCH_RESULTS_TABLE = search_results_table_name()

#: Prompts per list (page) by default, and at most (``limit``).
DEFAULT_LIMIT = 20
MAX_LIMIT = STORED_PER_LIST


@api_handler
@action_lists.action_list_endpoint({
    'type': {'type': str, 'choices': ['winning', 'losing', 'opportunities', 'all'], 'default': 'all'},
    'limit': action_lists.limit_param(DEFAULT_LIMIT, MAX_LIMIT),
}, lambda: dynamodb, paged=True)
def handler(
    event, context, report_scope: ReportScope, type: str = 'all', limit: int = DEFAULT_LIMIT, next_token: str | None = None,
) -> dict[str, Any]:
    """GET /api/prompt-insights (see the module docstring); ``type`` keeps one list (with the summary)."""
    config = get_brand_config()
    # A missing prerequisite is the caller's configuration to fix: 400 with the actual reason.
    if not tracked_brand_names(config)[0]:
        return validation_error('No first-party brands configured', event)
    if not report_scope.keywords:
        return validation_error('No keywords configured', event)
    request = action_lists.action_request(
        'prompt-insights', 'prompts', {'limit': limit, 'type': type}, report_scope, config, event, next_token, job_params={},
    )
    answer = action_lists.serve_action_list(request, dynamodb, dynamodb.Table(SEARCH_RESULTS_TABLE), config)
    if answer.body is None:
        return answer.response or {}
    body = answer.body
    return success_response({'scope': report_scope.describe(), **body, 'truncated': bool(body.get('keywords_truncated'))}, event)
