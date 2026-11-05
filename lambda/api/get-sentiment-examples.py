"""
Sentiment Examples API — GET /api/visibility/sentiment-examples

The answers behind one sentiment count of the Sentiment report: in a scope
(exactly one of ``keyword=``, ``group_id=``, ``keyword_ids=`` or
``scope=all``), every sighting of each keyword's latest run labelled
``sentiment`` whose stored classification is ``classification``
(``first_party``, the default, or ``competitor``), optionally of one AI
engine (``provider``). ``total``
is the count the report's sentiment split shows; ``examples`` one page of
the sightings with the brand, the quote, the reason and the answer: at most
``limit``, fewer when their answers would pass ``PAGE_BUDGET_BYTES``.
``next_token`` (an offset cursor into the sorted sightings) fetches the next
page; ``null`` on the last one.
Selection and ordering live in ``shared.sentiment_examples``.

Reads: each keyword's latest run without the answer text (at most
``SCOPE_KEYWORDS_CAP`` keywords, in parallel), then one BatchGetItem for the
text of the page's answers only. Keywords the request's time budget leaves
unread are left out (``keywords_truncated``); ``truncated`` is true whenever
the budget cut anything (a page past it carries no answer text).
"""

import logging
import sys
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import query_latest_run_rows
from shared.api_response import success_response, validation_error
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM, decode_offset_cursor, encode_offset_cursor
from shared.decorators import api_handler, optional_provider, validate
from shared.dynamodb_batch import batch_get_items
from shared.kpi_engine import FIRST_PARTY, SENTIMENT_LABELS
from shared.request_deadline import current_deadline
from shared.scope_params import SCOPE_QUERY_PARAMS, keywords_table_name, scoped_dynamodb_resource
from shared.scoped_reports import ScopeRead, capped_scope, read_scope_keywords, required_report_scope, scope_read_fields
from shared.search_results import search_results_table_name
from shared.sentiment_examples import (
    DEFAULT_LIMIT,
    EXAMPLE_CLASSIFICATIONS,
    MAX_LIMIT,
    SIGHTING_ATTRIBUTE_NAMES,
    SIGHTING_PROJECTION,
    RowKey,
    sentiment_examples,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: What an example's answer text is read from: the row's key (to join it back) and the answer.
ANSWER_TEXT_PROJECTION = 'keyword, timestamp_provider, #rsp'
ANSWER_TEXT_ATTRIBUTE_NAMES = {'#rsp': 'response'}

# One latest-run read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()


def load_latest_run_rows(keywords: list[str]) -> ScopeRead[list[dict[str, Any]]]:
    """The sightings of each keyword's latest run (rows without the answer text), read in parallel.

    A keyword whose read fails has no rows (logged by ``map_scope_keywords``),
    as in ``/api/visibility``; one the time budget left unread is ``skipped``.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    return read_scope_keywords(
        keywords,
        lambda keyword: query_latest_run_rows(
            table, keyword, projection=SIGHTING_PROJECTION, attribute_names=SIGHTING_ATTRIBUTE_NAMES,
        ),
        lambda _keyword: [],
    )


def read_answer_texts(keys: list[RowKey]) -> dict[RowKey, str]:
    """The answer text of the rows at ``keys`` (one page's rows, at most ``MAX_LIMIT``), in one BatchGetItem.

    Nothing is read once the request's time budget is spent: the page's
    examples then carry no answer and the response says ``truncated``.
    """
    if not keys or current_deadline().stop_reading('the example answers'):
        return {}
    items = batch_get_items(
        dynamodb, SEARCH_RESULTS_TABLE, [{'keyword': keyword, 'timestamp_provider': sort_key} for keyword, sort_key in keys],
        projection=ANSWER_TEXT_PROJECTION, attribute_names=ANSWER_TEXT_ATTRIBUTE_NAMES,
    )
    return {
        (str(item.get('keyword')), str(item.get('timestamp_provider'))): response
        for item in items
        if isinstance(response := item.get('response'), str)
    }


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    **CURSOR_QUERY_PARAM,
    'classification': {'type': str, 'choices': list(EXAMPLE_CLASSIFICATIONS), 'default': FIRST_PARTY},
    'sentiment': {'required': True, 'type': str, 'choices': list(SENTIMENT_LABELS)},
    'provider': optional_provider(),
    'limit': {'type': int, 'min': 1, 'max': MAX_LIMIT, 'default': DEFAULT_LIMIT},
})
@required_report_scope(lambda: dynamodb.Table(KEYWORDS_TABLE))
def handler(event, _context, report_scope, sentiment, provider, classification, limit, next_token=None):
    """GET /api/visibility/sentiment-examples — see the module docstring."""
    offset = decode_offset_cursor(next_token)
    if offset is None:
        return validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
    keywords, scope_fields = capped_scope(report_scope)
    sightings = load_latest_run_rows(keywords)
    total, examples = sentiment_examples(
        (row for rows in sightings.values.values() for row in rows), sentiment, provider=provider,
        classification=classification, limit=limit, offset=offset, answer_texts=read_answer_texts,
    )
    return success_response(
        {
            **scope_read_fields(scope_fields, sightings.skipped),
            'sentiment': sentiment,
            'provider': provider,
            'classification': classification,
            'total': total,
            'examples': examples,
            'next_token': encode_offset_cursor(offset + len(examples), total),
            'truncated': current_deadline().cut,
        },
        event,
    )
