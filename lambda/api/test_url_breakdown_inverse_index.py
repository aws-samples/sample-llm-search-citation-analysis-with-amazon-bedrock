"""
Tests for the citations inverse-index migration in `get-url-breakdown.py`.

Background — the previous implementation answered "which keywords cited
URL X?" by paginating through up to 5000 SearchResults rows, comparing
each citation string after normalization. That cost grows linearly with
search volume and dominated p99 latency on the URL detail view.

This refactor delegates the lookup to a GSI on the Citations table
(``UrlIndex``: PK=normalized_url, SK=keyword, projection=ALL). DynamoDB
maintains the index for free as the dedup Lambda upserts citation rows.

These tests pin:
  - The handler queries ``UrlIndex`` (not the base table, not a scan).
  - The breakdown payload expands ``citing_providers`` into one entry per
    (keyword, provider) pair to preserve the existing response contract.
  - Pagination terminates and is bounded.
  - Edge cases (empty providers, missing timestamps) don't drop rows or crash.
  - URL normalization is applied so percent-encoded inputs resolve to the
    same key DynamoDB has on disk.
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

from testing.module_loader import load_handler_module

# Required env vars must be present BEFORE the module imports — the handler
# resolves them at module load via ``resolve_table_env``.
os.environ.setdefault('DYNAMODB_TABLE_CITATIONS', 'test-citations')
_mod = load_handler_module(os.path.dirname(__file__), 'get-url-breakdown.py')


def _fake_table(pages: list[dict]) -> MagicMock:
    """
    Build a MagicMock DynamoDB Table whose ``query`` returns the given
    pages in order. Each page is a dict like
    ``{'Items': [...], 'LastEvaluatedKey': {...} or None}``.
    """
    table = MagicMock()
    table.query.side_effect = pages
    return table


def _single_page(items: list[dict] | None = None) -> MagicMock:
    """A table whose whole answer fits in one page."""
    return _fake_table([{'Items': items or [], 'LastEvaluatedKey': None}])


def _make_event(url: str) -> dict:
    """Mimic the API Gateway proxy event shape the handler expects."""
    return {
        'queryStringParameters': {'url': url},
        'headers': {},
        'requestContext': {'http': {'method': 'GET'}},
    }


def _handle(url: str, items: list[dict] | None = None) -> dict:
    """Run the handler against a single-page table and decode the response body."""
    with patch.object(_mod, 'citations_table', _single_page(items)):
        response = _mod.handler(_make_event(url), None)
    return json.loads(response['body'])


class TestQueryUrlIndex:
    """Verify the index query goes to the right place and respects paging."""

    def test_queries_url_index_by_normalized_url(self) -> None:
        table = _single_page()
        with patch.object(_mod, 'citations_table', table):
            _mod._query_url_index('https://example.com/page')

        # One call, targeting the inverse-index GSI by name.
        assert table.query.call_count == 1
        kwargs = table.query.call_args.kwargs
        assert kwargs['IndexName'] == 'UrlIndex'

    def test_query_uses_normalized_url_as_partition_key(self) -> None:
        """The partition key on UrlIndex is ``normalized_url`` — the key
        condition must match that attribute."""
        table = _single_page()
        with patch.object(_mod, 'citations_table', table):
            _mod._query_url_index('https://example.com/page')

        kce = table.query.call_args.kwargs['KeyConditionExpression']
        # boto3 Condition objects expose operands via ``_values``: the first
        # operand is the Key/Attr object, the second is the literal value.
        key_attr, value = kce._values
        assert key_attr.name == 'normalized_url'
        assert value == 'https://example.com/page'

    def test_paginates_until_no_last_evaluated_key(self) -> None:
        pages = [
            {'Items': [{'keyword': 'a'}], 'LastEvaluatedKey': {'k': 1}},
            {'Items': [{'keyword': 'b'}], 'LastEvaluatedKey': {'k': 2}},
            {'Items': [{'keyword': 'c'}], 'LastEvaluatedKey': None},
        ]
        table = _fake_table(pages)
        with patch.object(_mod, 'citations_table', table):
            items = _mod._query_url_index('https://example.com')

        assert [i['keyword'] for i in items] == ['a', 'b', 'c']
        assert table.query.call_count == 3

    def test_stops_at_max_query_pages_when_results_unbounded(self) -> None:
        """A pathological table that never returns ``LastEvaluatedKey=None``
        must not loop forever — the cap exists so a misbehaving GSI can't
        burn the Lambda timeout."""
        infinite_page = {'Items': [{'keyword': 'kw'}], 'LastEvaluatedKey': {'k': 1}}
        table = MagicMock()
        table.query.return_value = infinite_page
        with patch.object(_mod, 'citations_table', table):
            items = _mod._query_url_index('https://example.com')

        assert table.query.call_count == _mod._MAX_QUERY_PAGES
        assert len(items) == _mod._MAX_QUERY_PAGES


class TestExpandToBreakdown:
    """The breakdown response contract: one entry per (keyword, provider)."""

    def test_expands_citing_providers_into_one_entry_per_provider(self) -> None:
        items = [
            {
                'keyword': 'best hotels',
                'citing_providers': ['openai', 'perplexity', 'gemini'],
                'last_updated': '2026-04-17T12:00:00Z',
            }
        ]
        breakdown = _mod._expand_to_breakdown(items)

        assert breakdown == [
            {'keyword': 'best hotels', 'provider': 'openai',
             'timestamp': '2026-04-17T12:00:00Z'},
            {'keyword': 'best hotels', 'provider': 'perplexity',
             'timestamp': '2026-04-17T12:00:00Z'},
            {'keyword': 'best hotels', 'provider': 'gemini',
             'timestamp': '2026-04-17T12:00:00Z'},
        ]

    def test_preserves_keyword_for_each_expanded_provider_entry(self) -> None:
        """Multiple keywords cite the same URL — every expanded entry must
        carry the keyword from its source row, not get cross-pollinated."""
        items = [
            {'keyword': 'kw-a', 'citing_providers': ['openai'],
             'last_updated': '2026-01-01T00:00:00Z'},
            {'keyword': 'kw-b', 'citing_providers': ['claude'],
             'last_updated': '2026-01-02T00:00:00Z'},
        ]
        breakdown = _mod._expand_to_breakdown(items)

        keywords = sorted(entry['keyword'] for entry in breakdown)
        assert keywords == ['kw-a', 'kw-b']

    def test_falls_back_to_first_seen_when_last_updated_missing(self) -> None:
        """Legacy rows pre-dating ``last_updated`` still report a timestamp."""
        items = [
            {
                'keyword': 'kw',
                'citing_providers': ['openai'],
                'first_seen': '2025-12-01T00:00:00Z',
            }
        ]
        breakdown = _mod._expand_to_breakdown(items)
        assert breakdown[0]['timestamp'] == '2025-12-01T00:00:00Z'

    def test_empty_citing_providers_yields_one_entry_with_blank_provider(
        self,
    ) -> None:
        """A Citations row should never have empty providers in practice,
        but if one slips in, surface it (blank provider) rather than drop
        the keyword silently."""
        items = [
            {
                'keyword': 'kw',
                'citing_providers': [],
                'last_updated': '2026-04-17T12:00:00Z',
            }
        ]
        breakdown = _mod._expand_to_breakdown(items)

        assert breakdown == [
            {'keyword': 'kw', 'provider': '',
             'timestamp': '2026-04-17T12:00:00Z'},
        ]

    def test_missing_citing_providers_field_yields_blank_provider_entry(
        self,
    ) -> None:
        """Same defensive contract when the field is absent entirely."""
        items = [{'keyword': 'kw', 'last_updated': '2026-04-17T12:00:00Z'}]
        breakdown = _mod._expand_to_breakdown(items)

        assert breakdown == [
            {'keyword': 'kw', 'provider': '',
             'timestamp': '2026-04-17T12:00:00Z'},
        ]


class TestHandlerResponseShape:
    """End-to-end tests for the API contract."""

    def test_returns_breakdown_sorted_by_timestamp_desc(self) -> None:
        items = [
            {'keyword': 'old', 'citing_providers': ['openai'],
             'last_updated': '2026-01-01T00:00:00Z'},
            {'keyword': 'new', 'citing_providers': ['openai'],
             'last_updated': '2026-04-17T12:00:00Z'},
        ]

        breakdown = _handle('https://example.com', items)['breakdown']

        # Newest first — consumers sort/display in this order on the UI.
        assert breakdown[0]['keyword'] == 'new'
        assert breakdown[1]['keyword'] == 'old'

    def test_total_citations_counts_expanded_entries(self) -> None:
        """``total_citations`` is the count the UI shows; it must reflect
        the expanded (keyword, provider) pairs, not the raw row count."""
        items = [
            {'keyword': 'kw', 'citing_providers': ['openai', 'gemini', 'claude'],
             'last_updated': '2026-04-17T12:00:00Z'},
        ]

        body = _handle('https://example.com', items)

        assert body['total_citations'] == 3

    def test_returns_empty_breakdown_when_url_not_found(self) -> None:
        body = _handle('https://nobody-cites-this.example')

        assert body['total_citations'] == 0
        assert body['breakdown'] == []

    def test_response_url_field_is_decoded_input_not_normalized(self) -> None:
        """The ``url`` echoed back is the user-facing input (post-unquote)
        so the UI displays what the user clicked, not the normalized form
        used internally."""
        body = _handle('https%3A%2F%2Fexample.com%2Fpage')

        assert body['url'] == 'https://example.com/page'


class TestNoLongerScansSearchResults:
    """Regression guard: the previous implementation imported and scanned
    the SearchResults table. The migration removes that dependency
    entirely; if it sneaks back, this test fails fast."""

    def test_module_does_not_reference_search_results_table(self) -> None:
        # The module should expose ``citations_table`` (the GSI host) and
        # not reintroduce ``search_results_table``.
        assert hasattr(_mod, 'citations_table')
        assert not hasattr(_mod, 'search_results_table')

    def test_module_does_not_call_table_scan(self) -> None:
        """A scan call is the smoking gun for the old implementation."""
        table = _single_page()
        with patch.object(_mod, 'citations_table', table):
            _mod.handler(_make_event('https://example.com'), None)

        table.scan.assert_not_called()

    def test_module_targets_url_index_constant(self) -> None:
        """The GSI name is a single source of truth — keep it pinned."""
        assert _mod.URL_INDEX_NAME == 'UrlIndex'
