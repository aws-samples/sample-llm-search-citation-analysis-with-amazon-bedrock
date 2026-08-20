"""
Tests for the provider rollup the deduplication step echoes.

REGRESSION (AUDIT-2026-08-19 §1.3): this Lambda's payload replaces the whole
Step Functions state, so the search step's `results` array died here — two
states before `generate-summary` read it. Every execution summary ever written
reported `total_providers_queried: 0` and `providers_breakdown: {}`, silently.

`summarize_providers` echoes a bounded rollup so the numbers survive. The tests
assert the actual counts, not just that the key exists, because a rollup of
zeros would restore the reporting bug while looking fixed.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.abspath(os.path.join(_HANDLER_DIR, '..'))
_MODULE_NAME = 'deduplication_handler_under_test'

_TEST_ENV = {
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'CITATIONS_TABLE_NAME': 'test-citations',
    'CITATIONS_TABLE': 'test-citations',
}


def _load_handler() -> tuple[Any, MagicMock]:
    """Import the dedup handler with DynamoDB mocked at module scope."""
    if _LAMBDA_DIR not in sys.path:
        sys.path.insert(0, _LAMBDA_DIR)

    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table

    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_HANDLER_DIR, 'handler.py')
    )
    module = importlib.util.module_from_spec(spec)

    with patch('boto3.resource', return_value=resource), \
         patch.dict(os.environ, _TEST_ENV):
        spec.loader.exec_module(module)

    module.citations_table = table
    return module, table


@pytest.fixture
def dedup():
    """Provide the dedup module with a mocked citations table."""
    module, _table = _load_handler()
    yield module
    sys.modules.pop(_MODULE_NAME, None)


def provider_row(
    provider: str,
    citations: list[str],
    query_prompt_id: str = 'default',
) -> dict[str, Any]:
    """Build one search-step result row, matching search/handler.py's shape."""
    return {
        'provider': provider,
        'provider_type': 'llm',
        'status': 'success',
        'citation_count': len(citations),
        'citations': citations,
        'query_prompt_id': query_prompt_id,
    }


class TestSummarizeProviders:
    """The rollup function in isolation."""

    def test_counts_one_query_per_provider_row(self, dedup) -> None:
        results = [
            provider_row('openai', ['https://a.example', 'https://b.example']),
            provider_row('perplexity', ['https://c.example']),
        ]

        summary = dedup.summarize_providers(results)

        assert summary['result_count'] == 2

    def test_totals_citations_per_provider(self, dedup) -> None:
        results = [
            provider_row('openai', ['https://a.example', 'https://b.example']),
            provider_row('perplexity', ['https://c.example']),
        ]

        summary = dedup.summarize_providers(results)

        assert summary['by_provider'] == {
            'openai': {
                'queries': 1,
                'citations': 2,
                'failures': 0,
                'error_categories': [],
            },
            'perplexity': {
                'queries': 1,
                'citations': 1,
                'failures': 0,
                'error_categories': [],
            },
        }

    def test_counts_two_queries_when_two_personas_hit_one_provider(self, dedup) -> None:
        """
        `total_providers_queried` counts provider-result rows, not distinct
        providers — one row per (provider x query prompt). Collapsing these
        would undercount every multi-persona run.
        """
        results = [
            provider_row('openai', ['https://a.example'], query_prompt_id='family'),
            provider_row('openai', ['https://b.example'], query_prompt_id='business'),
        ]

        summary = dedup.summarize_providers(results)

        assert summary['result_count'] == 2
        assert summary['by_provider']['openai'] == {
            'queries': 2,
            'citations': 2,
            'failures': 0,
            'error_categories': [],
        }

    def test_reports_zero_for_no_results(self, dedup) -> None:
        summary = dedup.summarize_providers([])

        assert summary == {
            'result_count': 0,
            'by_provider': {},
        }

    def test_counts_a_failed_provider_row_with_no_citations(self, dedup) -> None:
        """
        THE 2026-08-14 BUG, at the exact line that caused it.

        This rollup used to emit `{'queries': 1, 'citations': 0}` for an errored
        row — byte-identical to a provider that searched successfully and found
        nothing. That is how Claude answering every query with
        `400 "Your credit balance is too low"` reached the execution summary as
        a clean run reporting `success_rate: 100.0`, and stayed that way from
        2026-08-14 to 2026-08-19.

        `failures: 1` is the bit that was being discarded. Asserting the whole
        bucket (not just `failures`) keeps `citations: 0` pinned too, so the two
        cases stay distinguishable in both directions.
        """
        results = [{
            'provider': 'gemini',
            'status': 'error',
            'error': 'timeout',
        }]

        summary = dedup.summarize_providers(results)

        assert summary['by_provider']['gemini'] == {
            'queries': 1,
            'citations': 0,
            'failures': 1,
            'error_categories': ['unknown'],
        }

    def test_attributes_a_nameless_row_to_unknown(self, dedup) -> None:
        summary = dedup.summarize_providers([{'citations': ['https://a.example']}])

        assert summary['by_provider'] == {
            'unknown': {
                'queries': 1,
                'citations': 1,
                'failures': 0,
                'error_categories': [],
            }
        }


class TestErrorCategoriesSurviveTheRollup:
    """
    The category classified in the search Lambda has to reach the summary.

    `shared.provider_health` works out *why* a provider failed, but that
    diagnosis is useless if it dies at this hop — the summary would be back to
    knowing only that something went wrong, which is not enough to tell a
    five-day billing outage from an afternoon of throttling.
    """

    def test_surfaces_the_insufficient_credit_category_from_an_errored_row(self, dedup) -> None:
        """
        The 2026-08-14 shape, carried end to end. `insufficient_credit` is the
        difference between "Claude is out of money, go top it up" and "Claude
        found nothing this run".
        """
        results = [{
            'provider': 'claude',
            'status': 'error',
            'error': 'Your credit balance is too low to access the Anthropic API.',
            'error_category': 'insufficient_credit',
        }]

        summary = dedup.summarize_providers(results)

        assert summary['by_provider']['claude'] == {
            'queries': 1,
            'citations': 0,
            'failures': 1,
            'error_categories': ['insufficient_credit'],
        }

    def test_reports_both_categories_when_one_provider_fails_two_ways(self, dedup) -> None:
        """
        A provider can be rate limited on one keyword and out of credit on the
        next. Keeping a list means the second diagnosis does not overwrite the
        first — reporting only the last one would hide the terminal failure
        behind a transient one.
        """
        results = [
            {
                'provider': 'claude',
                'status': 'error',
                'error_category': 'rate_limited',
            },
            {
                'provider': 'claude',
                'status': 'error',
                'error_category': 'insufficient_credit',
            },
        ]

        summary = dedup.summarize_providers(results)

        assert summary['by_provider']['claude']['error_categories'] == [
            'rate_limited',
            'insufficient_credit',
        ]

    def test_counts_both_failures_when_one_provider_fails_twice(self, dedup) -> None:
        results = [
            {'provider': 'claude', 'status': 'error', 'error_category': 'rate_limited'},
            {'provider': 'claude', 'status': 'error', 'error_category': 'insufficient_credit'},
        ]

        summary = dedup.summarize_providers(results)

        assert summary['by_provider']['claude']['failures'] == 2

    def test_records_a_repeated_category_only_once(self, dedup) -> None:
        """
        Nine keywords all failing on credit is one problem, not nine. A list
        that grew per row would be unbounded in the Step Functions state, which
        is the `States.DataLimitExceeded` risk this rollup exists to avoid.
        """
        results = [
            {'provider': 'claude', 'status': 'error', 'error_category': 'insufficient_credit'}
            for _ in range(9)
        ]

        summary = dedup.summarize_providers(results)

        assert summary['by_provider']['claude']['error_categories'] == ['insufficient_credit']

    def test_records_nine_failures_when_all_nine_queries_error(self, dedup) -> None:
        """The count still has to reflect every failed query, unlike the category list."""
        results = [
            {'provider': 'claude', 'status': 'error', 'error_category': 'insufficient_credit'}
            for _ in range(9)
        ]

        summary = dedup.summarize_providers(results)

        assert summary['by_provider']['claude']['failures'] == 9

    def test_leaves_a_successful_provider_with_no_failures_recorded(self, dedup) -> None:
        """
        The control case. A healthy provider must stay at `failures: 0` — if it
        did not, `assess_provider_health` would report the entire run degraded
        and the alert would mean nothing.
        """
        summary = dedup.summarize_providers([provider_row('openai', ['https://a.example'])])

        assert summary['by_provider']['openai']['failures'] == 0

    def test_ignores_an_error_category_on_a_successful_row(self, dedup) -> None:
        """
        Only `status` decides whether a row counts as a failure. A stale
        `error_category` left on a row that ultimately succeeded — a retry that
        worked on the last attempt — must not be reported as a failure.
        """
        row = provider_row('openai', ['https://a.example'])
        row['error_category'] = 'rate_limited'

        summary = dedup.summarize_providers([row])

        assert summary['by_provider']['openai'] == {
            'queries': 1,
            'citations': 1,
            'failures': 0,
            'error_categories': [],
        }


class TestHandlerEchoesTheRollup:
    """
    The rollup has to reach the returned payload, since that payload is the
    entire downstream state.
    """

    def test_includes_the_rollup_alongside_deduplicated_citations(self, dedup) -> None:
        event = {
            'keyword': 'best hotels malaga',
            'timestamp': '2026-08-19T10:00:00Z',
            'results': [
                provider_row('openai', ['https://a.example', 'https://b.example']),
                provider_row('perplexity', ['https://a.example']),
            ],
        }

        result = dedup.handler(event, None)

        assert result['provider_summary']['result_count'] == 2
        assert result['provider_summary']['by_provider']['openai']['citations'] == 2

    def test_still_returns_the_keys_the_crawl_map_reads(self, dedup) -> None:
        """
        CrawlCitations uses itemsPath `$.deduplicated_citations` and
        itemSelector `$.keyword`; adding the rollup must not disturb them.
        """
        event = {
            'keyword': 'best hotels malaga',
            'timestamp': '2026-08-19T10:00:00Z',
            'results': [provider_row('openai', ['https://a.example'])],
        }

        result = dedup.handler(event, None)

        assert result['keyword'] == 'best hotels malaga'
        assert len(result['deduplicated_citations']) == 1

    def test_includes_a_zero_rollup_when_no_results_are_provided(self, dedup) -> None:
        """
        The early-return path must carry the key too, or a keyword whose
        providers all failed would fall back to the raw-results branch in
        generate-summary and silently contribute nothing.
        """
        event = {
            'keyword': 'best hotels malaga',
            'timestamp': '2026-08-19T10:00:00Z',
            'results': [],
        }

        result = dedup.handler(event, None)

        assert result['provider_summary'] == {
            'result_count': 0,
            'by_provider': {},
        }
