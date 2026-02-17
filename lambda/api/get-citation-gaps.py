"""
Citation Gap Analysis API

Identifies citation sources where competitors are mentioned but your brand isn't.
Helps discover opportunities to get mentioned on high-value sources.

Features:
- Gap identification: Sources citing competitors but not you
- Source ranking by citation frequency
- Domain authority indicators
- Actionable recommendations
"""

import os
import sys
import logging
import boto3
from boto3.dynamodb.conditions import Key
from typing import Dict, Any, List, Set
from collections import defaultdict
from urllib.parse import urlparse

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
CITATIONS_TABLE = os.environ['DYNAMODB_TABLE_CITATIONS']
CRAWLED_CONTENT_TABLE = os.environ['DYNAMODB_TABLE_CRAWLED_CONTENT']
KEYWORDS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORDS')  # Optional for fallback


def extract_domain(url: str) -> str:
    """Extract domain from URL."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        # Remove www prefix
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain
    except Exception:
        return url


def is_first_party_domain(domain: str, config: Dict[str, Any]) -> bool:
    """
    Check if a domain belongs to a first-party brand.
    This prevents showing your own URLs as citation gaps.
    
    Uses two methods:
    1. Explicit domains from config (preferred) - e.g., ["example.com", "brand.com"]
    2. Fallback: string matching against brand names
    """
    domain_lower = domain.lower()
    
    # Method 1: Check explicit first-party domains from config
    first_party_domains = config.get('first_party_domains', [])
    for fp_domain in first_party_domains:
        fp_domain_lower = fp_domain.lower().replace('www.', '')
        if fp_domain_lower in domain_lower or domain_lower in fp_domain_lower:
            return True
    
    # Method 2: Fallback - check if brand name appears in domain
    tracked_brands = config.get('tracked_brands', {})
    first_party_brands = tracked_brands.get('first_party', [])
    
    for brand in first_party_brands:
        brand_lower = brand.lower().replace(' ', '')
        # Check if brand name is in the domain
        if brand_lower in domain_lower:
            return True
        # Check common variations (e.g., "brand" matches "brand.com")
        brand_parts = brand_lower.split()
        if any(part in domain_lower for part in brand_parts if len(part) > 3):
            return True
    
    return False


def get_crawled_content_info(url: str) -> Dict[str, Any]:
    """Get SEO info from crawled content if available."""
    try:
        table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
        response = table.query(
            KeyConditionExpression=Key('normalized_url').eq(url),
            Limit=1,
            ScanIndexForward=False  # Get most recent
        )
        items = response.get('Items', [])
        if items:
            item = items[0]
            return {
                'title': item.get('title', ''),
                'seo_analysis': item.get('seo_analysis', {}),
                'domain_authority': item.get('domain_authority'),
                'last_crawled': item.get('crawled_at')
            }
    except Exception as e:
        logger.error(f"Error getting crawled content: {e}")
    return {}


def fuzzy_match_brand(brand_name: str, parent_company: str, tracked_list: List[str]) -> bool:
    """
    Fuzzy match a brand against a list of tracked brands.
    Uses intelligent matching to handle variations like "Brand Premium" matching "Brand".
    """
    brand_name_lower = brand_name.lower()
    parent_company_lower = (parent_company or "").lower()
    
    for tracked in tracked_list:
        tracked_lower = tracked.lower()
        # Extract key words from tracked brand
        tracked_words = set(tracked_lower.split())
        
        # Direct substring match
        if tracked_lower in brand_name_lower or brand_name_lower in tracked_lower:
            return True
        
        # Parent company match
        if parent_company_lower and (tracked_lower in parent_company_lower or parent_company_lower in tracked_lower):
            return True
        
        # Word overlap match (e.g., "Brand" matches "Brand Garden Inn")
        significant_words = [w for w in tracked_words if len(w) > 3]
        for word in significant_words:
            if word in brand_name_lower:
                return True
        
        # Check if brand contains the core brand name
        core_brand = tracked_words - {'hotels', 'hotel', 'international', 'group', 'inc', 'corp', 'company'}
        for core in core_brand:
            if len(core) > 3 and core in brand_name_lower:
                return True
    
    return False


def analyze_citation_gaps(keyword: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyze citation gaps for a keyword.
    
    Identifies sources that cite competitors but not first-party brands.
    Uses the 'classification' field from brand extraction (LLM-based) as primary,
    with fuzzy matching as fallback.
    """
    search_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    
    # Get tracked brands for fallback matching
    tracked_brands = config.get("tracked_brands", {})
    first_party_list = [b.lower() for b in tracked_brands.get("first_party", [])]
    competitors_list = [b.lower() for b in tracked_brands.get("competitors", [])]
    
    if not first_party_list:
        return {"error": "No first-party brands configured"}
    
    # Query search results for keyword
    response = search_table.query(
        KeyConditionExpression=Key('keyword').eq(keyword)
    )
    items = response.get('Items', [])
    
    if not items:
        return {"error": f"No data found for keyword: {keyword}"}
    
    # Get latest results
    latest_ts = max(item.get('timestamp', '') for item in items)
    latest_items = [item for item in items if item.get('timestamp') == latest_ts]
    
    # Track which sources mention which brands
    source_brand_map = defaultdict(lambda: {
        'first_party': set(),
        'competitors': set(),
        'providers': set(),
        'citation_count': 0
    })
    
    for item in latest_items:
        provider = item.get('provider', '')
        citations = item.get('citations', [])
        brands = item.get('brands', [])
        
        # Get brand names mentioned in this response
        # Use the 'classification' field from LLM extraction as primary source
        mentioned_first_party = set()
        mentioned_competitors = set()
        
        for brand in brands:
            brand_name = brand.get('name', '')
            parent_company = brand.get('parent_company', '')
            classification = brand.get('classification', '')
            
            # Primary: use LLM classification
            if classification == 'first_party':
                mentioned_first_party.add(brand_name)
            elif classification == 'competitor':
                mentioned_competitors.add(brand_name)
            else:
                # Fallback: use fuzzy matching against tracked brands
                if fuzzy_match_brand(brand_name, parent_company, first_party_list):
                    mentioned_first_party.add(brand_name)
                elif fuzzy_match_brand(brand_name, parent_company, competitors_list):
                    mentioned_competitors.add(brand_name)
        
        # Map citations to brands
        for citation in citations:
            domain = extract_domain(citation)
            source_brand_map[citation]['providers'].add(provider)
            source_brand_map[citation]['citation_count'] += 1
            source_brand_map[citation]['domain'] = domain
            source_brand_map[citation]['first_party'].update(mentioned_first_party)
            source_brand_map[citation]['competitors'].update(mentioned_competitors)
    
    # Identify gaps: sources with competitors but no first-party
    gaps = []
    covered_sources = []
    
    for url, data in source_brand_map.items():
        domain = data['domain']
        
        # Skip first-party domains - these are never gaps
        # Your own website URLs should not appear as citation gaps
        if is_first_party_domain(domain, config):
            continue
        
        source_info = {
            'url': url,
            'domain': domain,
            'citation_count': data['citation_count'],
            'providers': list(data['providers']),
            'provider_count': len(data['providers']),
            'first_party_brands': list(data['first_party']),
            'competitor_brands': list(data['competitors'])
        }
        
        # Get additional info from crawled content
        crawled_info = get_crawled_content_info(url)
        if crawled_info:
            source_info.update(crawled_info)
        
        if data['competitors'] and not data['first_party']:
            # Gap: competitors mentioned but not first-party
            # These are high-value opportunities - sources citing competitors but not you
            source_info['gap_type'] = 'competitor_only'
            source_info['priority'] = 'high' if len(data['providers']) >= 2 else 'medium'
            gaps.append(source_info)
        elif data['first_party']:
            # Covered: first-party is mentioned on this third-party source
            covered_sources.append(source_info)
        # Note: We no longer add "neutral" sources (neither first-party nor competitors)
        # as gaps - they're not actionable opportunities
    
    # Sort gaps by priority and citation count
    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    gaps.sort(key=lambda x: (priority_order.get(x.get('priority', 'low'), 2), -x['citation_count']))
    covered_sources.sort(key=lambda x: -x['citation_count'])
    
    # Group gaps by domain
    domain_gaps = defaultdict(list)
    for gap in gaps:
        domain_gaps[gap['domain']].append(gap)
    
    # Calculate summary stats
    high_priority_gaps = [g for g in gaps if g.get('priority') == 'high']
    
    return {
        'keyword': keyword,
        'timestamp': latest_ts,
        'gaps': gaps[:50],  # Top 50 gaps
        'covered_sources': covered_sources[:20],  # Top 20 covered
        'domain_summary': [
            {
                'domain': domain,
                'gap_count': len(urls),
                'total_citations': sum(u['citation_count'] for u in urls)
            }
            for domain, urls in sorted(domain_gaps.items(), key=lambda x: -len(x[1]))[:20]
        ],
        'summary': {
            'total_sources': len(source_brand_map),
            'gap_count': len(gaps),
            'covered_count': len(covered_sources),
            'high_priority_gaps': len(high_priority_gaps),
            'coverage_rate': round(len(covered_sources) / len(source_brand_map) * 100, 1) if source_brand_map else 0
        }
    }


def analyze_all_keywords_gaps(config: Dict[str, Any], limit: int = 10) -> Dict[str, Any]:
    """Analyze citation gaps across all keywords."""
    # Get keywords from the Keywords table instead of scanning SearchResults
    # This is more efficient as Keywords table is small and purpose-built
    keywords_table_name = os.environ.get('DYNAMODB_TABLE_KEYWORDS')
    if keywords_table_name:
        keywords_table = dynamodb.Table(keywords_table_name)
        response = keywords_table.scan(
            ProjectionExpression='keyword',
            Limit=500
        )
        keywords = list(set(item.get('keyword', '') for item in response.get('Items', []) if item.get('keyword')))
    else:
        # Fallback to scanning SearchResults if Keywords table not configured
        search_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
        response = search_table.scan(
            ProjectionExpression='keyword',
            Limit=500
        )
        keywords = list(set(item.get('keyword', '') for item in response.get('Items', []) if item.get('keyword')))
    
    # Analyze each keyword
    all_gaps = []
    keyword_summaries = []
    
    for keyword in keywords[:limit]:
        result = analyze_citation_gaps(keyword, config)
        if 'error' not in result:
            keyword_summaries.append({
                'keyword': keyword,
                'gap_count': result['summary']['gap_count'],
                'high_priority_gaps': result['summary']['high_priority_gaps'],
                'coverage_rate': result['summary']['coverage_rate']
            })
            # Add top gaps from this keyword
            for gap in result['gaps'][:5]:
                gap['keyword'] = keyword
                all_gaps.append(gap)
    
    # Sort all gaps by priority
    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    all_gaps.sort(key=lambda x: (priority_order.get(x.get('priority', 'low'), 2), -x['citation_count']))
    
    return {
        'keywords_analyzed': len(keyword_summaries),
        'keyword_summaries': sorted(keyword_summaries, key=lambda x: -x['high_priority_gaps']),
        'top_gaps': all_gaps[:30],
        'total_gaps': sum(k['gap_count'] for k in keyword_summaries),
        'total_high_priority': sum(k['high_priority_gaps'] for k in keyword_summaries)
    }


@api_handler
@validate({
    'keyword': {'type': str, 'max_length': 500},
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 10}
})
def handler(event: Dict[str, Any], context: Any, keyword: str = None, limit: int = 10) -> Dict[str, Any]:
    """
    API handler for citation gap analysis.
    
    Query params:
        - keyword: Specific keyword to analyze (optional)
        - limit: Number of keywords to analyze if no keyword specified (default: 10)
    """
    config = get_brand_config()
    
    if keyword:
        # Analyze specific keyword
        result = analyze_citation_gaps(keyword, config)
    else:
        # Analyze across all keywords
        result = analyze_all_keywords_gaps(config, limit)
    
    return success_response(result, event)
