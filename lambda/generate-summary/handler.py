"""
GenerateSummary Lambda Function

Reads every keyword's result from the ProcessKeywords Distributed Map's
ResultWriter output in S3, counts successes/failures, aggregates statistics,
writes the full execution report to S3 and returns a compact copy for the
state.

Requirements: 9.6
"""

import json
import logging
import os
from typing import Any

import boto3
from map_run_results import load_keyword_results

from shared.provider_counts import add_error_categories, empty_provider_counts
from shared.step_function_response import log_error
from shared.utils import get_timestamp, get_timestamp_compact

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Initialize AWS client at module level
s3_client = boto3.client('s3')

# Optional environment variables with defaults
SUMMARY_BUCKET = os.environ.get('SUMMARY_BUCKET')


def build_run_metadata(keyword_results: list[dict[str, Any]]) -> dict[str, Any]:
    """Describe the exact keyword/timestamp pairs delivered by the Map state.

    ``timestamp`` is populated only when every named result carries the same
    non-empty run timestamp. The alert worker treats ``None`` or multiple
    timestamps as non-comparable instead of accidentally selecting newer rows.
    """
    processed_keywords: list[dict[str, str | None]] = []
    timestamps: set[str] = set()
    missing_identity = False

    for result in keyword_results:
        if not isinstance(result, dict):
            missing_identity = True
            continue
        keyword = result.get('keyword')
        if not isinstance(keyword, str) or not keyword:
            missing_identity = True
            continue
        raw_timestamp = result.get('timestamp')
        timestamp = raw_timestamp if isinstance(raw_timestamp, str) and raw_timestamp else None
        processed_keywords.append({'keyword': keyword, 'timestamp': timestamp})
        if timestamp is None:
            missing_identity = True
        else:
            timestamps.add(timestamp)

    ordered_timestamps = sorted(timestamps)
    common_timestamp = (
        ordered_timestamps[0]
        if processed_keywords and not missing_identity and len(ordered_timestamps) == 1
        else None
    )
    return {
        'timestamp': common_timestamp,
        'timestamps': ordered_timestamps,
        'processed_keywords': processed_keywords,
    }


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
    return stats['providers_breakdown'].setdefault(provider, empty_provider_counts())


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
        add_error_categories(bucket, counts.get('error_categories') or [])


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


def _count(value: Any) -> int:
    """A non-negative integer count from a compact child result; anything else counts as zero."""
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def merge_citation_counts(stats: dict[str, Any], result: dict[str, Any]) -> None:
    """Fold one keyword's citation and crawl counts into the running statistics.

    The workflow delivers the compact ``SummarizeKeywordResult`` shape, whose
    ``unique_citations`` / ``total_citations_found`` / ``pages_crawled`` counts
    replace the citation and crawl arrays (those arrays are what used to push
    the Map output past the state limit). Direct invocations may still send
    the full ``deduplicated_citations`` / ``crawled_results`` arrays.
    """
    if 'deduplicated_citations' in result:
        citations = result['deduplicated_citations']
        stats['total_unique_citations'] += len(citations)
        # Total citations before deduplication.
        stats['total_citations_found'] += sum(citation.get('citation_count', 1) for citation in citations)
    else:
        stats['total_unique_citations'] += _count(result.get('unique_citations'))
        stats['total_citations_found'] += _count(result.get('total_citations_found'))

    if 'crawled_results' in result:
        stats['total_pages_crawled'] += sum(1 for crawled in result['crawled_results'] if crawled.get('status') == 'success')
    else:
        stats['total_pages_crawled'] += _count(result.get('pages_crawled'))


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

        merge_citation_counts(stats, result)

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


class SummaryStorageError(Exception):
    """Raised when the full report cannot be written to S3."""


def store_summary_in_s3(report: dict[str, Any], bucket: str) -> str:
    """Store the full execution report in S3 and return its S3 URI.

    Required, not best-effort: the state carries only the compact report, so
    the S3 object is the one copy of the O(N) keyword lists (and KpiAlerts
    reads them back from it).

    Raises:
        SummaryStorageError: When the write fails.
    """
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
    except Exception as error:
        raise SummaryStorageError(f"Failed to store the summary in s3://{bucket}/{key}") from error

    s3_uri = f"s3://{bucket}/{key}"
    logger.info(f"Summary stored in S3: {s3_uri}")
    return s3_uri


def compact_report(report: dict[str, Any]) -> dict[str, Any]:
    """The report without its O(N) lists, for the state (256 KiB cap) and KpiAlerts' payload.

    Drops ``summary.statistics.keywords_processed`` and
    ``run_metadata.processed_keywords`` and adds ``run_metadata.keyword_count``;
    every other field is kept. The full report is at ``s3_location``.
    """
    summary = report['summary']
    statistics = {key: value for key, value in summary['statistics'].items() if key != 'keywords_processed'}
    run_metadata = report['run_metadata']
    return {
        **report,
        'summary': {**summary, 'statistics': statistics},
        'run_metadata': {
            **{key: value for key, value in run_metadata.items() if key != 'processed_keywords'},
            'keyword_count': len(run_metadata['processed_keywords']),
        },
    }


def _event_keyword_results(event: dict[str, Any] | list[Any], context: Any) -> tuple[str, list[Any], str | None, bool]:
    """``(execution_id, keyword_results, requested summary bucket, from_map_run)`` for any supported event shape.

    The workflow sends ``map_run`` (the ProcessKeywords ResultWriter pointer);
    direct invocations may send a raw result list or ``keyword_results``.
    """
    default_id = context.aws_request_id if context else 'unknown'
    if isinstance(event, list):
        return default_id, event, None, False
    execution_id = event.get('execution_id', default_id)
    requested_bucket = event.get('summary_bucket')
    if 'map_run' in event:
        keyword_results = load_keyword_results(
            s3_client, event['map_run'], _count(event.get('keyword_count')), event.get('timestamp')
        )
        return execution_id, keyword_results, requested_bucket, True
    return execution_id, event.get('keyword_results', []), requested_bucket, False


def _build_report(execution_id: str, keyword_results: list[Any]) -> dict[str, Any]:
    counts = count_results(keyword_results)
    logger.info(f"Counts: {json.dumps(counts)}")

    stats = aggregate_statistics(keyword_results)
    logger.info(f"Statistics: {json.dumps({k: v for k, v in stats.items() if k != 'keywords_processed'}, default=str)}")

    report = generate_report(execution_id, counts, stats)
    # Add the exact Map-state run identity without changing any existing
    # summary fields or the S3 object location contract.
    report['run_metadata'] = build_run_metadata(keyword_results)
    return report


def _summary_bucket(requested_bucket: str | None, from_map_run: bool) -> str | None:
    """Where the full report goes: the env var, else the event's bucket.

    ``None`` only for a direct invocation without one, which then gets the full
    report back. A workflow run must store it: its state carries only the
    compact report.
    """
    bucket = SUMMARY_BUCKET or requested_bucket
    if not bucket and from_map_run:
        raise SummaryStorageError('No summary bucket configured for a workflow run')
    return bucket or None


def handler(event: dict[str, Any] | list[Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for generating execution summary.

    Input (as the state machine actually delivers it):
    {
        "execution_id": "abc-123",
        "map_run": {
            "MapRunArn": "arn:aws:states:...:mapRun:CitationAnalysis-Workflow/ProcessKeywords:...",
            "ResultWriterDetails": {"Bucket": "citation-analysis-keywords-123", "Key": "runs/map-results/.../manifest.json"}
        },
        "keyword_count": 10,
        "timestamp": "2025-01-15T10:30:00Z",
        "summary_bucket": "citation-analysis-keywords-123"
    }

    The per-keyword results are read from S3 (`map_run_results`); each
    succeeded one is the compact ``SummarizeKeywordResult`` shape:
        {"keyword": "best hotels in malaga", "timestamp": "...", "status": "success",
         "provider_summary": {"result_count": 4, "by_provider": {"openai": {"queries": 1, "citations": 7}}},
         "unique_citations": 5, "total_citations_found": 9, "pages_crawled": 4}

    `provider_summary` is the bounded rollup dedup echoes in place of the
    search step's raw provider rows (AUDIT-2026-08-19 §1.3). Direct
    invocations may still send ``keyword_results`` (or a raw list) in the
    older full shape, including a raw `results` array.

    Output: the report below without ``summary.statistics.keywords_processed``
    and ``run_metadata.processed_keywords``, plus ``run_metadata.keyword_count``
    and ``s3_location`` (see `compact_report`). The full report is written to
    S3 and the write is required; only a direct invocation with no bucket gets
    the full report back instead.
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
        "run_metadata": {"timestamp": "...", "timestamps": ["..."], "keyword_count": 9},
        "status": "completed_with_errors",
        "s3_location": "s3://bucket/execution-summaries/..."
    }
    """
    logger.info(f"Received event: {json.dumps(event, default=str)[:2000]}")

    try:
        execution_id, keyword_results, requested_summary_bucket, from_map_run = _event_keyword_results(event, context)
        logger.info(f"Processing summary for {len(keyword_results)} keyword results")

        report = _build_report(execution_id, keyword_results)
        s3_bucket = _summary_bucket(requested_summary_bucket, from_map_run)
        s3_location = store_summary_in_s3(report, s3_bucket) if s3_bucket else None
        logger.info(f"Execution summary generated: {report['status']}")
    except Exception as e:
        # `log_error` sanitises a dict event; a raw Map list carries nothing to redact.
        log_error(e, "generate summary handler", event if isinstance(event, dict) else None)
        raise

    if s3_location is None:
        return report
    return {**compact_report(report), 's3_location': s3_location}
