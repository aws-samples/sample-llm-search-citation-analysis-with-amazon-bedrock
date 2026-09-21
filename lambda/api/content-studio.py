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
import re
import sys
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

import boto3
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import api_response, success_response, validation_error
from shared.brand_visibility import classify_brand, load_recent_search_results, tracked_brand_names
from shared.constants import MAX_KEYWORD_LENGTH
from shared.content_brief import (
    CONTENT_OUTPUT_CONTRACT,
    GROUP_BRIEF_TYPE,
    ContentBriefFetchError,
    ContentBriefTemplateError,
    build_group_brief_prompt,
    canonicalize_group_brief,
)
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.dynamo_decimal import to_int
from shared.dynamodb_batch import query_latest_per_key
from shared.models import BedrockInvocationError, ModelRole, get_model_tier, invoke_bedrock
from shared.prompt_safety import untrusted_input_system_instruction, wrap_user_input
from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async
from shared.stale_jobs import stale_elapsed_seconds
from shared.utils import extract_domain, get_brand_config, get_timestamp, utc_now

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
CRAWLED_CONTENT_TABLE = os.environ['DYNAMODB_TABLE_CRAWLED_CONTENT']
CONTENT_STUDIO_TABLE = os.environ['DYNAMODB_TABLE_CONTENT_STUDIO']
KEYWORDS_TABLE = os.environ['DYNAMODB_TABLE_KEYWORDS']
KEYWORD_GROUPS_TABLE = os.environ['DYNAMODB_TABLE_KEYWORD_GROUPS']
# Budget after which the reader-side sweep declares a generation dead. MUST
# stay above this function's Lambda timeout (300s): the previous 240s default
# marked a legitimate 241-300s run as `failed` while it was still running, and
# it then flipped back to `generated` on completion (AUDIT-2026-08-19 §2.9).
# The default matters as much as the CDK value — it applies whenever the env
# var is absent. See `shared.stale_jobs`.
GENERATION_TIMEOUT_SECONDS = int(os.environ.get('GENERATION_TIMEOUT_SECONDS', '360'))


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


def _system_idea(idea_type: str, title: str, description: str) -> dict[str, Any]:
    """A single non-actionable placeholder shown while there is nothing to analyse yet."""
    return {
        'id': str(uuid.uuid4()),
        'type': idea_type,
        'priority': 'high',
        'title': title,
        'description': description,
        'keyword': None,
        'source': 'system',
        'competitor_urls': [],
        'actionable': False
    }


def _citation_opportunity_ideas(keyword_data: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Ideas for rows without extracted brands: point at each keyword's citations instead."""
    ideas = []
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


@dataclass
class _KeywordVisibility:
    """How the tracked brands showed up in one keyword's most recent results."""

    fp_found: bool = False
    fp_best_rank: int = 999
    fp_providers: set[str] = field(default_factory=set)
    fp_sentiment: list[str] = field(default_factory=list)
    comp_mentions: list[dict[str, Any]] = field(default_factory=list)
    all_providers: set[str] = field(default_factory=set)
    competitor_citations: list[str] = field(default_factory=list)
    all_citations: list[str] = field(default_factory=list)


def _analyze_keyword_visibility(
    results: list[dict[str, Any]], first_party: list[str], competitors: list[str]
) -> _KeywordVisibility:
    """Aggregate the brand mentions in the most recent batch of ``results`` for one keyword."""
    latest_ts = max(r.get('timestamp', '') for r in results)
    latest = [r for r in results if r.get('timestamp') == latest_ts]

    visibility = _KeywordVisibility()
    for result in latest:
        provider = result.get('provider', '')
        visibility.all_providers.add(provider)
        citations = result.get('citations', [])
        visibility.all_citations.extend(citations)

        for brand in result.get('brands', []):
            rank = to_int(brand.get('rank'), 999)

            # Prefer LLM classification; fall back to exact name match
            # when missing. See audit items 9 and 22 for the substring
            # collision bugs this replaces.
            classification = classify_brand(brand, first_party, competitors)

            if classification == 'first_party':
                visibility.fp_found = True
                visibility.fp_best_rank = min(visibility.fp_best_rank, rank)
                visibility.fp_providers.add(provider)
                visibility.fp_sentiment.append(brand.get('sentiment', 'neutral'))
            elif classification == 'competitor':
                visibility.comp_mentions.append({'name': brand.get('name'), 'rank': rank, 'provider': provider})
                visibility.competitor_citations.extend(citations)

    visibility.competitor_citations = list(set(visibility.competitor_citations))[:10]
    visibility.all_citations = list(set(visibility.all_citations))[:10]
    return visibility


def _keyword_ideas(keyword: str, visibility: _KeywordVisibility) -> list[dict[str, Any]]:
    """Turn one keyword's visibility picture into up to three content ideas."""
    ideas = []

    # Visibility gap: competitors appear but you don't
    if not visibility.fp_found and visibility.comp_mentions:
        ideas.append({
            'id': str(uuid.uuid4()),
            'type': 'visibility_gap',
            'priority': 'high',
            'title': f'Create Content for "{keyword}"',
            'description': f'Your brand doesn\'t appear but {len(visibility.comp_mentions)} competitors do.',
            'keyword': keyword,
            'source': 'visibility_analysis',
            'competitor_brands': [c['name'] for c in visibility.comp_mentions[:5]],
            'competitor_urls': visibility.competitor_citations,
            'providers_missing': list(visibility.all_providers),
            'actionable': True,
            'content_angle': 'comprehensive_guide'
        })
    # Ranking improvement: you appear but not in top 2 (lowered threshold)
    elif visibility.fp_found and visibility.fp_best_rank > 2 and visibility.comp_mentions:
        ideas.append({
            'id': str(uuid.uuid4()),
            'type': 'ranking_improvement',
            'priority': 'medium' if visibility.fp_best_rank > 3 else 'low',
            'title': f'Improve Ranking for "{keyword}"',
            'description': f'Your brand ranks #{visibility.fp_best_rank}. Create better content to reach #1.',
            'keyword': keyword,
            'source': 'ranking_analysis',
            'current_rank': visibility.fp_best_rank,
            'competitor_brands': [c['name'] for c in visibility.comp_mentions[:3]],
            'competitor_urls': visibility.competitor_citations,
            'providers_present': list(visibility.fp_providers),
            'actionable': True,
            'content_angle': 'differentiation'
        })
    # Leadership maintenance: you're #1 or #2 - keep the momentum
    elif visibility.fp_found and visibility.fp_best_rank <= 2:
        ideas.append({
            'id': str(uuid.uuid4()),
            'type': 'leadership_maintenance',
            'priority': 'low',
            'title': f'Maintain Leadership for "{keyword}"',
            'description': f'You\'re #{visibility.fp_best_rank}! Create fresh content to stay ahead of {len(visibility.comp_mentions)} competitors.',
            'keyword': keyword,
            'source': 'leadership_analysis',
            'current_rank': visibility.fp_best_rank,
            'competitor_brands': [c['name'] for c in visibility.comp_mentions[:3]],
            'competitor_urls': visibility.all_citations,
            'providers_present': list(visibility.fp_providers),
            'actionable': True,
            'content_angle': 'thought_leadership'
        })

    # Provider gap: you appear on some providers but not others
    missing_providers = visibility.all_providers - visibility.fp_providers
    if visibility.fp_found and missing_providers:
        ideas.append({
            'id': str(uuid.uuid4()),
            'type': 'provider_gap',
            'priority': 'medium',
            'title': f'Target {", ".join(missing_providers).title()} for "{keyword}"',
            'description': f'Your brand appears on some AI engines but not on {", ".join(missing_providers)}.',
            'keyword': keyword,
            'source': 'provider_analysis',
            'providers_missing': list(missing_providers),
            'providers_present': list(visibility.fp_providers),
            'competitor_urls': visibility.competitor_citations,
            'actionable': True,
            'content_angle': 'provider_optimization'
        })

    # Sentiment improvement: you appear but with negative sentiment
    negative_count = sum(1 for s in visibility.fp_sentiment if s == 'negative')
    if visibility.fp_found and negative_count > 0:
        ideas.append({
            'id': str(uuid.uuid4()),
            'type': 'sentiment_improvement',
            'priority': 'high',
            'title': f'Address Negative Sentiment for "{keyword}"',
            'description': f'Your brand has negative sentiment in {negative_count} provider(s). Create positive content.',
            'keyword': keyword,
            'source': 'sentiment_analysis',
            'current_rank': visibility.fp_best_rank,
            'competitor_urls': visibility.all_citations,
            'providers_present': list(visibility.fp_providers),
            'actionable': True,
            'content_angle': 'reputation_management'
        })

    return ideas


def generate_content_ideas(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Generate content ideas from multiple sources."""
    first_party, competitors = tracked_brand_names(config)

    if not first_party:
        return [_system_idea(
            'configuration',
            'Configure Your Brands First',
            'Add your brand names in Settings to enable content recommendations.',
        )]

    # Limit to 30 keywords for performance
    items = load_recent_search_results(dynamodb, SEARCH_RESULTS_TABLE, max_keywords=30)

    if not items:
        return [_system_idea(
            'data',
            'Run Your First Analysis',
            'No search data found. Run an analysis to generate content ideas.',
        )]

    keyword_data = defaultdict(list)
    has_any_brands = False
    for item in items:
        keyword_data[item.get('keyword', '')].append(item)
        if item.get('brands'):
            has_any_brands = True

    # If no brand data extracted yet, show citation-based opportunities
    if not has_any_brands:
        return _citation_opportunity_ideas(keyword_data)

    # Analyze each keyword for opportunities based on brand data
    ideas = []
    for keyword, results in keyword_data.items():
        if not keyword:
            continue
        visibility = _analyze_keyword_visibility(results, first_party, competitors)
        ideas.extend(_keyword_ideas(keyword, visibility))

    # Add seasonal/trending content ideas based on keywords
    seasonal_keywords = _get_seasonal_suggestions(list(keyword_data.keys()), config)
    ideas.extend(seasonal_keywords)

    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    ideas.sort(key=lambda x: (priority_order.get(x.get('priority', 'low'), 2), x.get('keyword', '')))
    return ideas[:50]  # Increased from 30 to 50


def _competitor_context(competitor_content: list[dict[str, Any]]) -> str:
    """Render the crawled competitor pages as a prompt section, or ``''`` when there are none.

    Each page's title/preview is also untrusted (it came from the open web),
    so every value is delimiter-wrapped like the user-controlled fields.
    """
    if not competitor_content:
        return ""
    context = "\n\nCompetitor content analysis:\n"
    for cc in competitor_content:
        context += f"\n--- {wrap_user_input(cc.get('domain', ''), 'domain')} ---\n"
        context += f"Title: {wrap_user_input(cc.get('title', ''), 'title')}\n"
        if cc.get('content_preview'):
            context += (
                "Content preview: "
                f"{wrap_user_input(cc['content_preview'][:1000], 'content', max_length=2000)}...\n"
            )
    return context


def _output_language_instruction(idea: dict[str, Any]) -> str:
    """Trailing instruction forcing a non-English output language, or ``''`` for English/unset."""
    output_language_raw = idea.get('output_language', 'English')
    if not output_language_raw or output_language_raw == 'English':
        return ""
    # Also wrapped: the value comes from the dashboard and is free-form text.
    output_language_tag = wrap_user_input(output_language_raw, "language", max_length=100)
    return (
        f"\n\nIMPORTANT: Write ALL content in {output_language_tag}. "
        f"The title, meta description, body, headings, and key points must all be in {output_language_tag}."
    )


def _build_generation_prompt(
    idea: dict[str, Any], config: dict[str, Any], competitor_content: list[dict[str, Any]]
) -> str:
    """Assemble the Bedrock prompt: safety preamble, the brief for the content angle, language instruction."""
    keyword = idea.get('keyword', '')
    content_angle = idea.get('content_angle', 'comprehensive_guide')

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
    competitor_context = _competitor_context(competitor_content)

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

Make it comprehensive, authoritative, and better than competitor content."""

    language_instruction = _output_language_instruction(idea)
    return f'{prompt}{language_instruction}\n\n{CONTENT_OUTPUT_CONTRACT}'


# Ordered ``(AWS error codes, user-facing message, error_type)`` rows for
# `_describe_generation_error`; the first row naming a code found in the
# message wins.
_GENERATION_ERROR_MESSAGES: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (('AccessDeniedException',), 'Access denied to Bedrock model. Check IAM permissions.', 'access_denied'),
    (('ModelTimeoutException',), 'AI model took too long to respond. Please try again with a simpler keyword.', 'timeout'),
    (('ModelErrorException',), 'AI model encountered an error. Please try again.', 'model_error'),
    (('ValidationException',), 'Invalid request to AI model. Please try a different keyword.', 'generation_error'),
    (
        ('ServiceUnavailable', 'InternalServerError'),
        'AI service temporarily unavailable. Please try again later.',
        'generation_error',
    ),
    (('ResourceNotFoundException',), 'AI model not found. Please contact support.', 'generation_error'),
)


def _describe_generation_error(error_msg: str) -> tuple[str, str]:
    """Map a Bedrock failure message to a user-friendly ``(error, error_type)`` by the AWS error code it names."""
    for codes, user_error, error_type in _GENERATION_ERROR_MESSAGES:
        if any(code in error_msg for code in codes):
            return user_error, error_type
    return f'Content generation failed: {error_msg[:200]}', 'generation_error'


def _generation_failure(
    error: str,
    error_type: str,
    content_angle: str,
    *,
    raw_content: str | None = None,
) -> dict[str, Any]:
    """Build the failed-generation result persisted on the Content Studio row."""
    result: dict[str, Any] = {
        'success': False,
        'error': error,
        'error_type': error_type,
        'content_angle': content_angle,
    }
    if raw_content is not None:
        result['raw_content'] = raw_content
    return result


def _invoke_content_generation(
    prompt: str, content_angle: str, competitor_sources_used: int
) -> dict[str, Any]:
    """Invoke Bedrock, normalize its output, and preserve the raw response."""
    try:
        generated_content = invoke_bedrock(
            prompt,
            ModelRole.GENERATION,
            max_tokens=8000,
            temperature=0.7,
        )
        content = parse_generated_content(generated_content)
        content_warning = _metadata_warning(content)
        if not _has_usable_body(content['body']):
            logger.warning(
                "Content generation returned an unusable body angle=%s preview=%r",
                content_angle,
                generated_content[:300],
            )
            return _generation_failure(
                'The AI response did not contain a usable content draft. Please try again.',
                'invalid_output',
                content_angle,
                raw_content=generated_content,
            )

    except BedrockInvocationError:
        logger.exception("Bedrock throttled after retries")
        return _generation_failure(
            'Too many requests. Please wait a moment and try again.', 'throttling', content_angle
        )
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Bedrock generation failed: {error_msg}", exc_info=True)
        user_error, error_type = _describe_generation_error(error_msg)
        return _generation_failure(user_error, error_type, content_angle)
    else:
        result: dict[str, Any] = {
            'success': True,
            'content': content,
            'raw_content': generated_content,
            'model': get_model_tier(ModelRole.GENERATION).value,
            'content_angle': content_angle,
            'competitor_sources_used': competitor_sources_used,
        }
        if content_warning is not None:
            result['content_warning'] = content_warning
            logger.warning(
                "Content generation metadata is incomplete angle=%s missing_fields=%s",
                content_angle,
                content_warning['missing_fields'],
            )
        return result


def _group_brief_generation(
    idea: dict[str, Any], config: dict[str, Any], content_angle: str
) -> dict[str, Any]:
    """Build a group brief prompt, failing safely when its source cannot be read."""
    try:
        prompt, source_count = build_group_brief_prompt(idea, config)
    except ContentBriefFetchError as error:
        logger.warning("Group brief source fetch failed: %s", error)
        return _generation_failure(str(error), 'source_fetch', content_angle)
    except ContentBriefTemplateError as error:
        logger.warning("Group brief template rendering failed: %s", error)
        return _generation_failure(str(error), 'template_validation', content_angle)
    return _invoke_content_generation(prompt, content_angle, source_count)


def generate_content(idea: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """Generate content using Bedrock Claude based on idea and competitor analysis."""
    content_angle = idea.get('content_angle', 'comprehensive_guide')
    if idea.get('type') == GROUP_BRIEF_TYPE:
        return _group_brief_generation(idea, config, content_angle)

    # Get competitor content for analysis
    competitor_content = get_crawled_content(idea.get('competitor_urls', []), limit=3)
    prompt = _build_generation_prompt(idea, config, competitor_content)
    return _invoke_content_generation(prompt, content_angle, len(competitor_content))


_MIN_USABLE_BODY_CHARACTERS = 40
_INCOMPLETE_METADATA_MESSAGE = (
    'This draft is usable, but some generated metadata is incomplete.'
)
_LEGACY_MARKER_PATTERN = re.compile(
    r'^\s*(?P<opening>\*{1,2}|_{1,2})?\s*'
    r'(?P<label>TITLE|META(?:_DESCRIPTION)?|HEADINGS|(?:KEY[ _])?POINTS)'
    r'\s*(?:\*{1,2}|_{1,2})?\s*:\s*(?:\*{1,2}|_{1,2})?\s*'
    r'(?P<value>.*?)\s*$',
    re.IGNORECASE,
)


def _normalized_string(payload: dict[str, Any], field_name: str) -> str:
    """Return a trimmed string field, rejecting coercion from other JSON types."""
    value = payload.get(field_name)
    return value.strip() if isinstance(value, str) else ''


def _normalized_string_list(payload: dict[str, Any], field_name: str) -> list[str]:
    """Return trimmed, non-blank string members from a JSON array."""
    value = payload.get(field_name)
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _normalize_json_content(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize the exact Content Studio JSON fields without type coercion."""
    return {
        'title': _normalized_string(payload, 'title'),
        'meta_description': _normalized_string(payload, 'meta_description')[:160],
        'body': _normalized_string(payload, 'body'),
        'suggested_headings': _normalized_string_list(payload, 'suggested_headings'),
        'key_points': _normalized_string_list(payload, 'key_points'),
    }


def _legacy_marker(line: str) -> tuple[str, str] | None:
    """Return a normalized marker and value for plain or emphasized legacy labels."""
    match = _LEGACY_MARKER_PATTERN.match(line)
    if match is None:
        return None
    label = match.group('label').upper().replace('_', ' ').replace('  ', ' ')
    if label == 'META DESCRIPTION':
        label = 'META'
    elif label == 'KEY POINTS':
        label = 'POINTS'
    value = match.group('value').strip().strip('*_').strip()
    return label, value


def _clean_legacy_list_item(value: str) -> str:
    """Remove one Markdown bullet or numeric prefix from a legacy list value."""
    cleaned = re.sub(r'^\s*(?:[-*+]|\d+[.)])\s*', '', value).strip()
    return cleaned.strip('*_').strip()


def _inline_legacy_items(value: str) -> list[str]:
    """Split a comma- or semicolon-separated marker value into clean items."""
    unwrapped = value.strip().removeprefix('[').removesuffix(']')
    return [
        cleaned
        for part in re.split(r'[,;]', unwrapped)
        if (cleaned := _clean_legacy_list_item(part))
    ]


def _legacy_list(
    lines: list[str], markers: dict[int, tuple[str, str]], label: str
) -> list[str]:
    """Read an inline or multiline legacy HEADINGS/POINTS list."""
    marker_entry = next(
        ((index, value) for index, (marker, value) in markers.items() if marker == label),
        None,
    )
    if marker_entry is None:
        return []

    marker_index, inline_value = marker_entry
    items = _inline_legacy_items(inline_value) if inline_value else []
    for index in range(marker_index + 1, len(lines)):
        if index in markers:
            break
        cleaned = _clean_legacy_list_item(lines[index])
        if cleaned:
            items.append(cleaned)
    return items


def _parse_legacy_content(text: str) -> dict[str, Any]:
    """Parse the one supported marker fallback while excluding labels and preamble."""
    lines = text.splitlines()
    markers = {
        index: marker
        for index, line in enumerate(lines)
        if (marker := _legacy_marker(line)) is not None
    }

    def marker_value(label: str) -> str:
        return next((value for marker, value in markers.values() if marker == label), '')

    metadata_indexes = [
        index for index, (label, _value) in markers.items() if label in {'TITLE', 'META'}
    ]
    body_start = max(metadata_indexes) + 1 if metadata_indexes else 0
    list_indexes = [
        index
        for index, (label, _value) in markers.items()
        if label in {'HEADINGS', 'POINTS'} and index >= body_start
    ]
    body_end = min(list_indexes) if list_indexes else len(lines)
    body = '\n'.join(
        line
        for index, line in enumerate(lines[body_start:body_end], start=body_start)
        if index not in markers
    ).strip()

    return {
        'title': marker_value('TITLE'),
        'meta_description': marker_value('META')[:160],
        'body': body,
        'suggested_headings': _legacy_list(lines, markers, 'HEADINGS'),
        'key_points': _legacy_list(lines, markers, 'POINTS'),
    }


def _metadata_warning(content: dict[str, Any]) -> dict[str, Any] | None:
    """Describe omitted contract fields without hiding an otherwise usable draft."""
    metadata_fields = ('title', 'meta_description', 'suggested_headings', 'key_points')
    missing_fields = [field_name for field_name in metadata_fields if not content[field_name]]
    if not missing_fields:
        return None
    return {
        'code': 'incomplete_metadata',
        'message': _INCOMPLETE_METADATA_MESSAGE,
        'missing_fields': missing_fields,
    }


_CONTENT_STUDIO_CONTRACT_KEYS = frozenset({
    'title',
    'meta_description',
    'body',
    'suggested_headings',
    'key_points',
})
_JSON_PREAMBLE_PATTERN = re.compile(
    r"^(?:sure,\s*)?(?:"
    r"here(?: is|'s)\s+(?:(?:the|your)\s+)?(?:requested\s+)?json"
    r"(?:\s+(?:response|output|object))?"
    r"|json(?:\s+(?:response|output))?(?:\s+follows)?"
    r")\s*:?\s*$",
    re.IGNORECASE,
)
_TERMINAL_JSON_FENCE_PATTERN = re.compile(r'\n```[ \t]*\Z')


def _without_json_preamble(text: str) -> tuple[str, bool]:
    """Remove one short, allowlisted LLM JSON-introduction line."""
    first_line, _separator, remainder = text.partition('\n')
    is_preamble = (
        len(first_line) <= 80
        and _JSON_PREAMBLE_PATTERN.fullmatch(first_line.strip()) is not None
    )
    return (remainder.lstrip(), True) if is_preamble else (text, False)


def _json_envelope_candidate(text: str) -> tuple[bool, str]:
    """Return JSON intent and the complete payload only for a whole-response envelope."""
    candidate, had_preamble = _without_json_preamble(text.strip())
    if candidate.startswith(('{', '[')):
        return True, candidate

    opening_fence, _separator, fenced_content = candidate.partition('\n')
    normalized_fence = opening_fence.strip().lower()
    if normalized_fence in {'```', '```json'}:
        fenced_candidate = fenced_content.lstrip()
        declares_json = normalized_fence == '```json'
        starts_as_json = fenced_candidate.startswith(('{', '['))
        if declares_json or had_preamble or starts_as_json:
            closing_fence = _TERMINAL_JSON_FENCE_PATTERN.search(fenced_candidate)
            if closing_fence is None:
                return True, ''
            return True, fenced_candidate[:closing_fence.start()].strip()

    return (True, candidate) if had_preamble else (False, '')


def _is_content_studio_contract_payload(payload: Any) -> bool:
    """Return whether JSON has a body and no fields outside the output contract."""
    return (
        isinstance(payload, dict)
        and 'body' in payload
        and set(payload).issubset(_CONTENT_STUDIO_CONTRACT_KEYS)
    )


def _parse_json_envelope(candidate: str) -> dict[str, Any]:
    """Strictly parse one complete JSON envelope into normalized contract content."""
    try:
        parsed: Any = json.loads(candidate)
    except json.JSONDecodeError:
        return _normalize_json_content({})
    if not _is_content_studio_contract_payload(parsed):
        return _normalize_json_content({})
    return _normalize_json_content(parsed)


def _parse_generated_content(
    text: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Use whole-response contract JSON, preserving all other Markdown as legacy content."""
    is_json_envelope, candidate = _json_envelope_candidate(text)
    content = (
        _parse_json_envelope(candidate)
        if is_json_envelope
        else _parse_legacy_content(text)
    )
    return content, _metadata_warning(content)


def _has_usable_body(body: Any) -> bool:
    """Return whether a normalized body contains enough readable draft content."""
    if not isinstance(body, str):
        return False
    readable_characters = re.sub(r'[\W_]+', '', body, flags=re.UNICODE)
    return len(readable_characters) >= _MIN_USABLE_BODY_CHARACTERS


def parse_generated_content(text: str) -> dict[str, Any]:
    """Return normalized generated content for compatibility with existing callers."""
    content, _warning = _parse_generated_content(text)
    return content


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

    payload_parts = [
        str(idea.get("id", "")),
        str(idea.get("keyword", "")),
        str(idea.get("content_angle", "")),
        str(idea.get("output_language", "English")),
        str(bucket),
    ]
    if idea.get('type') == GROUP_BRIEF_TYPE:
        keyword_ids = idea.get('keyword_ids', [])
        keywords = idea.get('keywords', [])
        group_dimensions = {
            'group_id': str(idea.get('group_id', '')),
            'mode': str(idea.get('content_angle', '')),
            'keyword_ids': sorted(str(value) for value in keyword_ids),
            'keywords': sorted(str(value) for value in keywords),
            'landing_url': str(idea.get('landing_url', '')),
            'current_copy_hash': hashlib.sha256(
                str(idea.get('current_copy', '')).encode('utf-8')
            ).hexdigest(),
            'prompt_template_hash': hashlib.sha256(
                str(idea.get('prompt_template', '')).encode('utf-8')
            ).hexdigest(),
        }
        payload_parts.append(json.dumps(group_dimensions, sort_keys=True, separators=(',', ':')))

    payload = "|".join(payload_parts)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return digest[:32]


def _existing_content_row(table: Any, content_id: str, conflict: ClientError) -> dict[str, Any]:
    """The row whose presence made the conditional write for ``content_id`` fail.

    This is the retry/duplicate case — the caller hands the user the same
    content_id and skips the second async generation.
    """
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
        ) from conflict
    return existing


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
    except ClientError as e:
        if e.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
            raise
        return _existing_content_row(table, content_id, e), False
    return item, True


def update_content_status(content_id: str, status: str, generation_result: dict[str, Any] | None = None) -> dict[str, Any]:
    """Update content status after background generation."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    timestamp = get_timestamp()

    update_expr = 'SET #status = :status, updated_at = :updated_at'
    expr_values: dict[str, Any] = {
        ':status': status,
        ':updated_at': timestamp
    }
    expr_names = {'#status': 'status'}

    if generation_result and status == 'generated':
        update_expr += (
            ', generated_content = :content, raw_content = :raw, model = :model, '
            'competitor_sources_used = :sources'
        )
        expr_values[':content'] = generation_result.get('content', {})
        expr_values[':raw'] = generation_result.get('raw_content', '')
        expr_values[':model'] = generation_result.get('model', '')
        expr_values[':sources'] = generation_result.get('competitor_sources_used', 0)
        content_warning = generation_result.get('content_warning')
        if isinstance(content_warning, dict):
            update_expr += ', content_warning = :content_warning'
            expr_values[':content_warning'] = content_warning
    elif status == 'failed':
        update_expr += ', error_message = :error'
        expr_values[':error'] = (
            generation_result.get('error', 'Unknown error')
            if generation_result
            else 'Unknown error'
        )
        raw_content = generation_result.get('raw_content') if generation_result else None
        if isinstance(raw_content, str):
            update_expr += ', raw_content = :raw'
            expr_values[':raw'] = raw_content

    try:
        table.update_item(
            Key={'id': content_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values
        )
    except Exception as e:
        logger.exception("Failed to update content status")
        return {'success': False, 'error': str(e)}
    return {'success': True}


def mark_content_viewed(content_id: str) -> dict[str, Any]:
    """Mark content as viewed."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        table.update_item(
            Key={'id': content_id},
            UpdateExpression='SET viewed = :viewed',
            ExpressionAttributeValues={':viewed': True}
        )
    except Exception as e:
        logger.exception(f"Failed to mark content {content_id} viewed")
        return {'success': False, 'error': str(e)}
    return {'success': True}


def get_content_by_id(content_id: str) -> dict[str, Any] | None:
    """Get a single content item by ID; ``None`` when it does not exist or cannot be read."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        response = table.get_item(Key={'id': content_id})
        return response.get('Item')
    except Exception:
        logger.exception("Failed to get content")
        return None


def _fail_if_generation_timed_out(row: dict[str, Any]) -> None:
    """Mark a non-terminal row failed once it has outlived the worker's budget.

    A Lambda timeout is a SIGKILL, so `_process_generation_async`'s `except`
    block never runs and the row would sit at `pending`/`generating` forever.
    This reader-side sweep is what makes such a death observable.

    Mutates ``row`` in place so the caller reports the corrected status in the
    same response that triggered the sweep, rather than showing a stale
    "generating" until the next poll.
    """
    if row.get('status') not in ('pending', 'generating'):
        return

    elapsed = stale_elapsed_seconds(row.get('created_at', ''), GENERATION_TIMEOUT_SECONDS)
    if elapsed is None:
        return

    error_msg = f'Generation timed out after {int(elapsed)} seconds. Please try again.'
    update_content_status(row['id'], 'failed', {'error': error_msg})
    row['status'] = 'failed'
    row['error_message'] = error_msg
    logger.info(f"Marked content {row['id']} as failed due to timeout ({int(elapsed)}s)")


def get_content_history(limit: int = 20) -> list[dict[str, Any]]:
    """Get generated content history."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    response = table.scan(Limit=limit)
    items: list[dict[str, Any]] = response.get('Items', [])

    for item in items:
        _fail_if_generation_timed_out(item)

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
    except Exception:
        logger.exception("Failed to get unviewed count")
        return 0


def delete_content(content_id: str) -> dict[str, Any]:
    """Delete generated content."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        table.delete_item(Key={'id': content_id})
    except Exception as e:
        logger.exception(f"Failed to delete content {content_id}")
        return {'success': False, 'error': str(e)}
    return {'success': True, 'message': 'Content deleted successfully'}


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
    if not isinstance(idea, dict):
        return validation_error('idea must be an object', event, 'idea')

    if idea.get('type') == GROUP_BRIEF_TYPE:
        canonical_idea, issue = canonicalize_group_brief(
            idea,
            dynamodb.Table(KEYWORD_GROUPS_TABLE),
            dynamodb.Table(KEYWORDS_TABLE),
        )
        if issue:
            return validation_error(issue.message, event, issue.field)
        if canonical_idea is None:
            return validation_error('idea is invalid', event, 'idea')
        idea = canonical_idea

    if not idea.get('keyword'):
        return validation_error('idea must have a keyword', event, 'keyword')

    # Input validation - limit keyword length
    if len(idea.get('keyword', '')) > MAX_KEYWORD_LENGTH:
        return validation_error(
            f'Keyword too long (max {MAX_KEYWORD_LENGTH} characters)', event, 'keyword'
        )

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

    try:
        invoke_self_async(
            {
                'async_generation': True,
                'content_id': content_id,
                'idea': idea,
            },
            lambda: _process_generation_async(content_id, idea),
            description='generation',
            success_log=f"Triggered async generation for content_id={content_id}",
        )
    except SelfInvokeDispatchError:
        # The background job never started. Running it here instead would
        # outlive API Gateway's 29s timeout, so the client would get a 504
        # with the work invisibly continuing (AUDIT-2026-08-19 §2.9). Mark the
        # row terminal — otherwise the idempotency key means a retry inside
        # the 5-minute window returns this same dead row without re-invoking.
        logger.exception(f"Could not dispatch generation for content_id={content_id}")
        update_content_status(
            content_id,
            'failed',
            {'error': 'Could not start content generation. Please try again.'},
        )
        return api_response(503, {
            'success': False,
            'id': content_id,
            'status': 'failed',
            'error': 'Could not start content generation. Please try again.',
        }, event)

    # Return immediately with pending status
    return success_response({
        'success': True,
        'id': content_id,
        'status': 'pending',
        'message': 'Content generation started. Poll /status/{id} for updates.',
        'keyword': idea.get('keyword')
    }, event)


def _has_generated_content(content: Any) -> bool:
    """Return whether a stored generated-content object has a useful title or body."""
    if not isinstance(content, dict):
        return False
    return any(
        isinstance(content.get(field_name), str) and bool(content[field_name].strip())
        for field_name in ('title', 'body')
    )


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

    _fail_if_generation_timed_out(content)

    return success_response({
        'id': content_id,
        'status': content.get('status', 'unknown'),
        'keyword': content.get('keyword'),
        'created_at': content.get('created_at'),
        'updated_at': content.get('updated_at'),
        'has_content': _has_generated_content(content.get('generated_content')),
        'content_warning': content.get('content_warning'),
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
    """Internal API handler - routes are handled by decorators; this body is never reached."""
    ...


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
