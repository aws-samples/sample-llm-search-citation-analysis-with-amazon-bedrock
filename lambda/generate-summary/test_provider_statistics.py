"""
Tests for provider statistics in the execution summary.

REGRESSION (AUDIT-2026-08-19 §1.3): `aggregate_statistics` read
`result['results']`, a key the state machine can never deliver — the dedup task
replaces the whole state two steps earlier. So every summary reported
`total_providers_queried: 0` and `providers_breakdown: {}` while
`total_unique_citations` and `total_pages_crawled` kept working, which is why it
went unnoticed.

The central test feeds the *real* post-crawl element shape — notably WITHOUT a
`results` key — and asserts non-zero provider numbers come out.
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
_MODULE_NAME = 'generate_summary_handler_under_test'


def _load_handler() -> tuple[Any, MagicMock]:
    """Import the summary handler with S3 mocked at module scope."""
    if _LAMBDA_DIR not in sys.path:
        sys.path.insert(0, _LAMBDA_DIR)

    s3 = MagicMock()

    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_HANDLER_DIR, 'handler.py')
    )
    module = importlib.util.module_from_spec(spec)

    with patch('boto3.client', return_value=s3):
        spec.loader.exec_module(module)

    module.s3_client = s3
    return module, s3


@pytest.fixture
def summary():
    """Provide the summary module with a mocked S3 client."""
    module, s3 = _load_handler()
    module.SUMMARY_BUCKET = ''
    yield module, s3
    sys.modules.pop(_MODULE_NAME, None)


def post_crawl_keyword_result(
    keyword: str = 'best hotels malaga',
    result_count: int = 4,
    by_provider: dict[str, dict[str, Any]] | None = None,
    unique_citations: int = 2,
    crawled_success: int = 2,
) -> dict[str, Any]:
    """
    Build one `keyword_results` element exactly as the state machine produces it.

    Shape after CrawlCitations merges its output: dedup's payload (status,
    keyword, timestamp, deduplicated_citations, provider_summary) plus
    `crawled_results`. There is deliberately no `results` key.
    """
    if by_provider is None:
        by_provider = {
            'openai': {
                'queries': 2,
                'citations': 5,
            },
            'perplexity': {
                'queries': 2,
                'citations': 3,
            },
        }

    return {
        'status': 'success',
        'keyword': keyword,
        'timestamp': '2026-08-19T10:00:00Z',
        'provider_summary': {
            'result_count': result_count,
            'by_provider': by_provider,
        },
        'deduplicated_citations': [
            {
                'normalized_url': f'https://example.com/{index}',
                'citation_count': 1,
            }
            for index in range(unique_citations)
        ],
        'crawled_results': [{'status': 'success'} for _ in range(crawled_success)],
    }


class TestProviderStatisticsFromTheStateMachineShape:
    """The shape that actually arrives in production."""

    def test_reports_the_queried_provider_count(self, summary) -> None:
        module, _ = summary

        stats = module.aggregate_statistics([post_crawl_keyword_result()])

        assert stats['total_providers_queried'] == 4

    def test_reports_a_populated_provider_breakdown(self, summary) -> None:
        module, _ = summary

        stats = module.aggregate_statistics([post_crawl_keyword_result()])

        assert stats['providers_breakdown'] == {
            'openai': {
                'queries': 2,
                'citations': 5,
                'failures': 0,
                'error_categories': [],
            },
            'perplexity': {
                'queries': 2,
                'citations': 3,
                'failures': 0,
                'error_categories': [],
            },
        }

    def test_sums_provider_counts_across_keywords(self, summary) -> None:
        module, _ = summary
        keyword_results = [
            post_crawl_keyword_result(keyword='hotels malaga'),
            post_crawl_keyword_result(keyword='hotels madrid'),
        ]

        stats = module.aggregate_statistics(keyword_results)

        assert stats['total_providers_queried'] == 8
        assert stats['providers_breakdown']['openai'] == {
            'queries': 4,
            'citations': 10,
            'failures': 0,
            'error_categories': [],
        }

    def test_keeps_counting_unique_citations(self, summary) -> None:
        """These already worked; the fix must not disturb them."""
        module, _ = summary

        stats = module.aggregate_statistics([post_crawl_keyword_result(unique_citations=3)])

        assert stats['total_unique_citations'] == 3

    def test_keeps_counting_crawled_pages(self, summary) -> None:
        module, _ = summary

        stats = module.aggregate_statistics([post_crawl_keyword_result(crawled_success=5)])

        assert stats['total_pages_crawled'] == 5

    def test_reports_zero_providers_for_a_keyword_whose_providers_all_failed(self, summary) -> None:
        module, _ = summary
        empty = post_crawl_keyword_result(result_count=0, by_provider={})

        stats = module.aggregate_statistics([empty])

        assert stats['total_providers_queried'] == 0
        assert stats['providers_breakdown'] == {}

    def test_skips_a_keyword_result_carrying_an_error(self, summary) -> None:
        module, _ = summary
        keyword_results = [post_crawl_keyword_result(), {'error': 'boom'}]

        stats = module.aggregate_statistics(keyword_results)

        assert stats['total_keywords'] == 1
        assert stats['total_providers_queried'] == 4


class TestMalformedRollupsAreTolerated:
    """A summary Lambda that raises loses the whole run's report."""

    def test_ignores_a_rollup_with_a_non_dict_breakdown(self, summary) -> None:
        module, _ = summary
        result = post_crawl_keyword_result()
        result['provider_summary']['by_provider'] = 'not-a-dict'

        stats = module.aggregate_statistics([result])

        assert stats['providers_breakdown'] == {}
        assert stats['total_providers_queried'] == 4

    def test_ignores_a_provider_entry_that_is_not_a_dict(self, summary) -> None:
        module, _ = summary
        result = post_crawl_keyword_result(by_provider={'openai': 7})

        stats = module.aggregate_statistics([result])

        assert stats['providers_breakdown'] == {}

    def test_treats_a_missing_result_count_as_zero(self, summary) -> None:
        module, _ = summary
        result = post_crawl_keyword_result()
        del result['provider_summary']['result_count']

        stats = module.aggregate_statistics([result])

        assert stats['total_providers_queried'] == 0


class TestRawSearchResultsStillSupported:
    """
    The documented Input shape for a direct invocation. Kept working so the
    handler stays testable and debuggable outside the state machine.
    """

    def test_counts_raw_provider_rows_when_no_rollup_is_present(self, summary) -> None:
        module, _ = summary
        raw = {
            'keyword': 'hotels malaga',
            'results': [
                {
                    'provider': 'openai',
                    'citations': ['https://a.example', 'https://b.example'],
                },
                {
                    'provider': 'perplexity',
                    'citations': ['https://c.example'],
                },
            ],
        }

        stats = module.aggregate_statistics([raw])

        assert stats['total_providers_queried'] == 2
        assert stats['providers_breakdown']['openai']['citations'] == 2

    def test_prefers_the_rollup_when_both_shapes_are_present(self, summary) -> None:
        """Avoids double-counting if a future change reinstates `results`."""
        module, _ = summary
        both = post_crawl_keyword_result()
        both['results'] = [{
            'provider': 'openai',
            'citations': ['https://a.example'],
        }]

        stats = module.aggregate_statistics([both])

        assert stats['total_providers_queried'] == 4


class TestReportIncludesProviderActivity:
    """End-to-end through the handler, since that is what writes to S3."""

    def test_handler_report_carries_non_zero_provider_activity(self, summary) -> None:
        module, _ = summary
        event = {
            'execution_id': 'exec-123',
            'keyword_results': [post_crawl_keyword_result()],
        }

        report = module.handler(event, None)

        statistics = report['summary']['statistics']
        assert statistics['total_providers_queried'] == 4
        assert statistics['providers_breakdown']['openai']['queries'] == 2

    def test_handler_writes_the_summary_to_the_requested_bucket(self, summary) -> None:
        module, s3 = summary
        event = {
            'execution_id': 'exec-123',
            'keyword_results': [post_crawl_keyword_result()],
            'summary_bucket': 'test-keywords-bucket',
        }

        module.handler(event, None)

        assert s3.put_object.call_args.kwargs['Bucket'] == 'test-keywords-bucket'


def provider_bucket(
    queries: int = 1,
    citations: int = 4,
    failures: int = 0,
    error_categories: list[str] | None = None,
) -> dict[str, Any]:
    """One `providers_breakdown` entry, in the shape the dedup rollup produces."""
    return {
        'queries': queries,
        'citations': citations,
        'failures': failures,
        'error_categories': error_categories if error_categories is not None else [],
    }


def stats_with(breakdown: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """A minimal `aggregate_statistics` result carrying just a provider breakdown."""
    return {'providers_breakdown': breakdown}


def keyword_counts(failed: int = 0, total: int = 1) -> dict[str, Any]:
    """A `count_results` result. Only `failed` affects the reported status."""
    successful = total - failed
    return {
        'total': total,
        'successful': successful,
        'failed': failed,
        'success_rate': (successful / total * 100) if total > 0 else 0,
    }


class TestAssessProviderHealth:
    """
    Whether a provider actually answered, which nothing used to ask.

    `count_results` asks "did this keyword's pipeline finish?" and on 2026-08-14
    the honest answer was yes for all of them. The missing question was "did the
    providers answer?", and for Claude the answer had been no for five days.
    """

    def test_reports_a_provider_with_failures_as_failed(self, summary) -> None:
        module, _ = summary
        stats = stats_with({'claude': provider_bucket(
            citations=0, failures=1, error_categories=['insufficient_credit'],
        )})

        health = module.assess_provider_health(stats)

        assert health['failed_providers'] == [{
            'provider': 'claude',
            'failures': 1,
            'queries': 1,
            'citations': 0,
            'error_categories': ['insufficient_credit'],
        }]

    def test_marks_the_run_degraded_when_a_provider_failed(self, summary) -> None:
        module, _ = summary
        stats = stats_with({'claude': provider_bucket(failures=1)})

        health = module.assess_provider_health(stats)

        assert health['degraded'] is True

    def test_counts_healthy_and_failed_providers_separately(self, summary) -> None:
        module, _ = summary
        stats = stats_with({
            'openai': provider_bucket(citations=7),
            'perplexity': provider_bucket(citations=3),
            'claude': provider_bucket(citations=0, failures=1),
        })

        health = module.assess_provider_health(stats)

        assert (health['providers_total'], health['providers_healthy'], health['providers_failed']) == (3, 2, 1)

    def test_names_only_the_failed_provider(self, summary) -> None:
        module, _ = summary
        stats = stats_with({
            'openai': provider_bucket(citations=7),
            'claude': provider_bucket(citations=0, failures=1),
        })

        health = module.assess_provider_health(stats)

        assert [entry['provider'] for entry in health['failed_providers']] == ['claude']

    def test_lists_failed_providers_in_a_stable_order(self, summary) -> None:
        """
        Summaries are written to S3 and compared between runs. Dict-insertion
        order would make two identical outages produce different documents.
        """
        module, _ = summary
        stats = stats_with({
            'perplexity': provider_bucket(failures=1),
            'claude': provider_bucket(failures=1),
            'gemini': provider_bucket(failures=1),
        })

        health = module.assess_provider_health(stats)

        assert [entry['provider'] for entry in health['failed_providers']] == [
            'claude', 'gemini', 'perplexity',
        ]

    def test_falls_back_to_unknown_when_a_failure_carries_no_category(self, summary) -> None:
        """
        A failure with an empty category list still has to name something, or
        the dashboard renders a failed provider with no stated reason.
        """
        module, _ = summary
        stats = stats_with({'claude': provider_bucket(failures=1, error_categories=[])})

        health = module.assess_provider_health(stats)

        assert health['failed_providers'][0]['error_categories'] == ['unknown']


class TestZeroCitationsIsNotAFailure:
    """
    The deliberate design line, and the one most likely to be "helpfully"
    crossed later.

    A provider that searched and found nothing is working correctly. Treating
    an empty result as a failure would fire on exactly the obscure, long-tail
    keywords this product exists to investigate — every such run would report
    itself degraded, users would learn to ignore the signal, and the next real
    billing outage would hide inside the noise. Only a hard error counts.
    """

    def test_reports_a_provider_with_no_citations_and_no_errors_as_healthy(self, summary) -> None:
        module, _ = summary
        stats = stats_with({'openai': provider_bucket(queries=1, citations=0, failures=0)})

        health = module.assess_provider_health(stats)

        assert health['failed_providers'] == []

    def test_does_not_mark_the_run_degraded_when_a_provider_found_nothing(self, summary) -> None:
        module, _ = summary
        stats = stats_with({'openai': provider_bucket(queries=1, citations=0, failures=0)})

        health = module.assess_provider_health(stats)

        assert health['degraded'] is False

    def test_counts_a_provider_that_found_nothing_as_healthy(self, summary) -> None:
        module, _ = summary
        stats = stats_with({'openai': provider_bucket(queries=1, citations=0, failures=0)})

        health = module.assess_provider_health(stats)

        assert health['providers_healthy'] == 1

    def test_distinguishes_an_empty_search_from_a_failed_one(self, summary) -> None:
        """
        Both providers returned zero citations. Only the one that errored is
        reported — this is precisely the distinction the rollup used to discard.
        """
        module, _ = summary
        stats = stats_with({
            'openai': provider_bucket(citations=0, failures=0),
            'claude': provider_bucket(citations=0, failures=1, error_categories=['insufficient_credit']),
        })

        health = module.assess_provider_health(stats)

        assert [entry['provider'] for entry in health['failed_providers']] == ['claude']


class TestNoProvidersToAssess:
    """A summary Lambda that raises loses the whole run's report."""

    def test_reports_a_run_with_no_providers_as_not_degraded(self, summary) -> None:
        module, _ = summary

        health = module.assess_provider_health(stats_with({}))

        assert health == {
            'providers_total': 0,
            'providers_failed': 0,
            'providers_healthy': 0,
            'failed_providers': [],
            'degraded': False,
        }

    def test_ignores_a_breakdown_entry_that_is_not_a_dict(self, summary) -> None:
        module, _ = summary

        health = module.assess_provider_health(stats_with({'openai': 7}))

        assert health['failed_providers'] == []

    def test_reports_not_degraded_when_the_breakdown_key_is_missing(self, summary) -> None:
        module, _ = summary

        health = module.assess_provider_health({})

        assert health['degraded'] is False


class TestReportedStatusReflectsProviderHealth:
    """
    The status field is what a human reads first. It used to be derived from
    keyword failures alone, which is why five days of runs with a dead provider
    all said `completed`.
    """

    def test_reports_completed_when_no_keyword_and_no_provider_failed(self, summary) -> None:
        module, _ = summary
        stats = stats_with({'openai': provider_bucket(citations=7)})

        report = module.generate_report('exec-1', keyword_counts(failed=0), stats)

        assert report['status'] == 'completed'

    def test_reports_completed_degraded_when_only_a_provider_failed(self, summary) -> None:
        """
        Every keyword finished, so the old rule said `completed`. A provider
        contributed nothing, so the run's numbers are not comparable with a
        clean one and must not claim to be.
        """
        module, _ = summary
        stats = stats_with({
            'openai': provider_bucket(citations=7),
            'claude': provider_bucket(citations=0, failures=1, error_categories=['insufficient_credit']),
        })

        report = module.generate_report('exec-1', keyword_counts(failed=0), stats)

        assert report['status'] == 'completed_degraded'

    def test_reports_completed_with_errors_when_a_keyword_failed(self, summary) -> None:
        module, _ = summary
        stats = stats_with({'openai': provider_bucket(citations=7)})

        report = module.generate_report('exec-1', keyword_counts(failed=1, total=2), stats)

        assert report['status'] == 'completed_with_errors'

    def test_prefers_keyword_failure_over_provider_failure_in_the_status(self, summary) -> None:
        """
        A failed keyword is the bigger problem: its data is missing entirely,
        whereas a degraded run has data from fewer providers. Precedence is
        pinned so the two causes cannot be reordered without noticing.
        """
        module, _ = summary
        stats = stats_with({'claude': provider_bucket(citations=0, failures=1)})

        report = module.generate_report('exec-1', keyword_counts(failed=1, total=2), stats)

        assert report['status'] == 'completed_with_errors'

    def test_includes_the_provider_health_block_in_the_summary(self, summary) -> None:
        """
        The status alone says something is wrong; this block says which provider
        and why, which is what makes the report actionable.
        """
        module, _ = summary
        stats = stats_with({'claude': provider_bucket(
            citations=0, failures=1, error_categories=['insufficient_credit'],
        )})

        report = module.generate_report('exec-1', keyword_counts(failed=0), stats)

        assert report['summary']['provider_health']['failed_providers'][0]['error_categories'] == [
            'insufficient_credit',
        ]

    def test_reports_a_degraded_run_as_not_completed(self, summary) -> None:
        """
        Stated as a negative because `completed` is the specific string that
        made the outage invisible — anything but that is an improvement.
        """
        module, _ = summary
        stats = stats_with({'claude': provider_bucket(citations=0, failures=1)})

        report = module.generate_report('exec-1', keyword_counts(failed=0), stats)

        assert report['status'] != 'completed'


#: The nine providers configured in `search/handler.py`'s PROVIDER_RUNNERS.
INCIDENT_PROVIDERS = ('openai', 'perplexity', 'gemini', 'brave', 'tavily', 'exa', 'serpapi', 'firecrawl')


def incident_breakdown() -> dict[str, dict[str, Any]]:
    """The 2026-08-14 run: eight providers answering, Claude out of credit."""
    breakdown = {name: provider_bucket(queries=1, citations=4) for name in INCIDENT_PROVIDERS}
    breakdown['claude'] = provider_bucket(
        queries=1, citations=0, failures=1, error_categories=['insufficient_credit'],
    )
    return breakdown


class TestTheProductionIncidentEndToEnd:
    """
    The 2026-08-14 execution, replayed through the handler.

    Nine providers configured. Eight returned citations. Claude answered every
    query with `400 "Your credit balance is too low to access the Anthropic
    API."`. The run reported `success_rate: 100.0` and `status: completed`, and
    kept doing so until 2026-08-19 because no number in the summary could tell
    a dead provider from an unproductive one.

    These tests run the real handler over that shape and assert the report can
    no longer describe it as a clean run.
    """

    def test_does_not_report_the_incident_run_as_completed(self, summary) -> None:
        """The single assertion that would have surfaced the outage on day one."""
        module, _ = summary
        event = {
            'execution_id': 'exec-2026-08-14',
            'keyword_results': [post_crawl_keyword_result(
                result_count=9, by_provider=incident_breakdown(),
            )],
        }

        report = module.handler(event, None)

        assert report['status'] != 'completed'

    def test_reports_the_incident_run_as_completed_degraded(self, summary) -> None:
        module, _ = summary
        event = {
            'execution_id': 'exec-2026-08-14',
            'keyword_results': [post_crawl_keyword_result(
                result_count=9, by_provider=incident_breakdown(),
            )],
        }

        report = module.handler(event, None)

        assert report['status'] == 'completed_degraded'

    def test_names_claude_as_the_failed_provider(self, summary) -> None:
        module, _ = summary
        event = {
            'execution_id': 'exec-2026-08-14',
            'keyword_results': [post_crawl_keyword_result(
                result_count=9, by_provider=incident_breakdown(),
            )],
        }

        report = module.handler(event, None)

        health = report['summary']['provider_health']
        assert [entry['provider'] for entry in health['failed_providers']] == ['claude']

    def test_reports_why_claude_failed(self, summary) -> None:
        """
        `insufficient_credit` is what turns the report into an action: top up
        the Anthropic account. Without the category the user only knows Claude
        is quiet.
        """
        module, _ = summary
        event = {
            'execution_id': 'exec-2026-08-14',
            'keyword_results': [post_crawl_keyword_result(
                result_count=9, by_provider=incident_breakdown(),
            )],
        }

        report = module.handler(event, None)

        health = report['summary']['provider_health']
        assert health['failed_providers'][0]['error_categories'] == ['insufficient_credit']

    def test_reports_eight_of_nine_providers_healthy(self, summary) -> None:
        module, _ = summary
        event = {
            'execution_id': 'exec-2026-08-14',
            'keyword_results': [post_crawl_keyword_result(
                result_count=9, by_provider=incident_breakdown(),
            )],
        }

        report = module.handler(event, None)

        health = report['summary']['provider_health']
        assert (health['providers_total'], health['providers_healthy']) == (9, 8)

    def test_still_reports_every_keyword_as_successful(self, summary) -> None:
        """
        Keyword counting was never wrong, and this test says so. The pipeline
        genuinely did finish for every keyword — which is why `success_rate`
        alone could never have caught this, and why provider health had to
        become a separate signal rather than a correction to the old one.
        """
        module, _ = summary
        event = {
            'execution_id': 'exec-2026-08-14',
            'keyword_results': [post_crawl_keyword_result(
                result_count=9, by_provider=incident_breakdown(),
            )],
        }

        report = module.handler(event, None)

        assert report['summary']['keywords']['success_rate'] == 100.0
