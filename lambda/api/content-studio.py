"""
Content Studio API

Generates content ideas based on visibility gaps, competitor analysis, and keyword opportunities.
Uses Bedrock Claude to generate optimized content based on competitor examples.

Endpoints:
- GET /content-studio/ideas - Get content ideas from multiple sources
- POST /content-studio/generate - Generate content for an idea
- GET /content-studio/history - Get generated content history
- DELETE /content-studio/{id} - Delete generated content
"""

import hashlib
import json
import logging
import os
import sys
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from decimal_utils import to_int
from shared.api_response import api_response, success_response, validation_error
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.dynamodb_batch import query_latest_per_key
from shared.models import BedrockInvocationError, ModelRole, get_model_tier, invoke_bedrock
from shared.prompt_safety import untrusted_input_system_instruction, wrap_user_input
from shared.utils import classify_brand, extract_domain, get_brand_config, get_timestamp, utc_now

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
CITATIONS_TABLE = os.environ['DYNAMODB_TABLE_CITATIONS']
CRAWLED_CONTENT_TABLE = os.environ['DYNAMODB_TABLE_CRAWLED_CONTENT']
CONTENT_STUDIO_TABLE = os.environ['DYNAMODB_TABLE_CONTENT_STUDIO']
KEYWORDS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORDS')  # Optional for fallback
GENERATION_TIMEOUT_SECONDS = int(os.environ.get('GENERATION_TIMEOUT_SECONDS', '240'))


def _get_seasonal_suggestions(keywords: list[str], config: dict[str, Any]) -> list[dict[str, Any]]:
    """Generate seasonal and trending content suggestions based on current date and keywords."""
    ideas = []
    now = utc_now()
    month = now.month
    industry = config.get('industry', 'general')

    # Seasonal themes by month
    seasonal_themes = {
        1: ['new year', 'winter', 'january deals', 'fresh start'],
        2: ['valentine', 'romantic', 'couples', 'winter getaway'],
        3: ['spring break', 'march', 'spring travel', 'easter'],
        4: ['spring', 'easter', 'april', 'outdoor'],
        5: ['memorial day', 'spring', 'may', 'mother\'s day'],
        6: ['summer', 'june', 'father\'s day', 'graduation'],
        7: ['summer vacation', 'july', 'independence day', 'beach'],
        8: ['back to school', 'august', 'summer', 'late summer'],
        9: ['fall', 'september', 'labor day', 'autumn'],
        10: ['fall', 'october', 'halloween', 'autumn travel'],
        11: ['thanksgiving', 'november', 'black friday', 'holiday prep'],
        12: ['holiday', 'christmas', 'december', 'new year', 'winter']
    }

    # Industry-specific seasonal content
    industry_seasonal = {
        'hotels': {
            1: 'Winter Escape Packages',
            2: 'Romantic Getaway Guide',
            3: 'Spring Break Destinations',
            6: 'Summer Family Vacation Guide',
            11: 'Holiday Travel Planning',
            12: 'New Year\'s Eve Celebrations'
        },
        'restaurants': {
            2: 'Valentine\'s Day Dining Guide',
            5: 'Mother\'s Day Brunch Spots',
            6: 'Father\'s Day Dinner Ideas',
            11: 'Thanksgiving Dining Options',
            12: 'Holiday Party Venues'
        },
        'retail': {
            8: 'Back to School Shopping Guide',
            11: 'Black Friday Deals Preview',
            12: 'Holiday Gift Guide'
        },
        'travel': {
            3: 'Spring Break Planning',
            6: 'Summer Vacation Ideas',
            12: 'Holiday Travel Tips'
        }
    }

    current_themes = seasonal_themes.get(month, [])
    industry_content = industry_seasonal.get(industry, {}).get(month)

    # Check if any keywords relate to seasonal themes
    for keyword in keywords[:10]:  # Limit to first 10 keywords
        keyword_lower = keyword.lower()
        for theme in current_themes:
            if theme in keyword_lower or any(word in keyword_lower for word in theme.split()):
                ideas.append({
                    'id': str(uuid.uuid4()),
                    'type': 'seasonal_content',
                    'priority': 'medium',
                    'title': f'Seasonal Content: "{keyword}"',
                    'description': f'This keyword is relevant for {theme} season. Create timely content to capture seasonal traffic.',
                    'keyword': keyword,
                    'source': 'seasonal_analysis',
                    'seasonal_theme': theme,
                    'competitor_urls': [],
                    'actionable': True,
                    'content_angle': 'seasonal'
                })
                break  # Only one seasonal idea per keyword

    # Add industry-specific seasonal suggestion if available
    if industry_content and keywords:
        ideas.append({
            'id': str(uuid.uuid4()),
            'type': 'trending_topic',
            'priority': 'medium',
            'title': f'Trending: {industry_content}',
            'description': f'Create content for this trending topic in {industry}. High search volume expected this month.',
            'keyword': keywords[0] if keywords else industry_content.lower().replace(' ', '-'),
            'source': 'trend_analysis',
            'trending_topic': industry_content,
            'competitor_urls': [],
            'actionable': True,
            'content_angle': 'trending'
        })

    # Add evergreen content suggestion
    if keywords:
        ideas.append({
            'id': str(uuid.uuid4()),
            'type': 'evergreen_content',
            'priority': 'low',
            'title': f'Evergreen Guide: Ultimate {keywords[0].title()} Resource',
            'description': 'Create comprehensive evergreen content that ranks year-round and establishes authority.',
            'keyword': keywords[0],
            'source': 'evergreen_analysis',
            'competitor_urls': [],
            'actionable': True,
            'content_angle': 'evergreen'
        })

    return ideas


def get_crawled_content(urls: list[str], limit: int = 5) -> list[dict[str, Any]]:
    """Get crawled content for competitor analysis.

    Queries are parallelized via ``shared.dynamodb_batch.query_latest_per_key``.
    Wall-clock stays ~constant regardless of URL count instead of scaling
    linearly (audit item 16).
    """
    table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
    urls_slice = urls[:limit]
    latest = query_latest_per_key(
        table=table,
        partition_key_name='normalized_url',
        partition_values=urls_slice,
    )

    content_list: list[dict[str, Any]] = []
    for url in urls_slice:
        item = latest.get(url)
        if not item:
            continue
        content_list.append({
            'url': url,
            'title': item.get('title', ''),
            'content_preview': item.get('content', '')[:2000] if item.get('content') else '',
            'seo_analysis': item.get('seo_analysis', {}),
            'domain': extract_domain(url),
        })
    return content_list


def generate_content_ideas(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Generate content ideas from multiple sources."""
    ideas = []

    search_table = dynamodb.Table(SEARCH_RESULTS_TABLE)

    tracked_brands = config.get("tracked_brands", {})
    first_party = [b.lower() for b in tracked_brands.get("first_party", [])]
    competitors = [b.lower() for b in tracked_brands.get("competitors", [])]

    if not first_party:
        return [{
            'id': str(uuid.uuid4()),
            'type': 'configuration',
            'priority': 'high',
            'title': 'Configure Your Brands First',
            'description': 'Add your brand names in Settings to enable content recommendations.',
            'keyword': None,
            'source': 'system',
            'competitor_urls': [],
            'actionable': False
        }]

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
        for keyword in keywords[:30]:  # Limit to 30 keywords for performance
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
        return [{
            'id': str(uuid.uuid4()),
            'type': 'data',
            'priority': 'high',
            'title': 'Run Your First Analysis',
            'description': 'No search data found. Run an analysis to generate content ideas.',
            'keyword': None,
            'source': 'system',
            'competitor_urls': [],
            'actionable': False
        }]

    keyword_data = defaultdict(list)
    has_any_brands = False
    for item in items:
        keyword_data[item.get('keyword', '')].append(item)
        if item.get('brands'):
            has_any_brands = True

    # If no brand data extracted yet, show citation-based opportunities
    if not has_any_brands:
        for keyword, results in keyword_data.items():
            if not keyword:
                continue
            all_citations = []
            for result in results:
                all_citations.extend(result.get('citations', []))

            if all_citations:
                ideas.append({
                    'id': str(uuid.uuid4()),
                    'type': 'citation_opportunity',
                    'priority': 'medium',
                    'title': f'Analyze Citations for "{keyword}"',
                    'description': f'Found {len(set(all_citations))} unique citations. Brand extraction not yet run for this data.',
                    'keyword': keyword,
                    'source': 'citation_analysis',
                    'competitor_urls': list(set(all_citations))[:10],
                    'actionable': True,
                    'content_angle': 'comprehensive_guide'
                })
        return ideas[:30]

    # Analyze each keyword for opportunities based on brand data
    for keyword, results in keyword_data.items():
        if not keyword:
            continue

        latest_ts = max(r.get('timestamp', '') for r in results)
        latest = [r for r in results if r.get('timestamp') == latest_ts]

        fp_found = False
        fp_best_rank = 999
        fp_providers = set()
        fp_sentiment = []
        comp_mentions = []
        all_providers = set()
        competitor_citations = []
        all_citations = []

        for result in latest:
            provider = result.get('provider', '')
            all_providers.add(provider)
            brands = result.get('brands', [])
            citations = result.get('citations', [])
            all_citations.extend(citations)

            for brand in brands:
                rank = to_int(brand.get('rank'), 999)
                sentiment = brand.get('sentiment', 'neutral')

                # LLM classification is authoritative; exact-name fallback only
                # for legacy records (see shared.utils.classify_brand).
                is_first_party, is_competitor = classify_brand(brand, first_party, competitors)

                if is_first_party:
                    fp_found = True
                    fp_best_rank = min(fp_best_rank, rank)
                    fp_providers.add(provider)
                    fp_sentiment.append(sentiment)
                elif is_competitor:
                    comp_mentions.append({'name': brand.get('name'), 'rank': rank, 'provider': provider})
                    competitor_citations.extend(citations)

        competitor_citations = list(set(competitor_citations))[:10]
        all_citations = list(set(all_citations))[:10]

        # Visibility gap: competitors appear but you don't
        if not fp_found and comp_mentions:
            ideas.append({
                'id': str(uuid.uuid4()),
                'type': 'visibility_gap',
                'priority': 'high',
                'title': f'Create Content for "{keyword}"',
                'description': f'Your brand doesn\'t appear but {len(comp_mentions)} competitors do.',
                'keyword': keyword,
                'source': 'visibility_analysis',
                'competitor_brands': [c['name'] for c in comp_mentions[:5]],
                'competitor_urls': competitor_citations,
                'providers_missing': list(all_providers),
                'actionable': True,
                'content_angle': 'comprehensive_guide'
            })
        # Ranking improvement: you appear but not in top 2 (lowered threshold)
        elif fp_found and fp_best_rank > 2 and comp_mentions:
            ideas.append({
                'id': str(uuid.uuid4()),
                'type': 'ranking_improvement',
                'priority': 'medium' if fp_best_rank > 3 else 'low',
                'title': f'Improve Ranking for "{keyword}"',
                'description': f'Your brand ranks #{fp_best_rank}. Create better content to reach #1.',
                'keyword': keyword,
                'source': 'ranking_analysis',
                'current_rank': fp_best_rank,
                'competitor_brands': [c['name'] for c in comp_mentions[:3]],
                'competitor_urls': competitor_citations,
                'providers_present': list(fp_providers),
                'actionable': True,
                'content_angle': 'differentiation'
            })
        # Leadership maintenance: you're #1 or #2 - keep the momentum
        elif fp_found and fp_best_rank <= 2:
            ideas.append({
                'id': str(uuid.uuid4()),
                'type': 'leadership_maintenance',
                'priority': 'low',
                'title': f'Maintain Leadership for "{keyword}"',
                'description': f'You\'re #{fp_best_rank}! Create fresh content to stay ahead of {len(comp_mentions)} competitors.',
                'keyword': keyword,
                'source': 'leadership_analysis',
                'current_rank': fp_best_rank,
                'competitor_brands': [c['name'] for c in comp_mentions[:3]],
                'competitor_urls': all_citations,
                'providers_present': list(fp_providers),
                'actionable': True,
                'content_angle': 'thought_leadership'
            })

        # Provider gap: you appear on some providers but not others
        missing_providers = all_providers - fp_providers
        if fp_found and missing_providers:
            ideas.append({
                'id': str(uuid.uuid4()),
                'type': 'provider_gap',
                'priority': 'medium',
                'title': f'Target {", ".join(missing_providers).title()} for "{keyword}"',
                'description': f'Your brand appears on some AI engines but not on {", ".join(missing_providers)}.',
                'keyword': keyword,
                'source': 'provider_analysis',
                'providers_missing': list(missing_providers),
                'providers_present': list(fp_providers),
                'competitor_urls': competitor_citations,
                'actionable': True,
                'content_angle': 'provider_optimization'
            })

        # Sentiment improvement: you appear but with negative sentiment
        negative_count = sum(1 for s in fp_sentiment if s == 'negative')
        if fp_found and negative_count > 0:
            ideas.append({
                'id': str(uuid.uuid4()),
                'type': 'sentiment_improvement',
                'priority': 'high',
                'title': f'Address Negative Sentiment for "{keyword}"',
                'description': f'Your brand has negative sentiment in {negative_count} provider(s). Create positive content.',
                'keyword': keyword,
                'source': 'sentiment_analysis',
                'current_rank': fp_best_rank,
                'competitor_urls': all_citations,
                'providers_present': list(fp_providers),
                'actionable': True,
                'content_angle': 'reputation_management'
            })

    # Add seasonal/trending content ideas based on keywords
    seasonal_keywords = _get_seasonal_suggestions(list(keyword_data.keys()), config)
    ideas.extend(seasonal_keywords)

    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    ideas.sort(key=lambda x: (priority_order.get(x.get('priority', 'low'), 2), x.get('keyword', '')))
    return ideas[:50]  # Increased from 30 to 50


def generate_content(idea: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """Generate content using Bedrock Claude based on idea and competitor analysis."""
    keyword = idea.get('keyword', '')
    content_angle = idea.get('content_angle', 'comprehensive_guide')
    competitor_urls = idea.get('competitor_urls', [])

    # Get competitor content for analysis
    competitor_content = get_crawled_content(competitor_urls, limit=3)

    tracked_brands = config.get("tracked_brands", {})
    first_party = tracked_brands.get("first_party", [])
    brand_name_raw = first_party[0] if first_party else "your brand"
    industry_raw = config.get("industry", "general")

    # Wrap user-controlled interpolation values. Keyword, brand name, industry,
    # and idea fields are all editable via dashboard/API input so they flow as
    # untrusted into the Bedrock prompt. Delimiter-wrapping them plus the
    # standing system instruction neutralizes prompt-injection payloads.
    keyword_tag = wrap_user_input(keyword, "keyword")
    brand_tag = wrap_user_input(brand_name_raw, "brand")
    industry_tag = wrap_user_input(industry_raw, "industry")

    # Build context from competitor content — each crawled page's title/preview
    # is also untrusted (came from the open web).
    competitor_context = ""
    if competitor_content:
        competitor_context = "\n\nCompetitor content analysis:\n"
        for cc in competitor_content:
            competitor_context += f"\n--- {wrap_user_input(cc.get('domain', ''), 'domain')} ---\n"
            competitor_context += f"Title: {wrap_user_input(cc.get('title', ''), 'title')}\n"
            if cc.get('content_preview'):
                competitor_context += (
                    "Content preview: "
                    f"{wrap_user_input(cc['content_preview'][:1000], 'content', max_length=2000)}...\n"
                )

    # Prepend the standing system instruction so the LLM knows to treat any
    # tagged content as data, not commands.
    system_preamble = untrusted_input_system_instruction() + "\n\n"

    # Build the prompt based on content angle
    if content_angle == 'differentiation':
        prompt = system_preamble + f"""Create a differentiated content piece for the keyword {keyword_tag} that positions {brand_tag} uniquely.

The goal is to improve ranking from current position by offering unique value.
{competitor_context}

Generate:
1. A compelling headline that differentiates from competitors
2. Key talking points (5-7 bullet points)
3. Unique angles competitors aren't covering
4. A brief content outline (300-500 words)
5. SEO recommendations (meta title, meta description, target keywords)

Focus on what makes {brand_tag} unique and valuable."""

    elif content_angle == 'provider_optimization':
        providers = idea.get('providers_missing', [])
        # Provider names come from an enum-validated list at the handler
        # boundary; safe to interpolate. Wrap defensively anyway.
        providers_str = ", ".join(wrap_user_input(p, "provider") for p in providers)
        prompt = system_preamble + f"""Create content optimized for AI search engines ({providers_str}) for the keyword {keyword_tag}.

The goal is to get {brand_tag} mentioned by these AI providers.
{competitor_context}

Generate:
1. A headline optimized for AI citation
2. Key facts and statistics that AI models love to cite
3. Clear, authoritative statements about {brand_tag}
4. Structured content outline with headers
5. FAQ section (5 questions AI assistants commonly answer)

Focus on factual, citable content that AI models will reference."""

    elif content_angle == 'thought_leadership':
        prompt = system_preamble + f"""Create thought leadership content for the keyword {keyword_tag} to maintain {brand_tag}'s #1 position.

You're already leading - this content should reinforce authority and stay ahead of competitors.
{competitor_context}

Generate:
1. A bold, authoritative headline
2. Industry insights and predictions
3. Original data points or perspectives
4. Expert tips that only a leader would know
5. Future trends in this space

Focus on establishing {brand_tag} as THE authority that others follow."""

    elif content_angle == 'reputation_management':
        prompt = system_preamble + f"""Create positive, trust-building content for the keyword {keyword_tag} to improve {brand_tag}'s sentiment.

The goal is to address concerns and highlight strengths.
{competitor_context}

Generate:
1. A reassuring, positive headline
2. Key strengths and differentiators
3. Customer success stories or testimonials angles
4. Trust signals (awards, certifications, guarantees)
5. FAQ addressing common concerns

Focus on building trust and showcasing {brand_tag}'s commitment to excellence."""

    elif content_angle == 'seasonal':
        seasonal_theme_tag = wrap_user_input(
            idea.get('seasonal_theme', 'current season'), "theme"
        )
        prompt = system_preamble + f"""Create seasonal content for {keyword_tag} tied to {seasonal_theme_tag}.

This is time-sensitive content to capture seasonal search traffic.
{competitor_context}

Generate:
1. A seasonal, timely headline
2. Why this is relevant NOW
3. Seasonal tips and recommendations
4. Limited-time offers or experiences to highlight
5. Call-to-action with urgency

Focus on timeliness and capturing the {seasonal_theme_tag} moment for {brand_tag}."""

    elif content_angle == 'trending':
        trending_topic_tag = wrap_user_input(
            idea.get('trending_topic', keyword), "topic"
        )
        prompt = system_preamble + f"""Create trending content about {trending_topic_tag} for the {industry_tag} industry.

This topic is trending NOW - create content that captures the moment.
{competitor_context}

Generate:
1. A headline that captures the trend
2. Why this is trending and relevant
3. How {brand_tag} relates to this trend
4. Quick tips or insights
5. Social media hooks

Focus on being timely, shareable, and positioning {brand_tag} as current and relevant."""

    elif content_angle == 'evergreen':
        prompt = system_preamble + f"""Create comprehensive evergreen content for {keyword_tag} that will rank year-round.

This should be the definitive resource on this topic.
{competitor_context}

Generate:
1. An authoritative, comprehensive headline
2. Complete topic coverage (all aspects)
3. Detailed sections with depth
4. Internal linking opportunities
5. Resource lists and references

Focus on creating THE definitive guide that establishes {brand_tag} as the go-to authority."""

    else:  # comprehensive_guide (default)
        prompt = system_preamble + f"""Create a comprehensive guide for the keyword {keyword_tag} in the {industry_tag} industry that positions {brand_tag} as an authority.

{competitor_context}

Generate:
1. An SEO-optimized headline
2. Executive summary (2-3 sentences)
3. Key sections with headers (5-7 sections)
4. Bullet points for each section
5. Call-to-action recommendations
6. SEO metadata (title, description, keywords)

Make it comprehensive, authoritative, and better than competitor content.

Format your response with clear sections:
TITLE: [Your title here]
META: [150 character meta description]

[Your main content here with ## headings]

HEADINGS: [List the H2 headings you used, comma separated]
POINTS: [3 key takeaways as bullet points]"""

    # Add output language instruction if specified — also wrapped since the
    # value comes from the dashboard and is free-form text.
    output_language_raw = idea.get('output_language', 'English')
    if output_language_raw and output_language_raw != 'English':
        output_language_tag = wrap_user_input(output_language_raw, "language", max_length=100)
        prompt += (
            f"\n\nIMPORTANT: Write ALL content in {output_language_tag}. "
            f"The title, meta description, body, headings, and key points must all be in {output_language_tag}."
        )

    try:
        # Invoke shared Bedrock client with GENERATION role (Haiku default, tier-switchable)
        generated_content = invoke_bedrock(
            prompt,
            ModelRole.GENERATION,
            max_tokens=8000,
            temperature=0.7,
        )

        parsed = parse_generated_content(generated_content)

        return {
            'success': True,
            'content': parsed,
            'raw_content': generated_content,
            'model': get_model_tier(ModelRole.GENERATION).value,
            'content_angle': content_angle,
            'competitor_sources_used': len(competitor_content)
        }

    except BedrockInvocationError as e:
        logger.error(f"Bedrock throttled after retries: {e}")
        return {
            'success': False,
            'error': 'Too many requests. Please wait a moment and try again.',
            'error_type': 'throttling',
            'content_angle': content_angle
        }
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Bedrock generation failed: {error_msg}", exc_info=True)

        # Provide user-friendly error messages based on AWS error codes in the message
        if 'AccessDeniedException' in error_msg:
            user_error = 'Access denied to Bedrock model. Check IAM permissions.'
            error_type = 'access_denied'
        elif 'ModelTimeoutException' in error_msg:
            user_error = 'AI model took too long to respond. Please try again with a simpler keyword.'
            error_type = 'timeout'
        elif 'ModelErrorException' in error_msg:
            user_error = 'AI model encountered an error. Please try again.'
            error_type = 'model_error'
        elif 'ValidationException' in error_msg:
            user_error = 'Invalid request to AI model. Please try a different keyword.'
            error_type = 'generation_error'
        elif 'ServiceUnavailable' in error_msg or 'InternalServerError' in error_msg:
            user_error = 'AI service temporarily unavailable. Please try again later.'
            error_type = 'generation_error'
        elif 'ResourceNotFoundException' in error_msg:
            user_error = 'AI model not found. Please contact support.'
            error_type = 'generation_error'
        else:
            user_error = f'Content generation failed: {error_msg[:200]}'
            error_type = 'generation_error'

        return {
            'success': False,
            'error': user_error,
            'error_type': error_type,
            'content_angle': content_angle
        }


def parse_generated_content(text: str) -> dict[str, Any]:
    """Parse the structured content from LLM response."""
    result = {
        'title': '',
        'meta_description': '',
        'body': '',
        'suggested_headings': [],
        'key_points': []
    }

    lines = text.split('\n')

    # Extract title
    for line in lines:
        if line.strip().upper().startswith('TITLE:'):
            result['title'] = line.split(':', 1)[1].strip()
            break

    # Extract meta description
    for line in lines:
        upper = line.strip().upper()
        if upper.startswith('META:') or upper.startswith('META_DESCRIPTION:'):
            result['meta_description'] = line.split(':', 1)[1].strip()[:160]
            break

    # Find body content - everything between META line and HEADINGS/POINTS
    in_body = False
    body_lines = []
    for line in lines:
        upper_line = line.strip().upper()
        if upper_line.startswith('META'):
            in_body = True
            continue
        if in_body and ('HEADINGS:' in upper_line or 'POINTS:' in upper_line):
            break
        if in_body:
            body_lines.append(line)

    result['body'] = '\n'.join(body_lines).strip()

    # If no structured body found, use the whole text
    if not result['body']:
        result['body'] = text

    # Extract headings
    for line in lines:
        upper_line = line.strip().upper()
        if 'HEADINGS:' in upper_line:
            after = line.split(':', 1)[1].strip() if ':' in line else ''
            if after:
                result['suggested_headings'] = [h.strip() for h in after.split(',') if h.strip()]
            break

    # Extract key points
    in_points = False
    for line in lines:
        upper_line = line.strip().upper()
        if 'POINTS:' in upper_line:
            in_points = True
            continue
        if in_points and line.strip():
            clean = line.strip().lstrip('-*0123456789. ')
            if clean:
                result['key_points'].append(clean)

    return result


def _compute_idempotency_key(idea: dict[str, Any], window_minutes: int = 5) -> str:
    """Compute a deterministic idempotency key for a generation request.

    Same idea payload submitted within the same `window_minutes` bucket
    produces the same key. Different windows produce different keys so a
    user intentionally re-triggering hours later still gets a fresh run.

    Bucketing to 5 minutes strikes a balance:
    - Long enough to absorb API Gateway's default retries (which use short
      exponential backoff, typically <1 minute apart) and accidental
      client double-clicks.
    - Short enough that a user who genuinely wants to regenerate doesn't
      have to wait an inordinate time for a fresh `id`.

    Inputs contributing to the hash:
    - idea_id: uniquely identifies which idea card was clicked
    - keyword: the business keyword (different keywords → different results)
    - content_angle: the variant (comprehensive_guide vs reputation_management
      etc.) — same idea + different angle legitimately needs a fresh id
    - output_language: same rationale (different language → different output)
    - Rounded timestamp bucket

    Returns a 32-char hex string used as the DynamoDB primary key.
    """
    window_seconds = window_minutes * 60
    now_ts = utc_now().timestamp()
    bucket = int(now_ts // window_seconds)

    payload = "|".join([
        str(idea.get("id", "")),
        str(idea.get("keyword", "")),
        str(idea.get("content_angle", "")),
        str(idea.get("output_language", "English")),
        str(bucket),
    ])
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return digest[:32]


def create_pending_content(idea: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Create a pending content record for async generation.

    Idempotent via a deterministic primary key derived from the idea payload
    plus a short time bucket (see `_compute_idempotency_key`). API Gateway
    retries and accidental client double-clicks within the window resolve
    to the same row instead of spawning duplicate generations (audit #23).

    Returns:
        Tuple of ``(item, created)`` where ``created`` is True when this
        call wrote a fresh row and False when an existing row already
        satisfied the idempotency key. Callers use ``created`` to decide
        whether to kick off the async generation — retries must NOT
        re-invoke, otherwise the "fix" still leaves duplicate generations
        running.
    """
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    content_id = _compute_idempotency_key(idea)
    timestamp = get_timestamp()

    item = {
        'id': content_id,
        'idea_id': idea.get('id', ''),
        'keyword': idea.get('keyword', ''),
        'idea_type': idea.get('type', ''),
        'idea_title': idea.get('title', ''),
        'content_angle': idea.get('content_angle', ''),
        'idea_data': idea,  # Store full idea for background processing
        'generated_content': {},
        'raw_content': '',
        'model': '',
        'competitor_sources_used': 0,
        'status': 'pending',
        'viewed': False,
        'created_at': timestamp,
        'updated_at': timestamp
    }

    try:
        # Conditional write — only create if this idempotency key is new.
        table.put_item(
            Item=item,
            ConditionExpression='attribute_not_exists(id)',
        )
        return item, True
    except ClientError as e:
        if e.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
            raise
        # A row already exists for this key. This is the retry/duplicate
        # case — return the existing row so the caller hands the user the
        # same content_id and skips the second async generation.
        logger.info(
            f"Idempotent hit for content_id={content_id}; "
            "returning existing record instead of creating duplicate"
        )
        existing = table.get_item(Key={'id': content_id}).get('Item')
        if existing is None:
            # Extremely unlikely: someone deleted the row between put and get.
            # Safer to re-raise so the client sees the error rather than
            # silently producing a surprise new UUID.
            raise RuntimeError(
                f"Idempotent conflict on content_id={content_id} but item "
                "disappeared on read"
            ) from None
        return existing, False


def update_content_status(content_id: str, status: str, generation_result: dict[str, Any] | None = None) -> dict[str, Any]:
    """Update content status after background generation."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    timestamp = get_timestamp()

    update_expr = 'SET #status = :status, updated_at = :updated_at'
    expr_values = {
        ':status': status,
        ':updated_at': timestamp
    }
    expr_names = {'#status': 'status'}

    if generation_result and status == 'generated':
        update_expr += ', generated_content = :content, raw_content = :raw, model = :model, competitor_sources_used = :sources'
        expr_values[':content'] = generation_result.get('content', {})
        expr_values[':raw'] = generation_result.get('raw_content', '')
        expr_values[':model'] = generation_result.get('model', '')
        expr_values[':sources'] = generation_result.get('competitor_sources_used', 0)
    elif status == 'failed':
        update_expr += ', error_message = :error'
        expr_values[':error'] = generation_result.get('error', 'Unknown error') if generation_result else 'Unknown error'

    try:
        table.update_item(
            Key={'id': content_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values
        )
        return {'success': True}
    except Exception as e:
        logger.error(f"Failed to update content status: {e}")
        return {'success': False, 'error': str(e)}


def mark_content_viewed(content_id: str) -> dict[str, Any]:
    """Mark content as viewed."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        table.update_item(
            Key={'id': content_id},
            UpdateExpression='SET viewed = :viewed',
            ExpressionAttributeValues={':viewed': True}
        )
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def get_content_by_id(content_id: str) -> dict[str, Any]:
    """Get a single content item by ID."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        response = table.get_item(Key={'id': content_id})
        return response.get('Item')
    except Exception as e:
        logger.error(f"Failed to get content: {e}")
        return None


def get_content_history(limit: int = 20) -> list[dict[str, Any]]:
    """Get generated content history."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    response = table.scan(Limit=limit)
    items = response.get('Items', [])

    # Check for stuck items and mark them as failed
    now = utc_now()
    for item in items:
        if item.get('status') in ('pending', 'generating'):
            created_at_str = item.get('created_at', '')
            if created_at_str:
                try:
                    # Parse 'Z' suffix as UTC — result is timezone-aware, matches `now`.
                    created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
                    elapsed_seconds = (now - created_at).total_seconds()
                    if elapsed_seconds > GENERATION_TIMEOUT_SECONDS:
                        # Mark as failed due to timeout
                        update_content_status(
                            item['id'],
                            'failed',
                            {'error': f'Generation timed out after {int(elapsed_seconds)} seconds. Please try again.'}
                        )
                        item['status'] = 'failed'
                        item['error_message'] = f'Generation timed out after {int(elapsed_seconds)} seconds. Please try again.'
                        logger.info(f"Marked content {item['id']} as failed due to timeout ({elapsed_seconds}s)")
                except (ValueError, TypeError) as e:
                    logger.warning(f"Could not parse created_at for item {item.get('id')}: {e}")

    # Sort by created_at descending
    items.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    return items


def get_unviewed_count() -> int:
    """Get count of unviewed generated content."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        response = table.scan(
            FilterExpression='viewed = :viewed AND #status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':viewed': False, ':status': 'generated'},
            Select='COUNT'
        )
        return response.get('Count', 0)
    except Exception as e:
        logger.error(f"Failed to get unviewed count: {e}")
        return 0


def delete_content(content_id: str) -> dict[str, Any]:
    """Delete generated content."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        table.delete_item(Key={'id': content_id})
        return {'success': True, 'message': 'Content deleted successfully'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def _get_ideas(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """GET /content-studio/ideas - Get content ideas."""
    config = get_brand_config()
    ideas = generate_content_ideas(config)
    return success_response({
        'ideas': ideas,
        'total_count': len(ideas),
        'generated_at': get_timestamp()
    }, event)


def _process_generation_async(content_id: str, idea: dict[str, Any]) -> None:
    """Process content generation - called asynchronously."""
    try:
        logger.info(f"Starting async generation for content_id={content_id}")

        # Update status to generating
        update_content_status(content_id, 'generating')

        # Get brand config and generate content
        config = get_brand_config()
        generation_result = generate_content(idea, config)

        if generation_result.get('success'):
            update_content_status(content_id, 'generated', generation_result)
            logger.info(f"Generation completed successfully for content_id={content_id}")
        else:
            error_msg = generation_result.get('error', 'Content generation failed')
            update_content_status(content_id, 'failed', generation_result)
            logger.error(f"Generation failed for content_id={content_id}: {error_msg}")
    except Exception as e:
        logger.error(f"Async generation error for content_id={content_id}: {e}", exc_info=True)
        update_content_status(content_id, 'failed', {'error': str(e)})


@parse_json_body
@validate({
    'idea': {'required': True, 'source': 'body'}
})
def _generate_content(event: dict[str, Any], context: Any, body: dict, idea: dict) -> dict[str, Any]:
    """POST /content-studio/generate - Start async content generation."""
    if not idea.get('keyword'):
        return validation_error('idea must have a keyword', event, 'keyword')

    # Input validation - limit keyword length
    if len(idea.get('keyword', '')) > 500:
        return validation_error('Keyword too long (max 500 characters)', event, 'keyword')

    # Create pending record immediately. If an idempotency-key hit occurs
    # (API Gateway retry or client double-click within the window), `created`
    # is False and we must skip the async invocation — otherwise the
    # generation still runs twice, defeating the idempotency fix.
    pending_content, created = create_pending_content(idea)
    content_id = pending_content['id']

    if not created:
        existing_status = pending_content.get('status', 'pending')
        logger.info(
            f"Returning existing content_id={content_id} "
            f"(status={existing_status}) without re-invoking generation"
        )
        return success_response({
            'success': True,
            'id': content_id,
            'status': existing_status,
            'message': 'Content generation already in progress. Poll /status/{id} for updates.',
            'keyword': idea.get('keyword'),
            'idempotent_hit': True,
        }, event)

    # Get the current function name for async invocation
    function_name = os.environ.get('AWS_LAMBDA_FUNCTION_NAME', '')

    if function_name:
        # Invoke self asynchronously for background processing
        lambda_client = boto3.client('lambda')
        try:
            lambda_client.invoke(
                FunctionName=function_name,
                InvocationType='Event',  # Async invocation
                Payload=json.dumps({
                    'async_generation': True,
                    'content_id': content_id,
                    'idea': idea
                })
            )
            logger.info(f"Triggered async generation for content_id={content_id}")
        except Exception as e:
            logger.error(f"Failed to trigger async generation: {e}")
            # Fall back to sync if async fails
            _process_generation_async(content_id, idea)
    else:
        # Local testing - run synchronously
        _process_generation_async(content_id, idea)

    # Return immediately with pending status
    return success_response({
        'success': True,
        'id': content_id,
        'status': 'pending',
        'message': 'Content generation started. Poll /status/{id} for updates.',
        'keyword': idea.get('keyword')
    }, event)


def _get_content_status(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """GET /content-studio/status/{id} - Get content generation status."""
    path_params = event.get('pathParameters') or {}
    path = event.get('path', '')

    content_id = path_params.get('id')
    if not content_id:
        parts = path.rstrip('/').split('/')
        # Find 'status' and get the next part
        for i, part in enumerate(parts):
            if part == 'status' and i + 1 < len(parts):
                content_id = parts[i + 1]
                break

    if not content_id:
        return validation_error('Content ID is required', event, 'id')

    content = get_content_by_id(content_id)
    if not content:
        return api_response(404, {'error': 'Content not found'}, event)

    # Check for timeout on pending/generating items
    if content.get('status') in ('pending', 'generating'):
        created_at_str = content.get('created_at', '')
        if created_at_str:
            try:
                now = utc_now()
                # Parse 'Z' suffix as UTC — result is timezone-aware, matches `now`.
                created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
                elapsed_seconds = (now - created_at).total_seconds()
                if elapsed_seconds > GENERATION_TIMEOUT_SECONDS:
                    # Mark as failed due to timeout
                    error_msg = f'Generation timed out after {int(elapsed_seconds)} seconds. Please try again.'
                    update_content_status(content_id, 'failed', {'error': error_msg})
                    content['status'] = 'failed'
                    content['error_message'] = error_msg
                    logger.info(f"Marked content {content_id} as failed due to timeout ({elapsed_seconds}s)")
            except (ValueError, TypeError) as e:
                logger.warning(f"Could not parse created_at for content {content_id}: {e}")

    return success_response({
        'id': content_id,
        'status': content.get('status', 'unknown'),
        'keyword': content.get('keyword'),
        'created_at': content.get('created_at'),
        'updated_at': content.get('updated_at'),
        'has_content': bool(content.get('generated_content', {}).get('title')),
        'error_message': content.get('error_message')
    }, event)


@parse_json_body
def _mark_viewed(event: dict[str, Any], context: Any, body: dict) -> dict[str, Any]:
    """POST /content-studio/viewed - Mark content as viewed."""
    content_id = body.get('id')
    if not content_id:
        return validation_error('Content ID is required', event, 'id')

    result = mark_content_viewed(content_id)
    if result.get('success'):
        return success_response({'success': True, 'id': content_id}, event)
    else:
        return api_response(500, result, event)


@validate({
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 20}
})
def _get_history(event: dict[str, Any], context: Any, limit: int) -> dict[str, Any]:
    """GET /content-studio/history - Get generated content history."""
    history = get_content_history(limit)
    unviewed_count = get_unviewed_count()
    return success_response({
        'history': history,
        'total_count': len(history),
        'unviewed_count': unviewed_count
    }, event)


def _delete_content(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """DELETE /content-studio/{id} - Delete generated content."""
    path_params = event.get('pathParameters') or {}
    path = event.get('path', '')

    content_id = path_params.get('id')
    if not content_id:
        # Try to extract from path
        parts = path.rstrip('/').split('/')
        content_id = parts[-1] if parts else None

    if not content_id or content_id in ['content-studio', 'api']:
        return validation_error('Content ID is required', event, 'id')

    result = delete_content(content_id)
    return api_response(200 if result.get('success') else 404, result, event)


@api_handler
@route_handler({
    ('GET', '/ideas'): _get_ideas,
    ('POST', '/generate'): _generate_content,
    ('GET', '/status'): _get_content_status,
    ('POST', '/viewed'): _mark_viewed,
    ('GET', '/history'): _get_history,
    ('DELETE', None): _delete_content,
})
def _api_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Internal API handler - routes are handled by decorators."""
    pass  # Routes handle everything


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for Content Studio API.

    Routes:
    - GET /content-studio/ideas - Get content ideas
    - POST /content-studio/generate - Start async content generation
    - GET /content-studio/status/{id} - Get content generation status
    - POST /content-studio/viewed - Mark content as viewed
    - GET /content-studio/history - Get generated content history
    - DELETE /content-studio/{id} - Delete generated content

    Also handles async invocation for background content generation.
    """
    # Check if this is an async generation invocation (not from API Gateway)
    # This check MUST happen before decorators to avoid route matching issues
    if event.get('async_generation'):
        content_id = event.get('content_id')
        idea = event.get('idea')
        if content_id and idea:
            logger.info(f"Processing async generation for content_id={content_id}")
            _process_generation_async(content_id, idea)
            return {'statusCode': 200, 'body': 'Async generation completed'}
        else:
            logger.error("Invalid async generation event - missing content_id or idea")
            return {'statusCode': 400, 'body': 'Invalid async event'}

    # For API Gateway requests, delegate to the decorated handler
    return _api_handler(event, context)
