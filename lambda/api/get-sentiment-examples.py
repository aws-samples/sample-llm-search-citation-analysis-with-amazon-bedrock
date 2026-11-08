"""
Sentiment Examples API — GET /api/visibility/sentiment-examples

The answers behind one sentiment count of the Sentiment report: in a scope
(exactly one of ``keyword=``, ``group_id=``, ``keyword_ids=`` or
``scope=all``), every sighting of each keyword's latest run labelled
``sentiment`` whose stored classification is ``classification``
(``first_party``, the default, or ``competitor``), optionally of one AI
engine (``provider``). ``total`` is the count the report's sentiment split
shows, exact; ``examples`` one page of the sightings with the brand, the
quote, the reason and the answer: at most ``limit``, fewer when their
answers would pass ``PAGE_BUDGET_BYTES``. The order is newest run first,
then keyword, provider and brand, which is keyword-major: ``next_token`` is
a keyword cursor (``{k, r, f}``), ``null`` on the last page, and a cursor
of another list (the scope, its runs or the build changed) answers 400
``cursor_expired``. Selection and ordering live in ``shared.sentiment_examples``.

Where it is answered from (``shared.brand_mention_views.latest_run_source``):

- **live** (within ``scope_source.LIVE_ROWS_BUDGET``): each keyword's latest
  run without the answer text, every keyword of the scope in parallel, then
  one BatchGetItem for the text of the page's answers. Keywords the time
  budget leaves unread are left out (``keywords_truncated``, ``coverage``);
  ``truncated`` is true whenever the budget cut anything.
- **snapshot** (larger scopes): the build's ``sentiment/index``
  (``shared.artifact_sentiment``) gives the exact ``total`` and the keywords
  holding matches; a page reads only the keywords it covers. No build: 202
  from a view job (``shared.mention_view_jobs``)
"""

import logging
import sys
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import query_keyword_run_rows, query_latest_run_rows
from shared.api_response import success_response
from shared.artifact_sentiment import SentimentReaders, snapshot_fingerprint
from shared.brand_mention_views import latest_run_source
from shared.cursors import CURSOR_QUERY_PARAM
from shared.decorators import api_handler, optional_provider, validate
from shared.keyword_major_pages import list_fingerprint
from shared.kpi_engine import FIRST_PARTY, SENTIMENT_LABELS
from shared.mention_row_reads import answer_texts
from shared.mention_scope_answers import LargeScopeView, live_lists_page, live_scope_contract, serve_large_scope
from shared.mention_view_jobs import ROUTE_SENTIMENT
from shared.scope_params import SCOPE_QUERY_PARAMS, ReportScope, keywords_table_name, scoped_dynamodb_resource
from shared.scoped_reports import ScopeRead, read_scope_keywords, required_report_scope
from shared.search_results import search_results_table_name
from shared.sentiment_examples import (
    DEFAULT_LIMIT,
    EXAMPLE_CLASSIFICATIONS,
    MAX_LIMIT,
    SIGHTING_ATTRIBUTE_NAMES,
    SIGHTING_PROJECTION,
    Candidate,
    ExampleFilter,
    RowKey,
    examples_page,
    order_keywords,
    ordered_examples,
)
from shared.snapshot_artifacts import SOURCE_SNAPSHOT, cursor_expired_response
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SENTIMENT_BUILDER = 'sentiment'

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
    """The answer text of the rows at ``keys`` (one page's rows, at most ``MAX_LIMIT``; ``shared.mention_row_reads.answer_texts``).

    Nothing is read once the request's time budget is spent: the page's
    examples then carry no answer and the response says ``truncated``.
    """
    return answer_texts(dynamodb, SEARCH_RESULTS_TABLE, keys)


def _run_sightings(keyword: str, timestamp: str) -> list[dict[str, Any]]:
    """One keyword's sightings of the run a build counted (no answer text)."""
    return query_keyword_run_rows(
        dynamodb.Table(SEARCH_RESULTS_TABLE), keyword, timestamp, projection=SIGHTING_PROJECTION, attribute_names=SIGHTING_ATTRIBUTE_NAMES,
    )


READERS = SentimentReaders(run_rows=_run_sightings, answer_texts=read_answer_texts)


def _filters(sentiment: str, provider: str | None, classification: str) -> dict[str, Any]:
    return {'sentiment': sentiment, 'provider': provider, 'classification': classification}


def live_examples(report_scope: ReportScope, filters: dict[str, Any], limit: int, next_token: str | None, event: dict[str, Any]) -> dict[str, Any]:
    """The page read live: every keyword's latest run, ordered keyword-major, and one page of it."""
    sightings = load_latest_run_rows(list(report_scope.keywords))
    wanted = ExampleFilter(filters['sentiment'], filters['provider'], filters['classification'])
    candidates: dict[str, list[Candidate]] = {keyword: ordered_examples(rows, wanted) for keyword, rows in sightings.values.items()}
    ordered = order_keywords((keyword, items[0][1]['timestamp']) for keyword, items in candidates.items() if items)
    lists = [candidates[keyword] for keyword, _timestamp in ordered]
    request, rejected = live_lists_page(lists, next_token, list_fingerprint('live-sentiment', ordered, filters), limit, event)
    if request is None:
        return rejected or cursor_expired_response(event)
    examples, token = examples_page(request, read_answer_texts)
    body = {
        'scope': report_scope.describe(),
        **filters,
        'total': sum(len(items) for items in lists),
        'examples': examples,
        'next_token': token,
    }
    return success_response(live_scope_contract(body, report_scope, sightings), event)


def snapshot_examples(report_scope: ReportScope, filters: dict[str, Any], limit: int, next_token: str | None, event: dict[str, Any]) -> dict[str, Any]:
    """The page from the scope's build (``sentiment/index``), or the view job's answer when there is no build."""
    params = {**filters, 'limit': limit, 'next_token': next_token}
    view = LargeScopeView(ROUTE_SENTIMENT, SENTIMENT_BUILDER, params, READERS, fingerprint=lambda build_id: snapshot_fingerprint(build_id, filters))
    return serve_large_scope(report_scope, get_brand_config().get('updated_at'), view, event)


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
    filters = _filters(sentiment, provider, classification)
    source = latest_run_source(dynamodb.Table(SEARCH_RESULTS_TABLE), report_scope.kind, report_scope.keywords)
    if source == SOURCE_SNAPSHOT:
        return snapshot_examples(report_scope, filters, limit, next_token, event)
    return live_examples(report_scope, filters, limit, next_token, event)
