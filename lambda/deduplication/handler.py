"""
Deduplication Lambda Function
Normalizes URLs, deduplicates citations across providers, and prioritizes by citation count.
"""

import json
import logging
import os
from collections import defaultdict
from typing import Any

import boto3

from shared.constants import MAX_CITATIONS_PER_KEYWORD_DEFAULT
from shared.env_vars import resolve_table_env
from shared.step_function_response import log_error, step_function_success

# Import shared utilities
from shared.utils import get_timestamp, normalize_url

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables. Reads the canonical
# DYNAMODB_TABLE_CITATIONS name first, falls back to the legacy
# CITATIONS_TABLE_NAME until the CDK stack stops setting it (audit #12).
CITATIONS_TABLE = resolve_table_env(
    'DYNAMODB_TABLE_CITATIONS', 'CITATIONS_TABLE_NAME', 'CITATIONS_TABLE',
)
citations_table = dynamodb.Table(CITATIONS_TABLE)

# Runtime override for the citations-per-keyword cap. Defaults to the shared
# constant; setting `MAX_CITATIONS_PER_KEYWORD` in the Lambda environment lets
# operators tune the cap without redeploying code.
MAX_CITATIONS_PER_KEYWORD = int(
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

        logger.info(f"Processing {len(citations)} citations from {provider}")

        for citation_url in citations:
            if not citation_url or not isinstance(citation_url, str):
                continue

            # Normalize the URL
            normalized = normalize_url(citation_url)

            # Track original URL and provider
            deduplicated[normalized]['original_urls'].add(citation_url)
            deduplicated[normalized]['citing_providers'].add(provider)

    # Calculate citation counts
    for _, metadata in deduplicated.items():
        metadata['citation_count'] = len(metadata['citing_providers'])

    logger.info(f"Deduplicated {len(deduplicated)} unique citations")

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
        counts = by_provider.setdefault(provider, {
            'queries': 0,
            'citations': 0,
            'failures': 0,
            'error_categories': [],
        })
        counts['queries'] += 1
        counts['citations'] += len(result.get('citations', []))

        if result.get('status') == 'error':
            counts['failures'] += 1
            # Classified upstream by `shared.provider_health`. Kept as a list
            # so a provider failing two different ways in one run reports both
            # rather than the last one silently winning.
            category = result.get('error_category', 'unknown')
            if category not in counts['error_categories']:
                counts['error_categories'].append(category)

    return {
        'result_count': len(results),
        'by_provider': by_provider,
    }


def prioritize_citations(
    deduplicated: dict[str, dict[str, Any]],
    max_citations: int | None = None,
) -> list[dict[str, Any]]:
    """
    Prioritize citations by citation count and limit to top N.

    Args:
        deduplicated: Dictionary of deduplicated citations
        max_citations: Maximum number of citations to return. Defaults to
            the module-level ``MAX_CITATIONS_PER_KEYWORD`` (overridable via
            env var). Pass an explicit value for per-call overrides in
            tests or migration scripts.
    """
    if max_citations is None:
        max_citations = MAX_CITATIONS_PER_KEYWORD

    # Convert to list and sort by citation count (descending)
    citations_list = []
    for normalized_url, metadata in deduplicated.items():
        citations_list.append({
            'normalized_url': normalized_url,
            'original_urls': list(metadata['original_urls']),
            'citation_count': metadata['citation_count'],
            'citing_providers': sorted(list(metadata['citing_providers']))
        })

    # Sort by citation count (descending), then by URL for consistency
    citations_list.sort(key=lambda x: (-x['citation_count'], x['normalized_url']))

    # Limit to top N and assign priority numbers
    prioritized = []
    for i, citation in enumerate(citations_list[:max_citations]):
        citation['priority'] = i + 1
        prioritized.append(citation)

    logger.info(f"Prioritized top {len(prioritized)} citations")

    return prioritized


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
                    'last_updated = :updated, '
                    'first_seen = if_not_exists(first_seen, :updated)'
                ),
                ExpressionAttributeValues={
                    ':urls': citation['original_urls'],
                    ':count': citation['citation_count'],
                    ':providers': citation['citing_providers'],
                    ':priority': citation['priority'],
                    ':updated': timestamp,
                },
            )
            logger.info(
                "Stored citation: %s (priority %s)",
                citation['normalized_url'], citation['priority'],
            )
        except Exception as e:
            logger.error(
                "Error storing citation %s: %s",
                citation['normalized_url'], e,
            )


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for citation deduplication and prioritization.

    Args:
        event: Input event containing search results from all providers
        context: Lambda context object

    Returns:
        Dictionary containing deduplicated and prioritized citations, plus a
        ``provider_summary`` rollup. The rollup exists because this payload
        replaces the whole Step Functions state, so the search step's
        ``results`` array cannot reach ``generate-summary`` on its own — see
        :func:`summarize_providers`.
    """
    logger.info(f"Received event: {json.dumps(event, default=str)}")

    keyword = event.get('keyword')
    results = event.get('results', [])
    timestamp = event.get('timestamp')

    if not keyword:
        error = ValueError("Missing required parameter: keyword")
        log_error(error, "deduplication handler", event)
        raise error

    if not results:
        logger.warning(f"No results provided for keyword: {keyword}")
        return step_function_success({
            'keyword': keyword,
            'timestamp': timestamp,
            'deduplicated_citations': [],
            'provider_summary': summarize_providers([]),
        }, f"No results for keyword: {keyword}")

    try:
        # Step 1: Deduplicate citations across all providers
        deduplicated = deduplicate_citations(results)

        # Step 2: Prioritize citations by citation count (top N from shared config)
        prioritized = prioritize_citations(deduplicated)

        # Step 3: Store citations in DynamoDB
        store_citations(keyword, prioritized)

        logger.info(f"Successfully processed {len(prioritized)} citations for keyword: {keyword}")

        # Return prioritized citations for Crawler Lambda, plus the provider
        # rollup that would otherwise be dropped with the search output.
        return step_function_success({
            'keyword': keyword,
            'timestamp': timestamp,
            'deduplicated_citations': prioritized,
            'provider_summary': summarize_providers(results),
        }, f"Processed {len(prioritized)} citations for {keyword}")

    except Exception as e:
        log_error(e, f"deduplication for keyword {keyword}", event)
        raise
