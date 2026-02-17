"""
Deduplication Lambda Function
Normalizes URLs, deduplicates citations across providers, and prioritizes by citation count.
"""

import json
import os
import logging
import boto3
from typing import Dict, List, Any, Tuple
from datetime import datetime
from collections import defaultdict

# Import shared utilities
from shared.utils import normalize_url, get_timestamp
from shared.step_function_response import (
    step_function_error, step_function_success, log_error
)

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
CITATIONS_TABLE_NAME = os.environ['CITATIONS_TABLE_NAME']
citations_table = dynamodb.Table(CITATIONS_TABLE_NAME)


def deduplicate_citations(results: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
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
    for normalized_url, metadata in deduplicated.items():
        metadata['citation_count'] = len(metadata['citing_providers'])
    
    logger.info(f"Deduplicated {len(deduplicated)} unique citations")
    
    return deduplicated


def prioritize_citations(deduplicated: Dict[str, Dict[str, Any]], max_citations: int = 20) -> List[Dict[str, Any]]:
    """
    Prioritize citations by citation count and limit to top N.
    
    Args:
        deduplicated: Dictionary of deduplicated citations
        max_citations: Maximum number of citations to return
        
    Returns:
        List of prioritized citations with priority numbers
    """
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


def store_citations(keyword: str, citations: List[Dict[str, Any]]) -> None:
    """
    Store deduplicated citations in DynamoDB.
    
    Args:
        keyword: Search keyword
        citations: List of prioritized citations
    """
    timestamp = get_timestamp()
    
    for citation in citations:
        try:
            item = {
                'keyword': keyword,
                'normalized_url': citation['normalized_url'],
                'original_urls': citation['original_urls'],
                'citation_count': citation['citation_count'],
                'citing_providers': citation['citing_providers'],
                'priority': citation['priority'],
                'first_seen': timestamp,
                'last_updated': timestamp
            }
            
            # Use update_item with conditional expression to preserve first_seen
            citations_table.put_item(
                Item=item,
                ConditionExpression='attribute_not_exists(keyword) AND attribute_not_exists(normalized_url)'
            )
            
            logger.info(f"Stored citation: {citation['normalized_url']} (priority {citation['priority']})")
            
        except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
            # Citation already exists, update it
            try:
                citations_table.update_item(
                    Key={
                        'keyword': keyword,
                        'normalized_url': citation['normalized_url']
                    },
                    UpdateExpression='SET original_urls = :urls, citation_count = :count, '
                                   'citing_providers = :providers, priority = :priority, '
                                   'last_updated = :updated',
                    ExpressionAttributeValues={
                        ':urls': citation['original_urls'],
                        ':count': citation['citation_count'],
                        ':providers': citation['citing_providers'],
                        ':priority': citation['priority'],
                        ':updated': timestamp
                    }
                )
                logger.info(f"Updated existing citation: {citation['normalized_url']}")
            except Exception as e:
                logger.error(f"Error updating citation {citation['normalized_url']}: {e}")
                
        except Exception as e:
            logger.error(f"Error storing citation {citation['normalized_url']}: {e}")


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for citation deduplication and prioritization.
    
    Args:
        event: Input event containing search results from all providers
        context: Lambda context object
        
    Returns:
        Dictionary containing deduplicated and prioritized citations
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
            'deduplicated_citations': []
        }, f"No results for keyword: {keyword}")
    
    try:
        # Step 1: Deduplicate citations across all providers
        deduplicated = deduplicate_citations(results)
        
        # Step 2: Prioritize citations by citation count
        prioritized = prioritize_citations(deduplicated, max_citations=20)
        
        # Step 3: Store citations in DynamoDB
        store_citations(keyword, prioritized)
        
        logger.info(f"Successfully processed {len(prioritized)} citations for keyword: {keyword}")
        
        # Return prioritized citations for Crawler Lambda
        return step_function_success({
            'keyword': keyword,
            'timestamp': timestamp,
            'deduplicated_citations': prioritized
        }, f"Processed {len(prioritized)} citations for {keyword}")
        
    except Exception as e:
        log_error(e, f"deduplication for keyword {keyword}", event)
        raise
