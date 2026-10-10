"""
Sentiment Examples API — GET /api/visibility/sentiment-examples

The answers behind one sentiment count of the Sentiment report: in a scope
(exactly one of ``keyword=``, ``group_id=``, ``keyword_ids=`` or
``scope=all``), every sighting of each keyword's latest run labelled
``sentiment`` whose stored classification is ``classification``
(``first_party``, the default, or ``competitor``), optionally of one AI
engine (``provider``). ``total``
is the count the report's sentiment split shows; ``examples`` the first
``limit`` sightings with the brand, the quote, the reason and the answer.
Selection and ordering live in ``shared.sentiment_examples``.
"""

import logging
import sys
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import query_latest_run_rows
from shared.api_response import success_response
from shared.decorators import api_handler, optional_provider, validate
from shared.kpi_engine import FIRST_PARTY, SENTIMENT_LABELS
from shared.scope_params import SCOPE_QUERY_PARAMS, keywords_table_name, map_scope_keywords, scoped_dynamodb_resource
from shared.scoped_reports import capped_scope, required_report_scope
from shared.search_results import search_results_table_name
from shared.sentiment_examples import (
    DEFAULT_LIMIT,
    EXAMPLE_ATTRIBUTE_NAMES,
    EXAMPLE_CLASSIFICATIONS,
    EXAMPLE_PROJECTION,
    MAX_LIMIT,
    sentiment_examples,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# One latest-run read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()


def load_latest_run_rows(keywords: list[str]) -> list[dict[str, Any]]:
    """The rows of each keyword's latest run, with the answer text, read in parallel.

    A keyword whose read fails has no rows (logged by ``map_scope_keywords``),
    as in ``/api/visibility``.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    runs = map_scope_keywords(
        keywords,
        lambda keyword: query_latest_run_rows(
            table, keyword, projection=EXAMPLE_PROJECTION, attribute_names=EXAMPLE_ATTRIBUTE_NAMES,
        ),
        lambda _keyword: [],
    )
    return [row for rows in runs for row in rows]


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'classification': {'type': str, 'choices': list(EXAMPLE_CLASSIFICATIONS), 'default': FIRST_PARTY},
    'sentiment': {'required': True, 'type': str, 'choices': list(SENTIMENT_LABELS)},
    'provider': optional_provider(),
    'limit': {'type': int, 'min': 1, 'max': MAX_LIMIT, 'default': DEFAULT_LIMIT},
})
@required_report_scope(lambda: dynamodb.Table(KEYWORDS_TABLE))
def handler(event, _context, report_scope, sentiment, provider, classification, limit):
    """GET /api/visibility/sentiment-examples — see the module docstring."""
    keywords, scope_fields = capped_scope(report_scope)
    total, examples = sentiment_examples(
        load_latest_run_rows(keywords), sentiment, provider=provider, classification=classification, limit=limit,
    )
    return success_response(
        {
            **scope_fields,
            'sentiment': sentiment,
            'provider': provider,
            'classification': classification,
            'total': total,
            'examples': examples,
        },
        event,
    )
