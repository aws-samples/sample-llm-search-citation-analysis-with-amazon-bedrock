"""
Recommendations API

Generates actionable recommendations to improve AI visibility based on
analysis of current data. Uses rule-based logic and optionally LLM for
more sophisticated recommendations.

Recommendation Types:
- Citation gaps to fill
- Content optimization suggestions
- Prompt targeting opportunities
- Competitor insights
"""

import json
import os
import sys
import logging
import boto3
from boto3.dynamodb.conditions import Key
from typing import Dict, Any, List
from collections import defaultdict
from datetime import datetime
from decimal_utils import to_int

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate
from shared.api_response import success_response
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
bedrock = boto3.client('bedrock-runtime')  # No region needed for global inference profiles

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
CITATIONS_TABLE = os.environ['DYNAMODB_TABLE_CITATIONS']
CRAWLED_CONTENT_TABLE = os.environ['DYNAMODB_TABLE_CRAWLED_CONTENT']
KEYWORDS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORDS')  # Optional for fallback


def invoke_converse(prompt: str, model_id: str, max_tokens: int = 2000, temperature: float = 0) -> str:
    """
    Invoke Bedrock using the Converse API.
    
    Args:
        prompt: The prompt to send
        model_id: Model ID to use
        max_tokens: Maximum tokens in response
        temperature: Temperature for generation
        
    Returns:
        Response text from the model
    """
    response = bedrock.converse(
        modelId=model_id,
        messages=[
            {'role': 'user', 'content': [{'text': prompt}]}
        ],
        inferenceConfig={
            'maxTokens': max_tokens,
            'temperature': temperature
        }
    )
    
    output = response.get('output', {})
    message = output.get('message', {})
    content_blocks = message.get('content', [])
    return content_blocks[0].get('text', '') if content_blocks else ''


def generate_rule_based_recommendations(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Generate recommendations based on rule-based analysis.
    """
    recommendations = []
    search_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    
    # Get tracked brands
    tracked_brands = config.get("tracked_brands", {})
    first_party = [b.lower() for b in tracked_brands.get("first_party", [])]
    competitors = [b.lower() for b in tracked_brands.get("competitors", [])]
    
    if not first_party:
        recommendations.append({
            'type': 'configuration',
            'priority': 'high',
            'title': 'Configure First-Party Brands',
            'description': 'Add your brand names to the configuration to enable visibility tracking and recommendations.',
            'action': 'Go to Settings > Brand Configuration and add your brands under "First Party"',
            'impact': 'Required for all other recommendations'
        })
        return recommendations
    
    # Get keywords from Keywords table (small, efficient scan)
    # Then query SearchResults by keyword (uses partition key)
    keywords_table_name = os.environ.get('DYNAMODB_TABLE_KEYWORDS')
    keywords = []
    if keywords_table_name:
        keywords_table = dynamodb.Table(keywords_table_name)
        kw_response = keywords_table.scan(
            ProjectionExpression='keyword',
            FilterExpression='#status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': 'active'},
            Limit=100
        )
        keywords = [item.get('keyword', '') for item in kw_response.get('Items', []) if item.get('keyword')]
    
    if not keywords:
        # Fallback: scan with limit
        response = search_table.scan(Limit=500)
        items = response.get('Items', [])
    else:
        # Query by each keyword (more efficient for large tables)
        items = []
        for keyword in keywords[:20]:  # Limit to 20 keywords for performance
            try:
                response = search_table.query(
                    KeyConditionExpression=Key('keyword').eq(keyword),
                    ScanIndexForward=False,
                    Limit=20  # Get recent results per keyword
                )
                items.extend(response.get('Items', []))
            except Exception as e:
                logger.error(f"Error querying keyword {keyword}: {e}")
                continue
    
    if not items:
        recommendations.append({
            'type': 'data',
            'priority': 'high',
            'title': 'Run Your First Analysis',
            'description': 'No search data found. Run an analysis to start tracking your AI visibility.',
            'action': 'Go to Run Analysis and trigger a new analysis',
            'impact': 'Required to generate insights'
        })
        return recommendations
    
    # Group by keyword
    keyword_data = defaultdict(list)
    for item in items:
        keyword_data[item.get('keyword', '')].append(item)
    
    # Analyze each keyword
    keywords_without_fp = []
    keywords_with_low_rank = []
    keywords_with_competitor_dominance = []
    provider_gaps = defaultdict(list)  # provider -> keywords where FP doesn't appear
    
    for keyword, results in keyword_data.items():
        # Get latest results
        latest_ts = max(r.get('timestamp', '') for r in results)
        latest = [r for r in results if r.get('timestamp') == latest_ts]
        
        fp_found = False
        fp_best_rank = 999
        fp_providers = set()
        comp_mentions = 0
        all_providers = set()
        
        for result in latest:
            provider = result.get('provider', '')
            all_providers.add(provider)
            brands = result.get('brands', [])
            
            for brand in brands:
                name = brand.get('name', '').lower()
                rank = to_int(brand.get('rank'), 999)
                
                if any(fp in name or name in fp for fp in first_party):
                    fp_found = True
                    fp_best_rank = min(fp_best_rank, rank)
                    fp_providers.add(provider)
                elif any(comp in name or name in comp for comp in competitors):
                    comp_mentions += 1
        
        # Track provider gaps
        for provider in all_providers:
            if provider not in fp_providers:
                provider_gaps[provider].append(keyword)
        
        if not fp_found:
            keywords_without_fp.append({
                'keyword': keyword,
                'competitor_mentions': comp_mentions
            })
        elif fp_best_rank > 3:
            keywords_with_low_rank.append({
                'keyword': keyword,
                'rank': fp_best_rank,
                'providers': list(fp_providers)
            })
        
        if comp_mentions > 0 and (not fp_found or fp_best_rank > comp_mentions):
            keywords_with_competitor_dominance.append({
                'keyword': keyword,
                'competitor_mentions': comp_mentions,
                'fp_rank': fp_best_rank if fp_found else None
            })
    
    # Generate recommendations based on analysis
    
    # 1. Keywords where first-party doesn't appear
    if keywords_without_fp:
        top_gaps = sorted(keywords_without_fp, key=lambda x: -x['competitor_mentions'])[:5]
        recommendations.append({
            'type': 'visibility_gap',
            'priority': 'high',
            'title': f'Missing from {len(keywords_without_fp)} Keywords',
            'description': f'Your brand doesn\'t appear in AI responses for {len(keywords_without_fp)} tracked keywords where competitors are mentioned.',
            'action': 'Create content targeting these keywords and ensure your brand is mentioned on authoritative sources.',
            'keywords': [k['keyword'] for k in top_gaps],
            'impact': f'Potential to capture {sum(k["competitor_mentions"] for k in keywords_without_fp)} competitor mentions'
        })
    
    # 2. Low ranking keywords
    if keywords_with_low_rank:
        recommendations.append({
            'type': 'ranking',
            'priority': 'medium',
            'title': f'Low Rankings on {len(keywords_with_low_rank)} Keywords',
            'description': 'Your brand appears but ranks below position 3 on these keywords.',
            'action': 'Improve content quality and get more citations from authoritative sources for these topics.',
            'keywords': [f"{k['keyword']} (rank {k['rank']})" for k in keywords_with_low_rank[:5]],
            'impact': 'Moving to top 3 can significantly increase visibility'
        })
    
    # 3. Provider-specific gaps
    for provider, keywords in provider_gaps.items():
        if len(keywords) >= 3:
            recommendations.append({
                'type': 'provider_gap',
                'priority': 'medium',
                'title': f'Not Appearing on {provider.title()}',
                'description': f'Your brand doesn\'t appear in {provider.title()} responses for {len(keywords)} keywords.',
                'action': f'Research what sources {provider.title()} prefers and ensure your brand is mentioned there.',
                'keywords': keywords[:5],
                'impact': f'Expand visibility to {provider.title()} users'
            })
    
    # 4. Competitor dominance
    if keywords_with_competitor_dominance:
        top_dominated = sorted(keywords_with_competitor_dominance, key=lambda x: -x['competitor_mentions'])[:3]
        recommendations.append({
            'type': 'competitive',
            'priority': 'high',
            'title': 'Competitors Dominating Key Terms',
            'description': 'Competitors are mentioned more frequently than your brand on important keywords.',
            'action': 'Analyze competitor content strategy and citation sources. Create superior content.',
            'keywords': [k['keyword'] for k in top_dominated],
            'impact': 'Reclaim market share in AI search results'
        })
    
    # 5. General best practices
    if len(recommendations) < 3:
        recommendations.append({
            'type': 'best_practice',
            'priority': 'low',
            'title': 'Maintain Citation Freshness',
            'description': 'Regularly update your content and ensure citations remain current.',
            'action': 'Review and refresh content quarterly. Monitor for broken links.',
            'impact': 'Sustained visibility over time'
        })
    
    # Sort by priority
    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    recommendations.sort(key=lambda x: priority_order.get(x.get('priority', 'low'), 2))
    
    return recommendations


def generate_llm_recommendations(config: Dict[str, Any], context: str) -> List[Dict[str, Any]]:
    """
    Generate recommendations using LLM for more sophisticated analysis.
    """
    try:
        prompt = f"""Analyze this AI visibility data and provide 3-5 specific, actionable recommendations.

Context:
{context}

Brand Configuration:
- First Party Brands: {config.get('tracked_brands', {}).get('first_party', [])}
- Competitors: {config.get('tracked_brands', {}).get('competitors', [])}
- Industry: {config.get('industry', 'general')}

Provide recommendations in this JSON format:
[
  {{
    "type": "category",
    "priority": "high/medium/low",
    "title": "Short title",
    "description": "Detailed description",
    "action": "Specific action to take",
    "impact": "Expected impact"
  }}
]

Focus on:
1. Quick wins that can improve visibility immediately
2. Strategic moves to outperform competitors
3. Content and citation opportunities
4. Provider-specific optimizations"""

        content = invoke_converse(prompt, 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', max_tokens=2000)
        
        # Extract JSON from response
        import re
        json_match = re.search(r'\[[\s\S]*\]', content)
        if json_match:
            return json.loads(json_match.group())
        
    except Exception as e:
        logger.error(f"LLM recommendation error: {e}")
    
    return []


@api_handler
@validate({
    'use_llm': {'type': bool, 'default': False},
    'keyword': {'type': str, 'max_length': 500}
})
def handler(event: Dict[str, Any], context: Any, use_llm: bool = False, keyword: str = None) -> Dict[str, Any]:
    """
    API handler for recommendations.
    
    Query params:
        - use_llm: Whether to use LLM for enhanced recommendations (default: false)
        - keyword: Focus recommendations on specific keyword (optional)
    """
    config = get_brand_config()
    
    # Generate rule-based recommendations
    recommendations = generate_rule_based_recommendations(config)
    
    # Optionally enhance with LLM
    llm_recommendations = []
    if use_llm and recommendations:
        context_str = json.dumps(recommendations[:5], indent=2)
        llm_recommendations = generate_llm_recommendations(config, context_str)
    
    result = {
        'generated_at': datetime.utcnow().isoformat() + 'Z',
        'recommendations': recommendations,
        'llm_enhanced': llm_recommendations if llm_recommendations else None,
        'total_count': len(recommendations),
        'by_priority': {
            'high': len([r for r in recommendations if r.get('priority') == 'high']),
            'medium': len([r for r in recommendations if r.get('priority') == 'medium']),
            'low': len([r for r in recommendations if r.get('priority') == 'low'])
        }
    }
    
    return success_response(result, event)
