"""
GenerateSummary Lambda Function

Aggregates results from all keyword processing, counts successes/failures,
and generates an execution report.

Requirements: 9.6
"""

import json
import logging
import os
from typing import Any

import boto3

from shared.step_function_response import log_error
from shared.utils import get_timestamp, get_timestamp_compact

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Initialize AWS clients at module level
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Optional environment variables with defaults
SUMMARY_BUCKET = os.environ.get('SUMMARY_BUCKET')


def count_results(keyword_results: list[dict[str, Any]]) -> dict[str, Any]:
    """Count successful and failed keyword processing."""
    total = len(keyword_results)
    successful = 0
    failed = 0

    for result in keyword_results:
        # Check if the keyword processing completed successfully
        # A successful result should have search results and crawled citations
        if isinstance(result, dict):
            # Check for error indicators
            if result.get('error') or result.get('status') == 'failed':
                failed += 1
            else:
                successful += 1
        else:
            failed += 1

    return {
        'total': total,
        'successful': successful,
        'failed': failed,
        'success_rate': (successful / total * 100) if total > 0 else 0
    }


def _provider_bucket(stats: dict[str, Any], provider: str) -> dict[str, Any]:
    """Return the mutable per-provider counter bucket, creating it if needed."""
    return stats['providers_breakdown'].setdefault(provider, {
        'queries': 0,
        'citations': 0,
        'failures': 0,
        'error_categories': [],
    })


def merge_provider_summary(stats: dict[str, Any], provider_summary: dict[str, Any]) -> None:
    """
    Fold the deduplication step's provider rollup into the running statistics.

    The Step Functions dedup task replaces the whole state, so the search
    step's `results` array never reaches this Lambda. Every summary written
    before this rollup existed reported `total_providers_queried: 0` and an
    empty `providers_breakdown` (AUDIT-2026-08-19 §1.3). `summarize_providers`
    in `lambda/deduplication/handler.py` produces the shape read here.
    """
    stats['total_providers_queried'] += provider_summary.get('result_count', 0)

    by_provider = provider_summary.get('by_provider') or {}
    if not isinstance(by_provider, dict):
        return

    for provider, counts in by_provider.items():
        if not isinstance(counts, dict):
            continue
        bucket = _provider_bucket(stats, provider)
        bucket['queries'] += counts.get('queries', 0)
        bucket['citations'] += counts.get('citations', 0)
        bucket['failures'] += counts.get('failures', 0)
        for category in counts.get('error_categories') or []:
            if category not in bucket['error_categories']:
                bucket['error_categories'].append(category)


def merge_raw_provider_results(stats: dict[str, Any], results: list[dict[str, Any]]) -> None:
    """
    Fold raw per-provider search rows into the running statistics.

    Only reachable when this handler is invoked directly with search output
    rather than through the state machine, which is the shape the Input
    docstring documents.
    """
    stats['total_providers_queried'] += len(results)

    for provider_result in results:
        provider = provider_result.get('provider', 'unknown')
        bucket = _provider_bucket(stats, provider)
        bucket['queries'] += 1
        bucket['citations'] += len(provider_result.get('citations', []))


def aggregate_statistics(keyword_results: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate statistics from all keyword processing."""
    stats = {
        'total_keywords': 0,
        'total_providers_queried': 0,
        'total_citations_found': 0,
        'total_unique_citations': 0,
        'total_pages_crawled': 0,
        'providers_breakdown': {},
        'keywords_processed': []
    }

    for result in keyword_results:
        if not isinstance(result, dict) or result.get('error'):
            continue

        keyword = result.get('keyword', 'unknown')
        stats['keywords_processed'].append(keyword)
        stats['total_keywords'] += 1

        # Count provider results. `provider_summary` is the rollup the
        # deduplication step echoes; the raw `results` array is the shape a
        # direct invocation with search output would carry. See the comment on
        # `merge_provider_summary` for why the rollup exists.
        provider_summary = result.get('provider_summary')
        if isinstance(provider_summary, dict):
            merge_provider_summary(stats, provider_summary)
        elif 'results' in result:
            merge_raw_provider_results(stats, result['results'])

        # Count deduplicated citations
        if 'deduplicated_citations' in result:
            unique_citations = len(result['deduplicated_citations'])
            stats['total_unique_citations'] += unique_citations

            # Count total citations before deduplication
            for citation in result['deduplicated_citations']:
                citation_count = citation.get('citation_count', 1)
                stats['total_citations_found'] += citation_count

        # Count crawled pages
        if 'crawled_results' in result:
            crawled = [r for r in result['crawled_results'] if r.get('status') == 'success']
            stats['total_pages_crawled'] += len(crawled)

    return stats


def assess_provider_health(stats: dict[str, Any]) -> dict[str, Any]:
    """
    Summarise which providers failed during the run.

    THE BUG THIS EXISTS FOR. On 2026-08-14 an execution reported
    ``success_rate: 100.0`` while Claude answered every single query with
    ``400 "Your credit balance is too low"``. It was still doing so on
    2026-08-19, so every run in between measured brand visibility with one of
    the configured providers contributing nothing — and the summary said
    everything was fine.

    Nothing was broken about the keyword counting: `count_results` asks "did
    this keyword's pipeline finish?", and it did. The gap was that no one ever
    asked "did the providers actually answer?", so a provider could be dead for
    five days without a single number moving.

    A provider is reported failed when it recorded at least one hard error.
    Zero citations alone is deliberately NOT treated as failure: a provider can
    legitimately find nothing for an obscure keyword, and conflating the two
    would cry wolf on exactly the long-tail keywords this product exists to
    investigate.
    """
    failed = []
    for provider, counts in sorted(stats.get('providers_breakdown', {}).items()):
        if not isinstance(counts, dict) or counts.get('failures', 0) <= 0:
            continue
        failed.append({
            'provider': provider,
            'failures': counts['failures'],
            'queries': counts.get('queries', 0),
            'citations': counts.get('citations', 0),
            'error_categories': counts.get('error_categories') or ['unknown'],
        })

    total = len(stats.get('providers_breakdown', {}))
    return {
        'providers_total': total,
        'providers_failed': len(failed),
        'providers_healthy': total - len(failed),
        'failed_providers': failed,
        'degraded': len(failed) > 0,
    }


def generate_report(execution_id: str, counts: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    """Generate execution report.

    ``status`` reflects provider health as well as keyword completion. It used
    to be derived from ``counts['failed']`` alone, which is why a run with a
    completely dead provider still reported ``completed`` — see
    `assess_provider_health`.
    """
    provider_health = assess_provider_health(stats)

    if counts['failed'] > 0:
        status = 'completed_with_errors'
    elif provider_health['degraded']:
        # Every keyword finished, but at least one provider contributed
        # nothing because it errored. Distinct from `completed_with_errors` so
        # the two causes stay tellable apart, and distinct from `completed` so
        # this can never again read as a clean run.
        status = 'completed_degraded'
    else:
        status = 'completed'

    return {
        'execution_id': execution_id,
        'timestamp': get_timestamp(),
        'summary': {
            'keywords': counts,
            'statistics': stats,
            'provider_health': provider_health,
        },
        'status': status,
    }


def store_summary_in_s3(report: dict[str, Any], bucket: str) -> str:
    """Store execution summary in S3."""
    execution_id = report['execution_id']
    timestamp = get_timestamp_compact()
    key = f"execution-summaries/{timestamp}-{execution_id}.json"

    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(report, indent=2),
            ContentType='application/json'
        )

        s3_uri = f"s3://{bucket}/{key}"
        logger.info(f"Summary stored in S3: {s3_uri}")
        return s3_uri
    except Exception as e:
        logger.error(f"Failed to store summary in S3: {e!s}")
        return None


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for generating execution summary.

    Input (as the state machine actually delivers it):
    {
        "execution_id": "abc-123",
        "keyword_results": [
            {
                "keyword": "best hotels in malaga",
                "provider_summary": {
                    "result_count": 4,
                    "by_provider": {"openai": {"queries": 1, "citations": 7}}
                },
                "deduplicated_citations": [...],
                "crawled_results": [...]
            },
            ...
        ]
    }

    Note there is no `results` key: the dedup task replaces the whole state, so
    the search step's raw provider rows never arrive here. `provider_summary` is
    the bounded rollup dedup echoes in their place (AUDIT-2026-08-19 §1.3). A
    raw `results` array is still accepted for direct invocations.

    Output:
    {
        "execution_id": "abc-123",
        "timestamp": "2025-01-15T10:45:00Z",
        "summary": {
            "keywords": {
                "total": 10,
                "successful": 9,
                "failed": 1,
                "success_rate": 90.0
            },
            "statistics": {
                "total_keywords": 9,
                "total_providers_queried": 36,
                "total_citations_found": 150,
                "total_unique_citations": 85,
                "total_pages_crawled": 80,
                "providers_breakdown": {...}
            }
        },
        "status": "completed_with_errors",
        "s3_location": "s3://bucket/execution-summaries/..."
    }
    """
    logger.info(f"Received event: {json.dumps(event, default=str)}")

    try:
        # Extract execution ID
        execution_id = event.get('execution_id', context.aws_request_id if context else 'unknown')

        # Extract keyword results (could be from Map state output)
        keyword_results = event.get('keyword_results', [])

        # If the event is the raw output from the Map state, it might be a list
        if isinstance(event, list):
            keyword_results = event

        logger.info(f"Processing summary for {len(keyword_results)} keyword results")

        # Count successes and failures
        counts = count_results(keyword_results)
        logger.info(f"Counts: {json.dumps(counts)}")

        # Aggregate statistics
        stats = aggregate_statistics(keyword_results)
        logger.info(f"Statistics: {json.dumps(stats, default=str)}")

        # Generate report
        report = generate_report(execution_id, counts, stats)

        # Store in S3 if bucket is configured (env var takes precedence over event)
        s3_bucket = SUMMARY_BUCKET or event.get('summary_bucket')
        if s3_bucket:
            s3_location = store_summary_in_s3(report, s3_bucket)
            if s3_location:
                report['s3_location'] = s3_location

        logger.info(f"Execution summary generated: {report['status']}")

        return report

    except Exception as e:
        log_error(e, "generate summary handler", event)
        raise
