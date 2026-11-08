"""
Reports Competitor Rollup API — GET /api/reports/competitor

Per-competitor rollup behind the Competitor Gap print report and ad-hoc
"where is X eating our lunch" lookups (``shared.competitor_evidence``), from
each keyword's latest run:

- Outranked keywords: keywords where the competitor's best rank beats every
  first-party brand's best rank, biggest gap first.
- Exclusive citation sources: URLs that cite this competitor but no
  first-party brand (citation gaps naming it), counted in full
  (``exclusive_source_count``, ``high_priority_source_count``).
- Outreach targets: the ``OUTREACH_TARGETS_LIMIT`` exclusive sources with the
  best outreach lift, so a PR strategist can plan a sprint.

Routes
  GET /api/reports/competitor?competitor=<name>
    One competitor's rollup, its outranked keywords paged: ``limit`` a page,
    ``rollup.outranked_keywords_next_token`` (also ``next_token``) for the next.
  GET /api/reports/competitor?competitor=<name>&view=outreach
    One page of every exclusive source of the competitor, best lift first
    (``rollup.outreach_targets``, ``rollup.outreach_targets_total``,
    ``rollup.next_token``; the answer above lists the first 10 with
    ``rollup.outreach_targets_next_token``), 2.45.0 wave 5.
  GET /api/reports/competitor
    The configured competitors and every one's rollup (first page each).

Since 2.45.0 it honours the report scope parameters (every active keyword
without one) and rolls up every configured competitor, live or from the
``competitor`` artifact (``shared.action_scope_serve``). ``keyword_limit``,
the 2.44.0 name of ``limit``, is still read.
"""

from __future__ import annotations

import sys
from typing import Any

# Shared layer path
sys.path.insert(0, '/opt/python')

from shared.action_scope_serve import action_list_endpoint, action_request, serve_action_list
from shared.api_response import success_response, validation_error
from shared.competitor_evidence import configured_competitors, unknown_competitor_error
from shared.decorators import api_handler
from shared.scope_params import scoped_dynamodb_resource
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config, get_timestamp

# One latest-run read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()
SEARCH_RESULTS_TABLE = search_results_table_name()

#: Outranked keywords per page by default, and at most (``limit``).
DEFAULT_LIMIT = 50
MAX_LIMIT = 100

_LIMIT = {'type': int, 'min': 1, 'max': MAX_LIMIT}


@api_handler
@action_list_endpoint({
    'competitor': {'type': str, 'max_length': 200},
    'limit': _LIMIT,
    'keyword_limit': _LIMIT,
    'view': {'type': str, 'choices': ['summary', 'outreach'], 'default': 'summary'},
}, lambda: dynamodb, paged=True)
def handler(
    event,
    context,
    report_scope,
    competitor: str | None = None,
    limit: int | None = None,
    keyword_limit: int | None = None,
    next_token: str | None = None,
    view: str = 'summary',
) -> dict[str, Any]:
    """API handler for GET /api/reports/competitor (see the module docstring)."""
    config = get_brand_config()
    unknown = unknown_competitor_error(competitor, config)
    if unknown is not None:
        # A 400 on an unconfigured name is more helpful than an empty rollup the UI would misread as "no gap".
        return validation_error(unknown['error'], event, 'competitor')
    if view == 'outreach' and not competitor:
        return validation_error('view=outreach pages one competitor: give competitor', event, 'competitor')
    params = {
        'view': view,
        'competitor': competitor,
        'competitors': configured_competitors(config),
        'limit': limit or keyword_limit or DEFAULT_LIMIT,
    }
    request = action_request('reports-competitor', 'competitor', params, report_scope, config, event, next_token, job_params={})
    rolled_up = serve_action_list(request, dynamodb, dynamodb.Table(SEARCH_RESULTS_TABLE), config)
    body = rolled_up.body
    if body is None:
        return rolled_up.response or {}
    rollup = body.get('rollup') or {}
    page_token = rollup.get('next_token') if view == 'outreach' else rollup.get('outranked_keywords_next_token')
    return success_response({'scope': report_scope.describe(), **body, 'generated_at': get_timestamp(), 'next_token': page_token}, event)
