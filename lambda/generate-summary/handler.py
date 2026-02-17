"""
GenerateSummary Lambda Function

Aggregates results from all keyword processing, counts successes/failures,
and generates an execution report.

Requirements: 9.6
"""

import json
import logging
import os
import boto3
from datetime import datetime
from typing import Dict, List, Any

from shared.step_function_response import (
    step_function_error, step_function_success, log_error
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Initialize AWS clients at module level
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Optional environment variables with defaults
SUMMARY_BUCKET = os.environ.get('SUMMARY_BUCKET')


def count_results(keyword_results: List[Dict[str, Any]]) -> Dict[str, Any]:
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


def aggregate_statistics(keyword_results: List[Dict[str, Any]]) -> Dict[str, Any]:
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
        
        # Count provider results
        if 'results' in result:
            providers = result['results']
            stats['total_providers_queried'] += len(providers)
            
            for provider_result in providers:
                provider = provider_result.get('provider', 'unknown')
                if provider not in stats['providers_breakdown']:
                    stats['providers_breakdown'][provider] = {
                        'queries': 0,
                        'citations': 0
                    }
                
                stats['providers_breakdown'][provider]['queries'] += 1
                
                citations = provider_result.get('citations', [])
                stats['providers_breakdown'][provider]['citations'] += len(citations)
        
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


def generate_report(execution_id: str, counts: Dict[str, Any], stats: Dict[str, Any]) -> Dict[str, Any]:
    """Generate execution report."""
    report = {
        'execution_id': execution_id,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'summary': {
            'keywords': counts,
            'statistics': stats
        },
        'status': 'completed' if counts['failed'] == 0 else 'completed_with_errors'
    }
    
    return report


def store_summary_in_s3(report: Dict[str, Any], bucket: str) -> str:
    """Store execution summary in S3."""
    execution_id = report['execution_id']
    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
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
        logger.error(f"Failed to store summary in S3: {str(e)}")
        return None


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for generating execution summary.
    
    Input:
    {
        "execution_id": "abc-123",
        "keyword_results": [
            {
                "keyword": "best hotels in malaga",
                "results": [...],
                "deduplicated_citations": [...],
                "crawled_results": [...]
            },
            ...
        ]
    }
    
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
