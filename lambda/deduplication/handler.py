"""
Deduplication Lambda Function
Normalizes URLs, deduplicates citations across providers, and prioritizes by citation count.

Every deduplicated citation is stored in the Citations table (no cap) with its
``content_type`` (``'video'`` for a YouTube video, else ``'page'``). Only the
top ``MAX_CRAWLS_PER_KEYWORD`` go back to the workflow as
``deduplicated_citations``, the list the CrawlCitations Map crawls: it lives in
the Step Functions state, which is capped at 256 KiB.
"""

import json
import logging
import os
from collections import defaultdict
from typing import Any

import boto3

from shared import youtube
from shared.constants import MAX_CITATIONS_PER_KEYWORD_DEFAULT, MAX_KEYWORD_LENGTH
from shared.env_vars import resolve_table_env
from shared.prompt_safety import sanitize_user_input
from shared.provider_counts import add_error_categories, empty_provider_counts
from shared.step_function_response import log_error, step_function_success

# Import shared utilities
from shared.utils import get_timestamp, normalize_url

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
CITATIONS_TABLE = resolve_table_env('DYNAMODB_TABLE_CITATIONS')
citations_table = dynamodb.Table(CITATIONS_TABLE)

# How many of a keyword's citations (highest citation count first) are handed
# to the crawl Map. It bounds the Step Functions state and the crawl cost, not
# what is stored: the Citations table keeps every citation. The environment
# variable keeps its historical name, `MAX_CITATIONS_PER_KEYWORD`, so an
# operator override set before the rename still applies.
MAX_CRAWLS_PER_KEYWORD = int(
    os.environ.get('MAX_CITATIONS_PER_KEYWORD', MAX_CITATIONS_PER_KEYWORD_DEFAULT)
)


def deduplicate_citations(results: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """
    Deduplicate citations across all providers by normalized URL.

    Args:
        results: List of provider results, each containing citations

    Returns:
        Dictionary mapping normalized URLs to citation metadata
    """
    # Dictionary to store deduplicated citations
    # Key: normalized_url, Value: citation metadata
    deduplicated = defaultdict(lambda: {
        'original_urls': set(),
        'citing_providers': set(),
        'citation_count': 0
    })

    # Process citations from each provider
    for result in results:
        provider = result.get('provider', 'unknown')
        citations = result.get('citations', [])

        logger.info('Processing %s citations from %s', len(citations), provider)

        for citation_url in citations:
            if not citation_url or not isinstance(citation_url, str):
                continue

            # Normalize the URL
            normalized = normalize_url(citation_url)

            # Track original URL and provider
            deduplicated[normalized]['original_urls'].add(citation_url)
            deduplicated[normalized]['citing_providers'].add(provider)

    # Calculate citation counts
    for metadata in deduplicated.values():
        metadata['citation_count'] = len(metadata['citing_providers'])

    logger.info('Deduplicated %s unique citations', len(deduplicated))

    return deduplicated


def summarize_providers(results: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Roll up provider activity so it survives into the execution summary.

    This Lambda's payload *replaces* the Step Functions state (the task is
    declared with ``outputPath: '$.Payload'`` and no ``resultPath``), so the
    search step's ``results`` array dies here — two states before
    ``generate-summary`` reads it. Every summary ever written therefore reported
    ``total_providers_queried: 0`` and an empty ``providers_breakdown``, silently
    (AUDIT-2026-08-19 §1.3).

    Echoing a rollup rather than the raw array is deliberate. ``results`` carries
    a full ``citations`` list per provider row — ``search/handler.py`` slims
    everything *except* that to stay under the 256KB state limit. Keeping it
    alive through the crawl Map and into ``keyword_results`` would multiply the
    one unbounded field by the keyword count in a single state document, which
    is the ``States.DataLimitExceeded`` failure the slimming was written to
    prevent. This rollup is bounded by the number of providers.

    ``result_count`` counts provider-result *rows* (provider x query prompt),
    matching what ``total_providers_queried`` counted when it still worked — so
    two personas hitting one provider counts as two queries, not one.

    Args:
        results: The search step's per-provider result rows.

    ``failures`` and ``error_categories`` are what let the execution summary
    tell a dead provider from a provider that simply had nothing to report.
    This rollup used to carry only ``queries`` and ``citations``, discarding the
    ``status: 'error'`` that ``provider_error_result`` sets — so Claude
    returning ``400 credit balance is too low`` on every query arrived at the
    summary as ``{'queries': 1, 'citations': 0}``, indistinguishable from a
    successful search that found nothing, and the run reported
    ``success_rate: 100.0`` (AUDIT-2026-08-19, production).

    Returns:
        ``{'result_count': int, 'by_provider': {name: {'queries', 'citations',
        'failures', 'error_categories'}}}``
    """
    by_provider: dict[str, dict[str, Any]] = {}

    for result in results:
        provider = result.get('provider', 'unknown')
        counts = by_provider.setdefault(provider, empty_provider_counts())
        counts['queries'] += 1
        counts['citations'] += len(result.get('citations', []))

        if result.get('status') == 'error':
            counts['failures'] += 1
            # Classified upstream by `shared.provider_health`.
            add_error_categories(counts, [result.get('error_category', 'unknown')])

    return {
        'result_count': len(results),
        'by_provider': by_provider,
    }


def prioritize_citations(deduplicated: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Rank every deduplicated citation by citation count (then URL) and number it.

    Each citation carries its ``priority`` (1 = most cited) and ``content_type``.
    Nothing is dropped here; :func:`crawl_list` takes the head for the crawl Map.

    Args:
        deduplicated: Dictionary of deduplicated citations
    """
    citations_list = [
        {
            'normalized_url': normalized_url,
            'original_urls': sorted(metadata['original_urls']),
            'citation_count': metadata['citation_count'],
            'citing_providers': sorted(metadata['citing_providers']),
            'content_type': youtube.content_type_for(normalized_url),
        }
        for normalized_url, metadata in deduplicated.items()
    ]

    # Sort by citation count (descending), then by URL for consistency
    citations_list.sort(key=lambda x: (-x['citation_count'], x['normalized_url']))

    for i, citation in enumerate(citations_list):
        citation['priority'] = i + 1

    logger.info('Prioritized %s citations', len(citations_list))

    return citations_list


def crawl_list(prioritized: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The top ``MAX_CRAWLS_PER_KEYWORD`` prioritized citations: what the crawl Map receives."""
    return prioritized[:MAX_CRAWLS_PER_KEYWORD]


def total_citations_found(citations: list[dict[str, Any]]) -> int:
    """Citations before deduplication: each kept URL counts once per provider that cited it."""
    return sum(citation.get('citation_count', 1) for citation in citations)


def store_citations(keyword: str, citations: list[dict[str, Any]]) -> None:
    """
    Store deduplicated citations in DynamoDB.

    Uses a single atomic ``update_item`` per citation with
    ``first_seen = if_not_exists(first_seen, :t)`` so concurrent runs for the
    same keyword don't race. Previous implementation did a put-with-condition
    then fell back to a second update on conflict; two overlapping executions
    could both hit the put, one fails the condition, and the fallback update
    from the slower run overwrote the faster run's `priority` field
    (last-writer-wins). See audit item 21.

    Args:
        keyword: Search keyword
        citations: List of prioritized citations
    """
    timestamp = get_timestamp()

    for citation in citations:
        try:
            citations_table.update_item(
                Key={
                    'keyword': keyword,
                    'normalized_url': citation['normalized_url'],
                },
                UpdateExpression=(
                    'SET original_urls = :urls, '
                    'citation_count = :count, '
                    'citing_providers = :providers, '
                    'priority = :priority, '
                    'content_type = :content_type, '
                    'last_updated = :updated, '
                    'first_seen = if_not_exists(first_seen, :updated)'
                ),
                ExpressionAttributeValues={
                    ':urls': citation['original_urls'],
                    ':count': citation['citation_count'],
                    ':providers': citation['citing_providers'],
                    ':priority': citation['priority'],
                    ':content_type': citation['content_type'],
                    ':updated': timestamp,
                },
            )
            logger.info(
                "Stored citation: %s (priority %s)",
                citation['normalized_url'], citation['priority'],
            )
        except Exception:
            logger.exception("Error storing citation %s", citation['normalized_url'])


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for citation deduplication and prioritization.

    Args:
        event: Input event containing search results from all providers
        context: Lambda context object

    Returns:
        Dictionary containing deduplicated and prioritized citations, their
        ``total_citations_found``, plus a
        ``provider_summary`` rollup. The rollup exists because this payload
        replaces the whole Step Functions state, so the search step's
        ``results`` array cannot reach ``generate-summary`` on its own — see
        :func:`summarize_providers`.
    """
    logger.info('Received event: %s', json.dumps(event, default=str))

    # The search step used to hand back its sanitized keyword; the workflow now
    # merges nine per-provider outputs and passes the Map item's keyword, so
    # sanitize it the same way the search Lambda does before storing under it.
    # SearchResults and Citations must share one keyword key.
    raw_keyword = event.get('keyword')
    keyword = sanitize_user_input(raw_keyword, max_length=MAX_KEYWORD_LENGTH) if isinstance(raw_keyword, str) else raw_keyword
    results = event.get('results', [])
    timestamp = event.get('timestamp')

    if not keyword:
        error = ValueError("Missing required parameter: keyword")
        log_error(error, "deduplication handler", event)
        raise error

    if not results:
        logger.warning('No results provided for keyword: %s', keyword)
        return step_function_success({
            'keyword': keyword,
            'timestamp': timestamp,
            'deduplicated_citations': [],
            'total_citations_found': 0,
            'provider_summary': summarize_providers([]),
        }, f"No results for keyword: {keyword}")

    try:
        # Step 1: Deduplicate citations across all providers
        deduplicated = deduplicate_citations(results)

        # Step 2: Rank every citation by citation count
        prioritized = prioritize_citations(deduplicated)

        # Step 3: Store every citation in DynamoDB
        store_citations(keyword, prioritized)

        # Step 4: Only the head of the ranking is crawled
        to_crawl = crawl_list(prioritized)

        logger.info(
            'Stored %s citations for keyword %s; %s go to the crawler',
            len(prioritized), keyword, len(to_crawl),
        )

        # Return the crawl list for the Crawler Lambda, plus the provider
        # rollup that would otherwise be dropped with the search output, and
        # the citation total the workflow's SummarizeKeywordResult keeps once
        # the citation list itself is dropped (no intrinsic function can sum
        # it). The total counts every stored citation, not only the crawled ones.
        return step_function_success({
            'keyword': keyword,
            'timestamp': timestamp,
            'deduplicated_citations': to_crawl,
            'total_citations_found': total_citations_found(prioritized),
            'provider_summary': summarize_providers(results),
        }, f"Processed {len(prioritized)} citations for {keyword}")

    except Exception as e:
        log_error(e, f"deduplication for keyword {keyword}", event)
        raise
