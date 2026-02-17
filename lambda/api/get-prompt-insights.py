"""
Prompt Insights API

Analyzes which prompts/keywords lead to brand mentions and provides
insights on winning vs losing prompts.

Features:
- Prompt-to-brand correlation
- Winning prompts (high brand visibility)
- Losing prompts (low/no brand visibility)
- Prompt opportunities (keywords where competitors appear but you don't)
"""

import os
import sys
import logging
import boto3
from boto3.dynamodb.conditions import Key, Attr
from typing import Dict, Any, List
from collections import defaultdict
from decimal_utils import to_int

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate
from shared.api_response import success_response
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORDS')  # Optional for fallback


def get_all_keywords() -> List[str]:
    """Get all tracked keywords from Keywords table (small table, scan is acceptable)."""
    if not KEYWORDS_TABLE:
        return []
    try:
        table = dynamodb.Table(KEYWORDS_TABLE)
        # Keywords table is small (typically <100 items), scan is acceptable
        # Using ProjectionExpression to minimize data transfer
        response = table.scan(
            ProjectionExpression='keyword',
            Limit=500  # Cap to prevent runaway scans
        )
        return [item.get('keyword', '') for item in response.get('Items', []) if item.get('keyword')]
    except Exception as e:
        logger.error(f"Error getting keywords: {e}")
        return []


def analyze_prompt_brand_correlation(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyze correlation between prompts and brand mentions.
    
    Returns insights on:
    - Which prompts trigger first-party brand mentions
    - Which prompts favor competitors
    - Opportunities where competitors appear but first-party doesn't
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    
    # Get tracked brands
    tracked_brands = config.get("tracked_brands", {})
    first_party = [b.lower() for b in tracked_brands.get("first_party", [])]
    competitors = [b.lower() for b in tracked_brands.get("competitors", [])]
    
    if not first_party:
        return {"error": "No first-party brands configured"}
    
    # Get keywords from Keywords table (small, efficient) then query SearchResults by keyword
    keywords = get_all_keywords()
    
    if not keywords:
        return {"error": "No keywords configured"}
    
    # Query search results by keyword (uses partition key - much more efficient than scan)
    items = []
    for keyword in keywords[:50]:  # Limit to 50 keywords for performance
        try:
            response = table.query(
                KeyConditionExpression=Key('keyword').eq(keyword),
                ScanIndexForward=False,  # Most recent first
                Limit=20  # Get recent results per keyword
            )
            items.extend(response.get('Items', []))
        except Exception as e:
            logger.error(f"Error querying keyword {keyword}: {e}")
            continue
    
    logger.info(f"Queried {len(items)} total items across {len(keywords)} keywords")
    
    # Group by keyword and get latest results
    keyword_results = defaultdict(list)
    for item in items:
        keyword = item.get('keyword', '')
        keyword_results[keyword].append(item)
    
    logger.info(f"Found {len(keyword_results)} unique keywords")
    
    # Analyze each keyword
    winning_prompts = []  # First-party appears prominently
    losing_prompts = []   # First-party doesn't appear or ranks low
    opportunity_prompts = []  # Competitors appear but first-party doesn't
    
    for keyword, results in keyword_results.items():
        # Get latest timestamp
        latest_ts = max(r.get('timestamp', '') for r in results)
        latest_results = [r for r in results if r.get('timestamp') == latest_ts]
        
        # Analyze brand presence
        first_party_mentions = 0
        first_party_best_rank = 999
        first_party_providers = set()
        competitor_mentions = 0
        competitor_best_rank = 999
        competitor_providers = set()
        total_providers = len(latest_results)
        
        for result in latest_results:
            provider = result.get('provider', '')
            brands = result.get('brands', [])
            
            for brand in brands:
                name = brand.get('name', '').lower()
                rank = to_int(brand.get('rank'), 999)
                mentions = to_int(brand.get('mention_count'), 1)
                classification = brand.get('classification', 'other')
                
                # Use the LLM-assigned classification directly
                if classification == 'first_party':
                    first_party_mentions += mentions
                    first_party_best_rank = min(first_party_best_rank, rank)
                    first_party_providers.add(provider)
                elif classification == 'competitor':
                    competitor_mentions += mentions
                    competitor_best_rank = min(competitor_best_rank, rank)
                    competitor_providers.add(provider)
        
        # Calculate scores
        fp_provider_coverage = len(first_party_providers) / total_providers if total_providers > 0 else 0
        comp_provider_coverage = len(competitor_providers) / total_providers if total_providers > 0 else 0
        
        prompt_data = {
            'keyword': keyword,
            'timestamp': latest_ts,
            'first_party': {
                'mentions': first_party_mentions,
                'best_rank': first_party_best_rank if first_party_best_rank < 999 else None,
                'provider_coverage': round(fp_provider_coverage * 100, 1),
                'providers': list(first_party_providers)
            },
            'competitors': {
                'mentions': competitor_mentions,
                'best_rank': competitor_best_rank if competitor_best_rank < 999 else None,
                'provider_coverage': round(comp_provider_coverage * 100, 1),
                'providers': list(competitor_providers)
            },
            'total_providers': total_providers
        }
        
        # Classify the prompt
        if first_party_mentions > 0 and first_party_best_rank <= 3:
            # Winning: First-party appears in top 3
            prompt_data['status'] = 'winning'
            prompt_data['score'] = round(
                (fp_provider_coverage * 50) + 
                ((4 - first_party_best_rank) / 3 * 30) + 
                (min(first_party_mentions, 10) / 10 * 20),
                1
            )
            winning_prompts.append(prompt_data)
        elif first_party_mentions == 0 and competitor_mentions > 0:
            # Opportunity: Competitors appear but first-party doesn't
            prompt_data['status'] = 'opportunity'
            prompt_data['opportunity_score'] = round(
                (comp_provider_coverage * 50) + 
                (min(competitor_mentions, 10) / 10 * 50),
                1
            )
            opportunity_prompts.append(prompt_data)
        elif first_party_mentions == 0 or first_party_best_rank > 5:
            # Losing: First-party doesn't appear or ranks poorly
            prompt_data['status'] = 'losing'
            prompt_data['improvement_potential'] = round(
                100 - (fp_provider_coverage * 50) - 
                ((10 - min(first_party_best_rank, 10)) / 10 * 50),
                1
            )
            losing_prompts.append(prompt_data)
        else:
            # Neutral: First-party appears but not prominently
            prompt_data['status'] = 'neutral'
            winning_prompts.append(prompt_data)
    
    # Sort results
    winning_prompts.sort(key=lambda x: x.get('score', 0), reverse=True)
    losing_prompts.sort(key=lambda x: x.get('improvement_potential', 0), reverse=True)
    opportunity_prompts.sort(key=lambda x: x.get('opportunity_score', 0), reverse=True)
    
    return {
        'total_prompts_analyzed': len(keyword_results),
        'winning_prompts': winning_prompts[:20],  # Top 20
        'losing_prompts': losing_prompts[:20],
        'opportunity_prompts': opportunity_prompts[:20],
        'summary': {
            'winning_count': len(winning_prompts),
            'losing_count': len(losing_prompts),
            'opportunity_count': len(opportunity_prompts),
            'win_rate': round(len(winning_prompts) / len(keyword_results) * 100, 1) if keyword_results else 0
        }
    }


@api_handler
@validate({
    'type': {'type': str, 'choices': ['winning', 'losing', 'opportunities', 'all'], 'default': 'all'},
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 20}
})
def handler(event: Dict[str, Any], context: Any, type: str = 'all', limit: int = 20) -> Dict[str, Any]:
    """
    API handler for prompt insights.
    
    Query params:
        - type: 'winning', 'losing', 'opportunities', or 'all' (default: all)
        - limit: Number of results per category (default: 20)
    """
    config = get_brand_config()
    insights = analyze_prompt_brand_correlation(config)
    
    # Filter by type if specified
    if type == 'winning':
        insights = {
            'winning_prompts': insights['winning_prompts'][:limit],
            'summary': insights['summary']
        }
    elif type == 'losing':
        insights = {
            'losing_prompts': insights['losing_prompts'][:limit],
            'summary': insights['summary']
        }
    elif type == 'opportunities':
        insights = {
            'opportunity_prompts': insights['opportunity_prompts'][:limit],
            'summary': insights['summary']
        }
    else:
        # Apply limit to all categories
        insights['winning_prompts'] = insights['winning_prompts'][:limit]
        insights['losing_prompts'] = insights['losing_prompts'][:limit]
        insights['opportunity_prompts'] = insights['opportunity_prompts'][:limit]
    
    return success_response(insights, event)
