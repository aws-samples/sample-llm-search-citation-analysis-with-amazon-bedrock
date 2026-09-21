"""Content Studio ideas, templates, asynchronous generation, batches, and history."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sys
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, cast

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, "/opt/python")

from shared.api_response import (
    api_response,
    not_found_response,
    success_response,
    validation_error,
)
from shared.auth import get_caller_identity
from shared.brand_visibility import classify_brand, load_recent_search_results, tracked_brand_names
from shared.constants import MAX_KEYWORD_LENGTH
from shared.content_brief import (
    CONTENT_OUTPUT_CONTRACT,
    GROUP_BRIEF_MODES,
    GROUP_BRIEF_TYPE,
    MAX_BATCH_KEYWORDS,
    MAX_CONTENT_BRIEF_TEMPLATES,
    MAX_PROMPT_TEMPLATE_LENGTH,
    MAX_TEMPLATE_DESCRIPTION_LENGTH,
    MAX_TEMPLATE_NAME_LENGTH,
    ContentBriefFetchError,
    ContentBriefTemplateError,
    ContentBriefValidationIssue,
    build_group_brief_prompt,
    builtin_content_brief_template,
    builtin_content_brief_templates,
    canonicalize_group_brief,
    single_keyword_brief,
    validate_template_placeholders,
)
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.dynamo_decimal import to_int
from shared.dynamodb_batch import (
    BatchGetUnprocessedError,
    batch_get_items,
    query_latest_per_key,
)
from shared.keyword_groups import MAX_GROUP_ID_LENGTH
from shared.models import BedrockInvocationError, ModelRole, get_model_tier, invoke_bedrock
from shared.prompt_safety import untrusted_input_system_instruction, wrap_user_input
from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async
from shared.stale_jobs import stale_elapsed_seconds
from shared.utils import extract_domain, get_brand_config, get_timestamp, utc_now

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")

SEARCH_RESULTS_TABLE = os.environ["DYNAMODB_TABLE_SEARCH_RESULTS"]
CRAWLED_CONTENT_TABLE = os.environ["DYNAMODB_TABLE_CRAWLED_CONTENT"]
CONTENT_STUDIO_TABLE = os.environ["DYNAMODB_TABLE_CONTENT_STUDIO"]
CONTENT_BRIEF_BATCHES_TABLE = os.environ["DYNAMODB_TABLE_CONTENT_BRIEF_BATCHES"]
CONTENT_BRIEF_TEMPLATES_TABLE = os.environ["DYNAMODB_TABLE_CONTENT_BRIEF_TEMPLATES"]
KEYWORDS_TABLE = os.environ["DYNAMODB_TABLE_KEYWORDS"]
KEYWORD_GROUPS_TABLE = os.environ["DYNAMODB_TABLE_KEYWORD_GROUPS"]
CONTENT_STUDIO_WORKER_FUNCTION_NAME = os.environ["CONTENT_STUDIO_WORKER_FUNCTION_NAME"]
GENERATION_TIMEOUT_SECONDS = int(os.environ.get("GENERATION_TIMEOUT_SECONDS", "360"))

HISTORY_INDEX = "StatusCreatedIndex"
CONTENT_STATUSES = ("pending", "generating", "generated", "failed")
_STREAM_TRANSPORT = "dynamodb_stream_v1"
_GENERATION_LEASE_SECONDS = 360
_MAX_GENERATION_ATTEMPTS = 3
_RECONCILE_BATCH_SIZE = 10
_RECONCILE_STATUSES = ("pending", "generating")
_RECONCILE_STATUS_BATCH_SIZE = _RECONCILE_BATCH_SIZE // len(_RECONCILE_STATUSES)
_RECONCILE_MAX_QUERY_PAGES = 10
_RECONCILIATION_CURSOR_ID = "__content_studio_reconciliation_v1__"
_MAX_BATCH_CANONICAL_BRIEF_BYTES = 64 * 1024
_MAX_WORKER_EVENT_BYTES = 240_000
_MAX_CONTENT_ID_LENGTH = 128
_MAX_ATTEMPTS_ERROR = "Content generation failed after 3 attempts."
_BATCH_STORAGE_ERROR = "Service temporarily unavailable"
_MISSING_CONTENT_ERROR = "Content record is unavailable."
_STREAM_DESERIALIZER = TypeDeserializer()


class ContentBriefTemplateNotFoundError(LookupError):
    """A requested built-in or saved Content Studio template does not exist."""


class _BatchManifestStorageError(RuntimeError):
    """A batch manifest could not be read or written safely."""


class _BatchManifestConflictError(RuntimeError):
    """A batch id already belongs to a different immutable request."""


class _WorkerDispatchError(RuntimeError):
    """A bounded asynchronous worker event could not be accepted."""


@dataclass(frozen=True)
class _QueueResult:
    """One canonical idea's durable queue outcome."""

    item: dict[str, Any]
    outcome: str


@dataclass(frozen=True)
class _GenerationClaim:
    """One successfully acquired paid-model attempt."""

    attempt: int
    lease_expires_at: int


def _get_seasonal_suggestions(keywords: list[str], config: dict[str, Any]) -> list[dict[str, Any]]:
    """Generate seasonal and trending content suggestions based on current date and keywords."""
    ideas = []
    now = utc_now()
    month = now.month
    industry = config.get("industry", "general")

    seasonal_themes = {
        1: ["new year", "winter", "january deals", "fresh start"],
        2: ["valentine", "romantic", "couples", "winter getaway"],
        3: ["spring break", "march", "spring travel", "easter"],
        4: ["spring", "easter", "april", "outdoor"],
        5: ["memorial day", "spring", "may", "mother's day"],
        6: ["summer", "june", "father's day", "graduation"],
        7: ["summer vacation", "july", "independence day", "beach"],
        8: ["back to school", "august", "summer", "late summer"],
        9: ["fall", "september", "labor day", "autumn"],
        10: ["fall", "october", "halloween", "autumn travel"],
        11: ["thanksgiving", "november", "black friday", "holiday prep"],
        12: ["holiday", "christmas", "december", "new year", "winter"],
    }
    industry_seasonal = {
        "hotels": {
            1: "Winter Escape Packages",
            2: "Romantic Getaway Guide",
            3: "Spring Break Destinations",
            6: "Summer Family Vacation Guide",
            11: "Holiday Travel Planning",
            12: "New Year's Eve Celebrations",
        },
        "restaurants": {
            2: "Valentine's Day Dining Guide",
            5: "Mother's Day Brunch Spots",
            6: "Father's Day Dinner Ideas",
            11: "Thanksgiving Dining Options",
            12: "Holiday Party Venues",
        },
        "retail": {
            8: "Back to School Shopping Guide",
            11: "Black Friday Deals Preview",
            12: "Holiday Gift Guide",
        },
        "travel": {
            3: "Spring Break Planning",
            6: "Summer Vacation Ideas",
            12: "Holiday Travel Tips",
        },
    }

    current_themes = seasonal_themes.get(month, [])
    industry_content = industry_seasonal.get(industry, {}).get(month)
    for keyword in keywords[:10]:
        keyword_lower = keyword.lower()
        for theme in current_themes:
            if theme in keyword_lower or any(word in keyword_lower for word in theme.split()):
                ideas.append(
                    {
                        "id": str(uuid.uuid4()),
                        "type": "seasonal_content",
                        "priority": "medium",
                        "title": f'Seasonal Content: "{keyword}"',
                        "description": f"This keyword is relevant for {theme} season. Create timely content to capture seasonal traffic.",
                        "keyword": keyword,
                        "source": "seasonal_analysis",
                        "seasonal_theme": theme,
                        "competitor_urls": [],
                        "actionable": True,
                        "content_angle": "seasonal",
                    }
                )
                break

    if industry_content and keywords:
        ideas.append(
            {
                "id": str(uuid.uuid4()),
                "type": "trending_topic",
                "priority": "medium",
                "title": f"Trending: {industry_content}",
                "description": f"Create content for this trending topic in {industry}. High search volume expected this month.",
                "keyword": keywords[0] if keywords else industry_content.lower().replace(" ", "-"),
                "source": "trend_analysis",
                "trending_topic": industry_content,
                "competitor_urls": [],
                "actionable": True,
                "content_angle": "trending",
            }
        )

    if keywords:
        ideas.append(
            {
                "id": str(uuid.uuid4()),
                "type": "evergreen_content",
                "priority": "low",
                "title": f"Evergreen Guide: Ultimate {keywords[0].title()} Resource",
                "description": "Create comprehensive evergreen content that ranks year-round and establishes authority.",
                "keyword": keywords[0],
                "source": "evergreen_analysis",
                "competitor_urls": [],
                "actionable": True,
                "content_angle": "evergreen",
            }
        )

    return ideas


def get_crawled_content(urls: list[str], limit: int = 5) -> list[dict[str, Any]]:
    """Get the latest crawled content for competitor analysis."""
    table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
    urls_slice = urls[:limit]
    latest = query_latest_per_key(
        table=table,
        partition_key_name="normalized_url",
        partition_values=urls_slice,
    )

    content_list: list[dict[str, Any]] = []
    for url in urls_slice:
        item = latest.get(url)
        if not item:
            continue
        content_list.append(
            {
                "url": url,
                "title": item.get("title", ""),
                "content_preview": item.get("content", "")[:2000] if item.get("content") else "",
                "seo_analysis": item.get("seo_analysis", {}),
                "domain": extract_domain(url),
            }
        )
    return content_list


def _system_idea(idea_type: str, title: str, description: str) -> dict[str, Any]:
    """A non-actionable placeholder shown while there is nothing to analyse."""
    return {
        "id": str(uuid.uuid4()),
        "type": idea_type,
        "priority": "high",
        "title": title,
        "description": description,
        "keyword": None,
        "source": "system",
        "competitor_urls": [],
        "actionable": False,
    }


def _citation_opportunity_ideas(keyword_data: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Create citation-analysis ideas when brand extraction has not run."""
    ideas = []
    for keyword, results in keyword_data.items():
        if not keyword:
            continue
        all_citations = []
        for result in results:
            all_citations.extend(result.get("citations", []))
        if all_citations:
            ideas.append(
                {
                    "id": str(uuid.uuid4()),
                    "type": "citation_opportunity",
                    "priority": "medium",
                    "title": f'Analyze Citations for "{keyword}"',
                    "description": f"Found {len(set(all_citations))} unique citations. Brand extraction not yet run for this data.",
                    "keyword": keyword,
                    "source": "citation_analysis",
                    "competitor_urls": list(set(all_citations))[:10],
                    "actionable": True,
                    "content_angle": "comprehensive_guide",
                }
            )
    return ideas[:30]


@dataclass
class _KeywordVisibility:
    """How tracked brands appeared in one keyword's latest results."""

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
    """Aggregate brand mentions in the latest result batch for one keyword."""
    latest_ts = max(result.get("timestamp", "") for result in results)
    latest = [result for result in results if result.get("timestamp") == latest_ts]

    visibility = _KeywordVisibility()
    for result in latest:
        provider = result.get("provider", "")
        visibility.all_providers.add(provider)
        citations = result.get("citations", [])
        visibility.all_citations.extend(citations)
        for brand in result.get("brands", []):
            rank = to_int(brand.get("rank"), 999)
            classification = classify_brand(brand, first_party, competitors)
            if classification == "first_party":
                visibility.fp_found = True
                visibility.fp_best_rank = min(visibility.fp_best_rank, rank)
                visibility.fp_providers.add(provider)
                visibility.fp_sentiment.append(brand.get("sentiment", "neutral"))
            elif classification == "competitor":
                visibility.comp_mentions.append(
                    {
                        "name": brand.get("name"),
                        "rank": rank,
                        "provider": provider,
                    }
                )
                visibility.competitor_citations.extend(citations)

    visibility.competitor_citations = list(set(visibility.competitor_citations))[:10]
    visibility.all_citations = list(set(visibility.all_citations))[:10]
    return visibility


def _primary_keyword_idea(keyword: str, visibility: _KeywordVisibility) -> dict[str, Any] | None:
    if not visibility.fp_found and visibility.comp_mentions:
        return {
            "id": str(uuid.uuid4()),
            "type": "visibility_gap",
            "priority": "high",
            "title": f'Create Content for "{keyword}"',
            "description": f"Your brand doesn't appear but {len(visibility.comp_mentions)} competitors do.",
            "keyword": keyword,
            "source": "visibility_analysis",
            "competitor_brands": [item["name"] for item in visibility.comp_mentions[:5]],
            "competitor_urls": visibility.competitor_citations,
            "providers_missing": list(visibility.all_providers),
            "actionable": True,
            "content_angle": "comprehensive_guide",
        }
    if visibility.fp_found and visibility.fp_best_rank > 2 and visibility.comp_mentions:
        return {
            "id": str(uuid.uuid4()),
            "type": "ranking_improvement",
            "priority": "medium" if visibility.fp_best_rank > 3 else "low",
            "title": f'Improve Ranking for "{keyword}"',
            "description": f"Your brand ranks #{visibility.fp_best_rank}. Create better content to reach #1.",
            "keyword": keyword,
            "source": "ranking_analysis",
            "current_rank": visibility.fp_best_rank,
            "competitor_brands": [item["name"] for item in visibility.comp_mentions[:3]],
            "competitor_urls": visibility.competitor_citations,
            "providers_present": list(visibility.fp_providers),
            "actionable": True,
            "content_angle": "differentiation",
        }
    if visibility.fp_found and visibility.fp_best_rank <= 2:
        return {
            "id": str(uuid.uuid4()),
            "type": "leadership_maintenance",
            "priority": "low",
            "title": f'Maintain Leadership for "{keyword}"',
            "description": f"You're #{visibility.fp_best_rank}! Create fresh content to stay ahead of {len(visibility.comp_mentions)} competitors.",
            "keyword": keyword,
            "source": "leadership_analysis",
            "current_rank": visibility.fp_best_rank,
            "competitor_brands": [item["name"] for item in visibility.comp_mentions[:3]],
            "competitor_urls": visibility.all_citations,
            "providers_present": list(visibility.fp_providers),
            "actionable": True,
            "content_angle": "thought_leadership",
        }
    return None


def _provider_gap_idea(keyword: str, visibility: _KeywordVisibility) -> dict[str, Any] | None:
    missing_providers = visibility.all_providers - visibility.fp_providers
    if not visibility.fp_found or not missing_providers:
        return None
    return {
        "id": str(uuid.uuid4()),
        "type": "provider_gap",
        "priority": "medium",
        "title": f'Target {", ".join(missing_providers).title()} for "{keyword}"',
        "description": f"Your brand appears on some AI engines but not on {', '.join(missing_providers)}.",
        "keyword": keyword,
        "source": "provider_analysis",
        "providers_missing": list(missing_providers),
        "providers_present": list(visibility.fp_providers),
        "competitor_urls": visibility.competitor_citations,
        "actionable": True,
        "content_angle": "provider_optimization",
    }


def _sentiment_idea(keyword: str, visibility: _KeywordVisibility) -> dict[str, Any] | None:
    negative_count = sum(1 for sentiment in visibility.fp_sentiment if sentiment == "negative")
    if not visibility.fp_found or negative_count == 0:
        return None
    return {
        "id": str(uuid.uuid4()),
        "type": "sentiment_improvement",
        "priority": "high",
        "title": f'Address Negative Sentiment for "{keyword}"',
        "description": f"Your brand has negative sentiment in {negative_count} provider(s). Create positive content.",
        "keyword": keyword,
        "source": "sentiment_analysis",
        "current_rank": visibility.fp_best_rank,
        "competitor_urls": visibility.all_citations,
        "providers_present": list(visibility.fp_providers),
        "actionable": True,
        "content_angle": "reputation_management",
    }


def _keyword_ideas(keyword: str, visibility: _KeywordVisibility) -> list[dict[str, Any]]:
    """Turn one keyword's visibility picture into up to three content ideas."""
    return [
        idea
        for idea in (
            _primary_keyword_idea(keyword, visibility),
            _provider_gap_idea(keyword, visibility),
            _sentiment_idea(keyword, visibility),
        )
        if idea is not None
    ]


def generate_content_ideas(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Generate content ideas from recent visibility and citation data."""
    first_party, competitors = tracked_brand_names(config)
    if not first_party:
        return [
            _system_idea(
                "configuration",
                "Configure Your Brands First",
                "Add your brand names in Settings to enable content recommendations.",
            )
        ]

    items = load_recent_search_results(dynamodb, SEARCH_RESULTS_TABLE, max_keywords=30)
    if not items:
        return [
            _system_idea(
                "data",
                "Run Your First Analysis",
                "No search data found. Run an analysis to generate content ideas.",
            )
        ]

    keyword_data: dict[str, list[dict[str, Any]]] = defaultdict(list)
    has_any_brands = False
    for item in items:
        keyword_data[item.get("keyword", "")].append(item)
        if item.get("brands"):
            has_any_brands = True
    if not has_any_brands:
        return _citation_opportunity_ideas(keyword_data)

    ideas = []
    for keyword, results in keyword_data.items():
        if keyword:
            visibility = _analyze_keyword_visibility(results, first_party, competitors)
            ideas.extend(_keyword_ideas(keyword, visibility))
    ideas.extend(_get_seasonal_suggestions(list(keyword_data), config))
    priority_order = {"high": 0, "medium": 1, "low": 2}
    ideas.sort(
        key=lambda idea: (
            priority_order.get(idea.get("priority", "low"), 2),
            idea.get("keyword", ""),
        )
    )
    return ideas[:50]


def _competitor_context(competitor_content: list[dict[str, Any]]) -> str:
    """Render crawled competitor pages as safety-wrapped prompt context."""
    if not competitor_content:
        return ""
    context = "\n\nCompetitor content analysis:\n"
    for content in competitor_content:
        context += f"\n--- {wrap_user_input(content.get('domain', ''), 'domain')} ---\n"
        context += f"Title: {wrap_user_input(content.get('title', ''), 'title')}\n"
        if content.get("content_preview"):
            context += (
                "Content preview: "
                f"{wrap_user_input(content['content_preview'][:1000], 'content', max_length=2000)}...\n"
            )
    return context


def _output_language_instruction(idea: dict[str, Any]) -> str:
    """Return the trailing non-English output instruction when needed."""
    output_language_raw = idea.get("output_language", "English")
    if not output_language_raw or output_language_raw == "English":
        return ""
    output_language_tag = wrap_user_input(output_language_raw, "language", max_length=100)
    return (
        f"\n\nIMPORTANT: Write ALL content in {output_language_tag}. "
        f"The title, meta description, body, headings, and key points must all be in {output_language_tag}."
    )


def _build_generation_prompt(
    idea: dict[str, Any], config: dict[str, Any], competitor_content: list[dict[str, Any]]
) -> str:
    """Assemble the safety-wrapped legacy idea prompt."""
    keyword = idea.get("keyword", "")
    content_angle = idea.get("content_angle", "comprehensive_guide")
    tracked_brands = config.get("tracked_brands", {})
    first_party = tracked_brands.get("first_party", [])
    brand_name_raw = first_party[0] if first_party else "your brand"
    industry_raw = config.get("industry", "general")
    keyword_tag = wrap_user_input(keyword, "keyword")
    brand_tag = wrap_user_input(brand_name_raw, "brand")
    industry_tag = wrap_user_input(industry_raw, "industry")
    competitor_context = _competitor_context(competitor_content)
    system_preamble = untrusted_input_system_instruction() + "\n\n"

    if content_angle == "differentiation":
        prompt = (
            system_preamble
            + f"""Create a differentiated content piece for the keyword {keyword_tag} that positions {brand_tag} uniquely.

The goal is to improve ranking from current position by offering unique value.
{competitor_context}

Generate:
1. A compelling headline that differentiates from competitors
2. Key talking points (5-7 bullet points)
3. Unique angles competitors aren't covering
4. A brief content outline (300-500 words)
5. SEO recommendations (meta title, meta description, target keywords)

Focus on what makes {brand_tag} unique and valuable."""
        )
    elif content_angle == "provider_optimization":
        providers = idea.get("providers_missing", [])
        providers_str = ", ".join(wrap_user_input(provider, "provider") for provider in providers)
        prompt = (
            system_preamble
            + f"""Create content optimized for AI search engines ({providers_str}) for the keyword {keyword_tag}.

The goal is to get {brand_tag} mentioned by these AI providers.
{competitor_context}

Generate:
1. A headline optimized for AI citation
2. Key facts and statistics that AI models love to cite
3. Clear, authoritative statements about {brand_tag}
4. Structured content outline with headers
5. FAQ section (5 questions AI assistants commonly answer)

Focus on factual, citable content that AI models will reference."""
        )
    elif content_angle == "thought_leadership":
        prompt = (
            system_preamble
            + f"""Create thought leadership content for the keyword {keyword_tag} to maintain {brand_tag}'s #1 position.

You're already leading - this content should reinforce authority and stay ahead of competitors.
{competitor_context}

Generate:
1. A bold, authoritative headline
2. Industry insights and predictions
3. Original data points or perspectives
4. Expert tips that only a leader would know
5. Future trends in this space

Focus on establishing {brand_tag} as THE authority that others follow."""
        )
    elif content_angle == "reputation_management":
        prompt = (
            system_preamble
            + f"""Create positive, trust-building content for the keyword {keyword_tag} to improve {brand_tag}'s sentiment.

The goal is to address concerns and highlight strengths.
{competitor_context}

Generate:
1. A reassuring, positive headline
2. Key strengths and differentiators
3. Customer success stories or testimonials angles
4. Trust signals (awards, certifications, guarantees)
5. FAQ addressing common concerns

Focus on building trust and showcasing {brand_tag}'s commitment to excellence."""
        )
    elif content_angle == "seasonal":
        seasonal_theme_tag = wrap_user_input(idea.get("seasonal_theme", "current season"), "theme")
        prompt = (
            system_preamble
            + f"""Create seasonal content for {keyword_tag} tied to {seasonal_theme_tag}.

This is time-sensitive content to capture seasonal search traffic.
{competitor_context}

Generate:
1. A seasonal, timely headline
2. Why this is relevant NOW
3. Seasonal tips and recommendations
4. Limited-time offers or experiences to highlight
5. Call-to-action with urgency

Focus on timeliness and capturing the {seasonal_theme_tag} moment for {brand_tag}."""
        )
    elif content_angle == "trending":
        trending_topic_tag = wrap_user_input(idea.get("trending_topic", keyword), "topic")
        prompt = (
            system_preamble
            + f"""Create trending content about {trending_topic_tag} for the {industry_tag} industry.

This topic is trending NOW - create content that captures the moment.
{competitor_context}

Generate:
1. A headline that captures the trend
2. Why this is trending and relevant
3. How {brand_tag} relates to this trend
4. Quick tips or insights
5. Social media hooks

Focus on being timely, shareable, and positioning {brand_tag} as current and relevant."""
        )
    elif content_angle == "evergreen":
        prompt = (
            system_preamble
            + f"""Create comprehensive evergreen content for {keyword_tag} that will rank year-round.

This should be the definitive resource on this topic.
{competitor_context}

Generate:
1. An authoritative, comprehensive headline
2. Complete topic coverage (all aspects)
3. Detailed sections with depth
4. Internal linking opportunities
5. Resource lists and references

Focus on creating THE definitive guide that establishes {brand_tag} as the go-to authority."""
        )
    else:
        prompt = (
            system_preamble
            + f"""Create a comprehensive guide for the keyword {keyword_tag} in the {industry_tag} industry that positions {brand_tag} as an authority.

{competitor_context}

Generate:
1. An SEO-optimized headline
2. Executive summary (2-3 sentences)
3. Key sections with headers (5-7 sections)
4. Bullet points for each section
5. Call-to-action recommendations
6. SEO metadata (title, description, keywords)

Make it comprehensive, authoritative, and better than competitor content."""
        )

    language_instruction = _output_language_instruction(idea)
    return f'{prompt}{language_instruction}\n\n{CONTENT_OUTPUT_CONTRACT}'


_GENERATION_ERROR_MESSAGES: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (("AccessDeniedException",), "Access denied to Bedrock model. Check IAM permissions.", "access_denied"),
    (
        ("ModelTimeoutException",),
        "AI model took too long to respond. Please try again with a simpler keyword.",
        "timeout",
    ),
    (("ModelErrorException",), "AI model encountered an error. Please try again.", "model_error"),
    (("ValidationException",), "Invalid request to AI model. Please try a different keyword.", "generation_error"),
    (
        ("ServiceUnavailable", "InternalServerError"),
        "AI service temporarily unavailable. Please try again later.",
        "generation_error",
    ),
    (("ResourceNotFoundException",), "AI model not found. Please contact support.", "generation_error"),
)


def _describe_generation_error(error_msg: str) -> tuple[str, str]:
    """Map a Bedrock failure to a safe user message and error type."""
    for codes, user_error, error_type in _GENERATION_ERROR_MESSAGES:
        if any(code in error_msg for code in codes):
            return user_error, error_type
    return f"Content generation failed: {error_msg[:200]}", "generation_error"


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
            "Too many requests. Please wait a moment and try again.",
            "throttling",
            content_angle,
        )
    except Exception as error:
        logger.exception("Bedrock generation failed")
        user_error, error_type = _describe_generation_error(str(error))
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


def _group_brief_generation(idea: dict[str, Any], config: dict[str, Any], content_angle: str) -> dict[str, Any]:
    """Build a content brief prompt, failing safely when source retrieval fails."""
    try:
        prompt, source_count = build_group_brief_prompt(idea, config)
    except ContentBriefFetchError as error:
        logger.warning("Content brief source fetch failed: %s", error)
        return _generation_failure(str(error), "source_fetch", content_angle)
    except ContentBriefTemplateError as error:
        logger.warning("Content brief template rendering failed: %s", error)
        return _generation_failure(str(error), "template_validation", content_angle)
    return _invoke_content_generation(prompt, content_angle, source_count)


def generate_content(idea: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """Generate content with the brief or legacy idea pipeline."""
    content_angle = idea.get("content_angle", "comprehensive_guide")
    if idea.get("type") == GROUP_BRIEF_TYPE:
        return _group_brief_generation(idea, config, content_angle)
    competitor_content = get_crawled_content(idea.get("competitor_urls", []), limit=3)
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


def _compute_idempotency_key(
    idea: dict[str, Any],
    window_minutes: int = 5,
    *,
    include_time_bucket: bool = True,
) -> str:
    """Return a deterministic content id, with a time bucket only for single runs."""
    payload_parts = [
        str(idea.get("id", "")),
        str(idea.get("keyword", "")),
        str(idea.get("content_angle", "")),
        str(idea.get("output_language", "English")),
    ]
    if include_time_bucket:
        window_seconds = window_minutes * 60
        payload_parts.append(str(int(utc_now().timestamp() // window_seconds)))
    if idea.get("type") == GROUP_BRIEF_TYPE:
        brief_dimensions = {
            "scope": idea.get("scope", {}),
            "group_id": str(idea.get("group_id", "")),
            "mode": str(idea.get("content_angle", "")),
            "keyword_ids": sorted(str(value) for value in idea.get("keyword_ids", [])),
            "keywords": sorted(str(value) for value in idea.get("keywords", [])),
            "landing_url": str(idea.get("landing_url", "")),
            "current_copy_hash": hashlib.sha256(str(idea.get("current_copy", "")).encode("utf-8")).hexdigest(),
            "prompt_template_hash": hashlib.sha256(str(idea.get("prompt_template", "")).encode("utf-8")).hexdigest(),
            "template_id": str(idea.get("template_id", "")),
        }
        payload_parts.append(json.dumps(brief_dimensions, sort_keys=True, separators=(",", ":")))
    payload = "|".join(payload_parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _existing_content_row(table: Any, content_id: str, conflict: ClientError) -> dict[str, Any]:
    logger.info("Idempotent hit for content_id=%s; returning existing record", content_id)
    existing = table.get_item(
        Key={"id": content_id},
        ConsistentRead=True,
    ).get("Item")
    if existing is None:
        raise RuntimeError(f"Idempotent conflict on content_id={content_id} but item disappeared on read") from conflict
    return existing


def create_pending_content(
    idea: dict[str, Any],
    *,
    include_time_bucket: bool = True,
    metadata: dict[str, Any] | None = None,
    content_id: str | None = None,
) -> tuple[dict[str, Any], bool]:
    """Conditionally create one pending row and report whether it was new."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    resolved_content_id = content_id or _compute_idempotency_key(idea, include_time_bucket=include_time_bucket)
    timestamp = get_timestamp()
    item: dict[str, Any] = {
        "id": resolved_content_id,
        "idea_id": idea.get("id", ""),
        "keyword": idea.get("keyword", ""),
        "idea_type": idea.get("type", ""),
        "idea_title": idea.get("title", ""),
        "content_angle": idea.get("content_angle", ""),
        "idea_data": idea,
        "generated_content": {},
        "raw_content": "",
        "model": "",
        "competitor_sources_used": 0,
        "status": "pending",
        "generation_transport": _STREAM_TRANSPORT,
        "generation_attempts": 0,
        "viewed": False,
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    if metadata:
        item.update(metadata)

    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(id)")
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        return _existing_content_row(table, resolved_content_id, error), False
    return item, True


def _generated_content_values(generation_result: dict[str, Any]) -> dict[str, Any]:
    return {
        ":content": generation_result.get("content", {}),
        ":raw": generation_result.get("raw_content", ""),
        ":model": generation_result.get("model", ""),
        ":sources": generation_result.get("competitor_sources_used", 0),
    }


def update_content_status(
    content_id: str,
    status: str,
    generation_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Update content status after background generation."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    update_expr = "SET #status = :status, updated_at = :updated_at"
    expr_values: dict[str, Any] = {
        ":status": status,
        ":updated_at": get_timestamp(),
    }
    expr_names = {"#status": "status"}
    if generation_result and status == "generated":
        update_expr += (
            ", generated_content = :content, raw_content = :raw, model = :model, competitor_sources_used = :sources"
        )
        expr_values.update(_generated_content_values(generation_result))
        content_warning = generation_result.get("content_warning")
        if isinstance(content_warning, dict):
            update_expr += ", content_warning = :content_warning"
            expr_values[":content_warning"] = content_warning
    elif status == "failed":
        update_expr += ", error_message = :error"
        expr_values[":error"] = (
            generation_result.get("error", "Unknown error") if generation_result else "Unknown error"
        )
        raw_content = generation_result.get("raw_content") if generation_result else None
        if isinstance(raw_content, str):
            update_expr += ", raw_content = :raw"
            expr_values[":raw"] = raw_content
    try:
        table.update_item(
            Key={"id": content_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )
    except Exception as error:
        logger.exception("Failed to update content status")
        return {"success": False, "error": str(error)}
    return {"success": True}


def mark_content_viewed(content_id: str) -> dict[str, Any]:
    """Mark content as viewed."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        table.update_item(
            Key={"id": content_id},
            UpdateExpression="SET viewed = :viewed",
            ExpressionAttributeValues={":viewed": True},
        )
    except Exception as error:
        logger.exception("Failed to mark content %s viewed", content_id)
        return {"success": False, "error": str(error)}
    return {"success": True}


def get_content_by_id(content_id: str) -> dict[str, Any] | None:
    """Get one content row, or ``None`` when it cannot be read."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        response = table.get_item(Key={"id": content_id})
    except Exception:
        logger.exception("Failed to get content")
        return None
    return response.get("Item")


def _fail_if_generation_timed_out(row: dict[str, Any]) -> None:
    """Mark only legacy, unowned non-terminal rows failed after their timeout."""
    if row.get("status") not in ("pending", "generating"):
        return
    if row.get("generation_transport") == _STREAM_TRANSPORT or row.get("generation_owner"):
        return
    elapsed = stale_elapsed_seconds(row.get("created_at", ""), GENERATION_TIMEOUT_SECONDS)
    if elapsed is None:
        return
    error_msg = f"Generation timed out after {int(elapsed)} seconds. Please try again."
    update_content_status(row["id"], "failed", {"error": error_msg})
    row["status"] = "failed"
    row["error_message"] = error_msg
    logger.info("Marked legacy content %s failed after %ss", row["id"], int(elapsed))


def _history_freshness(item: dict[str, Any]) -> tuple[str, str]:
    created_at = str(item.get("created_at", ""))
    return str(item.get("updated_at") or created_at), created_at


def _deduplicate_history(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the newest index image for each content id."""
    newest_by_id: dict[str, dict[str, Any]] = {}
    without_id: list[dict[str, Any]] = []
    for item in items:
        content_id = item.get("id")
        if not isinstance(content_id, str) or not content_id:
            without_id.append(item)
            continue
        existing = newest_by_id.get(content_id)
        if existing is None or _history_freshness(item) > _history_freshness(existing):
            newest_by_id[content_id] = item
    return [*newest_by_id.values(), *without_id]


def get_content_history(limit: int = 20) -> list[dict[str, Any]]:
    """Merge status indexes, deduplicate stale images, and return newest rows."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    items: list[dict[str, Any]] = []
    for status in CONTENT_STATUSES:
        response = table.query(
            IndexName=HISTORY_INDEX,
            KeyConditionExpression=Key("status").eq(status),
            ScanIndexForward=False,
            Limit=limit,
        )
        items.extend(response.get("Items", []))
    deduplicated = _deduplicate_history(items)
    for item in deduplicated:
        _fail_if_generation_timed_out(item)
    deduplicated.sort(
        key=lambda item: (str(item.get("created_at", "")), str(item.get("updated_at", ""))),
        reverse=True,
    )
    return deduplicated[:limit]


def get_unviewed_count() -> int:
    """Count every unviewed generated row through the status index."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    params: dict[str, Any] = {
        "IndexName": HISTORY_INDEX,
        "KeyConditionExpression": Key("status").eq("generated"),
        "FilterExpression": "viewed = :viewed",
        "ExpressionAttributeValues": {":viewed": False},
        "Select": "COUNT",
    }
    count = 0
    try:
        while True:
            response = table.query(**params)
            count += response.get("Count", 0)
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                return count
            params["ExclusiveStartKey"] = last_key
    except Exception:
        logger.exception("Failed to get unviewed count")
        return 0


def delete_content(content_id: str) -> dict[str, Any]:
    """Delete generated content."""
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        table.delete_item(Key={"id": content_id})
    except Exception as error:
        logger.exception("Failed to delete content %s", content_id)
        return {"success": False, "error": str(error)}
    return {"success": True, "message": "Content deleted successfully"}


def _template_view(item: dict[str, Any]) -> dict[str, Any]:
    """Return the stable public shape of one saved template row."""
    return {
        "id": item.get("id", ""),
        "name": item.get("name", ""),
        "description": item.get("description", ""),
        "content_angle": item.get("content_angle", ""),
        "prompt_template": item.get("prompt_template", ""),
        "builtin": False,
        "created_by": item.get("created_by"),
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
    }


def _templates_table() -> Any:
    return dynamodb.Table(CONTENT_BRIEF_TEMPLATES_TABLE)


def _load_content_brief_template(template_id: str) -> dict[str, Any]:
    builtin = builtin_content_brief_template(template_id)
    if builtin:
        return builtin
    item = _templates_table().get_item(
        Key={"id": template_id},
        ConsistentRead=True,
    ).get("Item")
    if not item:
        raise ContentBriefTemplateNotFoundError(template_id)
    return _template_view(item)


def _template_reference_issue(template_id: Any) -> ContentBriefValidationIssue | None:
    if not isinstance(template_id, str):
        return ContentBriefValidationIssue("template_id", "template_id must be a string")
    if not template_id.strip():
        return ContentBriefValidationIssue("template_id", "template_id is required")
    if len(template_id) > MAX_TEMPLATE_NAME_LENGTH:
        return ContentBriefValidationIssue(
            "template_id",
            f"template_id must be at most {MAX_TEMPLATE_NAME_LENGTH} characters",
        )
    return None


def _apply_template_reference(
    idea: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any] | None, ContentBriefValidationIssue | None]:
    """Resolve optional template provenance while preserving an exact inline prompt."""
    if "template_id" not in idea or idea.get("template_id") is None:
        return dict(idea), None, None
    template_id = idea.get("template_id")
    issue = _template_reference_issue(template_id)
    if issue:
        return dict(idea), None, issue
    normalized_id = str(template_id).strip()
    template = _load_content_brief_template(normalized_id)
    caller_prompt = idea.get("prompt_template")
    effective_prompt = caller_prompt if caller_prompt is not None else template["prompt_template"]
    resolved = {
        **idea,
        "content_angle": template["content_angle"],
        "prompt_template": effective_prompt,
    }
    provenance = {
        "template_id": template["id"],
        "template_name": template["name"],
        "template_modified": effective_prompt != template["prompt_template"],
    }
    return resolved, provenance, None


def _canonical_content_brief(
    idea: dict[str, Any],
) -> tuple[dict[str, Any] | None, ContentBriefValidationIssue | None]:
    resolved, provenance, issue = _apply_template_reference(idea)
    if issue:
        return None, issue
    canonical, issue = canonicalize_group_brief(
        resolved,
        dynamodb.Table(KEYWORD_GROUPS_TABLE),
        dynamodb.Table(KEYWORDS_TABLE),
    )
    if canonical is not None and provenance is not None:
        canonical.update(provenance)
    return canonical, issue


def _is_conditional_failure(error: ClientError) -> bool:
    return error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def _claim_generation(content_id: str, owner: str) -> _GenerationClaim | None:
    """Atomically acquire one paid-model attempt with a bounded lease."""
    now_epoch = int(utc_now().timestamp())
    lease_expires_at = now_epoch + _GENERATION_LEASE_SECONDS
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    try:
        response = table.update_item(
            Key={"id": content_id},
            UpdateExpression=(
                "SET #status = :generating, generation_owner = :owner, "
                "generation_lease_expires_at = :lease_expires_at, "
                "generation_attempts = if_not_exists(generation_attempts, :zero) + :one, "
                "updated_at = :updated_at "
                "REMOVE error_message, generation_terminal_reason"
            ),
            ConditionExpression=(
                "(#status = :pending OR "
                "(#status = :generating AND generation_owner = :owner AND "
                "(attribute_not_exists(generation_lease_expires_at) OR "
                "generation_lease_expires_at <= :now))) AND "
                "(attribute_not_exists(generation_attempts) OR "
                "generation_attempts < :max_attempts)"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":pending": "pending",
                ":generating": "generating",
                ":owner": owner,
                ":now": now_epoch,
                ":lease_expires_at": lease_expires_at,
                ":zero": 0,
                ":one": 1,
                ":max_attempts": _MAX_GENERATION_ATTEMPTS,
                ":updated_at": get_timestamp(),
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as error:
        if _is_conditional_failure(error):
            return None
        raise
    attributes = response.get("Attributes", {})
    attempt = to_int(attributes.get("generation_attempts"), 0)
    if attempt < 1 or attempt > _MAX_GENERATION_ATTEMPTS:
        raise RuntimeError("Generation claim returned an invalid attempt count")
    return _GenerationClaim(attempt=attempt, lease_expires_at=lease_expires_at)


def _generation_terminal_reason(generation_result: dict[str, Any]) -> str:
    reason = generation_result.get("error_type")
    return reason if isinstance(reason, str) and reason else "model_failure"


def _finish_generation(
    content_id: str,
    owner: str,
    status: str,
    generation_result: dict[str, Any],
    *,
    terminal_reason: str | None = None,
) -> None:
    """Persist one terminal result only while this attempt still owns the row."""
    update_expression = "SET #status = :status, updated_at = :updated_at"
    values: dict[str, Any] = {
        ":status": status,
        ":generating": "generating",
        ":owner": owner,
        ":updated_at": get_timestamp(),
    }
    removed = ["generation_lease_expires_at"]
    if status == "generated":
        update_expression += (
            ", generated_content = :content, raw_content = :raw, model = :model, "
            "competitor_sources_used = :sources"
        )
        values.update(_generated_content_values(generation_result))
        content_warning = generation_result.get("content_warning")
        if isinstance(content_warning, dict):
            update_expression += ", content_warning = :content_warning"
            values[":content_warning"] = content_warning
        removed.extend(("error_message", "generation_terminal_reason"))
    else:
        update_expression += ", error_message = :error, generation_terminal_reason = :reason"
        values[":error"] = generation_result.get("error", "Content generation failed")
        values[":reason"] = terminal_reason or _generation_terminal_reason(generation_result)
        raw_content = generation_result.get("raw_content")
        if isinstance(raw_content, str):
            update_expression += ", raw_content = :raw"
            values[":raw"] = raw_content
    update_expression += f" REMOVE {', '.join(removed)}"
    dynamodb.Table(CONTENT_STUDIO_TABLE).update_item(
        Key={"id": content_id},
        UpdateExpression=update_expression,
        ConditionExpression="#status = :generating AND generation_owner = :owner",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=values,
    )


def _return_generation_to_pending(content_id: str, owner: str) -> None:
    """Release one unexpected failure so the durable delivery can retry."""
    dynamodb.Table(CONTENT_STUDIO_TABLE).update_item(
        Key={"id": content_id},
        UpdateExpression=(
            "SET #status = :pending, updated_at = :updated_at "
            "REMOVE generation_lease_expires_at"
        ),
        ConditionExpression="#status = :generating AND generation_owner = :owner",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":pending": "pending",
            ":generating": "generating",
            ":owner": owner,
            ":updated_at": get_timestamp(),
        },
    )


def _terminalize_unexpected_failure(content_id: str, owner: str) -> None:
    _finish_generation(
        content_id,
        owner,
        "failed",
        {"error": _MAX_ATTEMPTS_ERROR, "error_type": "max_attempts_exhausted"},
        terminal_reason="max_attempts_exhausted",
    )


def _process_generation_async(
    content_id: str,
    idea: dict[str, Any],
    owner: str | None = None,
) -> bool:
    """Claim and run one generation without exceeding three model attempts."""
    claim_owner = owner or f"legacy:{content_id}"
    try:
        claim = _claim_generation(content_id, claim_owner)
    except Exception:
        logger.exception("Could not claim generation for content_id=%s", content_id)
        raise
    if claim is None:
        logger.info("Skipping unclaimable generation for content_id=%s", content_id)
        return False
    try:
        logger.info(
            "Starting generation for content_id=%s owner=%s attempt=%s",
            content_id,
            claim_owner,
            claim.attempt,
        )
        generation_result = generate_content(idea, get_brand_config())
        if generation_result.get("success"):
            _finish_generation(content_id, claim_owner, "generated", generation_result)
            logger.info("Generation completed for content_id=%s attempt=%s", content_id, claim.attempt)
        else:
            _finish_generation(content_id, claim_owner, "failed", generation_result)
            logger.error(
                "Generation failed for content_id=%s attempt=%s: %s",
                content_id,
                claim.attempt,
                generation_result.get("error", "Content generation failed"),
            )
    except Exception:
        logger.exception(
            "Unexpected generation failure for content_id=%s attempt=%s",
            content_id,
            claim.attempt,
        )
        if claim.attempt >= _MAX_GENERATION_ATTEMPTS:
            _terminalize_unexpected_failure(content_id, claim_owner)
            logger.exception("Generation attempts exhausted for content_id=%s", content_id)
            return True
        try:
            _return_generation_to_pending(content_id, claim_owner)
        except Exception:
            logger.exception("Could not return content_id=%s to pending", content_id)
        raise
    return True


def _queue_canonical_idea(
    idea: dict[str, Any],
    *,
    batch_metadata: dict[str, Any] | None = None,
    content_id: str | None = None,
) -> _QueueResult:
    """Conditionally persist one canonical idea; its INSERT is the durable dispatch."""
    include_time_bucket = batch_metadata is None and idea.get("type") != GROUP_BRIEF_TYPE
    pending, created = create_pending_content(
        idea,
        include_time_bucket=include_time_bucket,
        metadata=batch_metadata,
        content_id=content_id,
    )
    return _QueueResult(pending, "accepted" if created else "existing")


def _get_ideas(event: dict[str, Any], context: Any) -> dict[str, Any]:
    config = get_brand_config()
    ideas = generate_content_ideas(config)
    return success_response(
        {
            "ideas": ideas,
            "total_count": len(ideas),
            "generated_at": get_timestamp(),
        },
        event,
    )


def _single_generation_response(event: dict[str, Any], idea: dict[str, Any], queued: _QueueResult) -> dict[str, Any]:
    content_id = queued.item["id"]
    if queued.outcome == "existing":
        status = queued.item.get("status", "pending")
        return success_response(
            {
                "success": True,
                "id": content_id,
                "status": status,
                "message": "Content generation already in progress. Poll /status/{id} for updates.",
                "keyword": idea.get("keyword"),
                "idempotent_hit": True,
            },
            event,
        )
    return success_response(
        {
            "success": True,
            "id": content_id,
            "status": "pending",
            "message": "Content generation started. Poll /status/{id} for updates.",
            "keyword": idea.get("keyword"),
        },
        event,
    )


@parse_json_body
@validate({"idea": {"required": True, "source": "body"}})
def _generate_content(event: dict[str, Any], context: Any, body: dict, idea: dict) -> dict[str, Any]:
    """POST /content-studio/generate - queue one content generation."""
    if not isinstance(idea, dict):
        return validation_error("idea must be an object", event, "idea")
    canonical_idea = idea
    if idea.get("type") == GROUP_BRIEF_TYPE:
        try:
            canonical, issue = _canonical_content_brief(idea)
        except ContentBriefTemplateNotFoundError:
            return not_found_response(resource="Template", event=event)
        if issue:
            return validation_error(issue.message, event, issue.field)
        if canonical is None:
            return validation_error("idea is invalid", event, "idea")
        canonical_idea = canonical
    keyword = canonical_idea.get("keyword")
    if not keyword:
        return validation_error("idea must have a keyword", event, "keyword")
    if len(keyword) > MAX_KEYWORD_LENGTH:
        return validation_error(f"Keyword too long (max {MAX_KEYWORD_LENGTH} characters)", event, "keyword")
    return _single_generation_response(event, canonical_idea, _queue_canonical_idea(canonical_idea))


def _batch_child_idea_id(batch_id: str, keyword_id: str) -> str:
    """Return the stable full SHA-256 child idea id for a batch keyword."""
    return hashlib.sha256(f"{batch_id}:{keyword_id}".encode()).hexdigest()


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def _batch_request_payload_hash(scope: dict[str, Any], brief: dict[str, Any]) -> str:
    """Fingerprint the exact raw request before resolving mutable resources."""
    return hashlib.sha256(
        _canonical_json_bytes({"scope": scope, "brief": brief})
    ).hexdigest()


def _canonical_brief_within_bound(canonical: dict[str, Any]) -> bool:
    return len(_canonical_json_bytes(canonical)) <= _MAX_BATCH_CANONICAL_BRIEF_BYTES


def _batch_request_idea(
    batch_id: str, scope: Any, brief: Any
) -> tuple[dict[str, Any] | None, ContentBriefValidationIssue | None]:
    if not isinstance(brief, dict):
        return None, ContentBriefValidationIssue("brief", "brief must be an object")
    idea: dict[str, Any] = {
        "id": batch_id,
        "type": GROUP_BRIEF_TYPE,
        "scope": scope,
    }
    for field_name in (
        "content_angle",
        "landing_url",
        "current_copy",
        "template_id",
        "prompt_template",
        "output_language",
    ):
        if field_name in brief:
            idea[field_name] = brief[field_name]
    try:
        return _canonical_content_brief(idea)
    except ContentBriefTemplateNotFoundError:
        raise


def _batch_children(batch_id: str, canonical: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        single_keyword_brief(
            canonical,
            idea_id=_batch_child_idea_id(batch_id, keyword_id),
            keyword_id=keyword_id,
            keyword=keyword,
        )
        for keyword_id, keyword in zip(canonical["keyword_ids"], canonical["keywords"], strict=True)
    ]


def _batch_content_ids(children: list[dict[str, Any]]) -> list[str]:
    """Compute every stable child row id before the manifest is persisted."""
    return [_compute_idempotency_key(child, include_time_bucket=False) for child in children]


def _batch_child_descriptors(
    children: list[dict[str, Any]],
    child_ids: list[str],
) -> list[dict[str, Any]]:
    """Snapshot ordered child identity so missing rows remain reportable."""
    return [
        {
            "id": content_id,
            "idea_id": str(child["id"]),
            "keyword_id": str(child["keyword_ids"][0]),
            "keyword": str(child["keyword"]),
            "position": position,
        }
        for position, (child, content_id) in enumerate(
            zip(children, child_ids, strict=True),
            start=1,
        )
    ]


def _load_batch_manifest(batch_id: str) -> dict[str, Any] | None:
    """Read one manifest strongly so an accepted batch is immediately visible."""
    table = dynamodb.Table(CONTENT_BRIEF_BATCHES_TABLE)
    try:
        response = table.get_item(
            Key={"batch_id": batch_id},
            ConsistentRead=True,
        )
    except ClientError as error:
        raise _BatchManifestStorageError("Could not read batch manifest") from error
    item = response.get("Item")
    if item is None:
        return None
    if not isinstance(item, dict):
        raise _BatchManifestStorageError("Batch manifest has an invalid shape")
    return item


def _validated_manifest_snapshot(
    manifest: dict[str, Any],
    batch_id: str,
    request_payload_hash: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if manifest.get("batch_id") != batch_id:
        raise _BatchManifestStorageError("Batch manifest id is invalid")
    if manifest.get("request_payload_hash") != request_payload_hash:
        raise _BatchManifestConflictError(batch_id)
    canonical = manifest.get("canonical_brief")
    if not isinstance(canonical, dict) or not _canonical_brief_within_bound(canonical):
        raise _BatchManifestStorageError("Batch manifest canonical brief is invalid")
    keyword_ids = canonical.get("keyword_ids")
    keywords = canonical.get("keywords")
    if (
        canonical.get("id") != batch_id
        or not isinstance(keyword_ids, list)
        or not isinstance(keywords, list)
        or len(keyword_ids) != len(keywords)
        or any(not isinstance(value, str) or not value for value in [*keyword_ids, *keywords])
    ):
        raise _BatchManifestStorageError("Batch manifest canonical keyword snapshot is invalid")
    descriptors = _manifest_child_descriptors(manifest)
    children = _batch_children(batch_id, canonical)
    child_ids = _batch_content_ids(children)
    if _batch_child_descriptors(children, child_ids) != descriptors:
        raise _BatchManifestStorageError("Batch manifest descriptors do not match its snapshot")
    for timestamp_field in ("created_at", "updated_at"):
        timestamp = manifest.get(timestamp_field)
        if not isinstance(timestamp, str) or not timestamp:
            raise _BatchManifestStorageError(f"Batch manifest {timestamp_field} is invalid")
    return canonical, descriptors


def _new_batch_manifest(
    batch_id: str,
    request_payload_hash: str,
    canonical: dict[str, Any],
    children: list[dict[str, Any]],
    child_ids: list[str],
) -> dict[str, Any]:
    timestamp = get_timestamp()
    return {
        "batch_id": batch_id,
        "request_payload_hash": request_payload_hash,
        "canonical_brief": canonical,
        "children": _batch_child_descriptors(children, child_ids),
        "batch_size": len(children),
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def _register_batch_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    """Create the immutable authority or return the concurrent winner."""
    batch_id = str(manifest["batch_id"])
    table = dynamodb.Table(CONTENT_BRIEF_BATCHES_TABLE)
    try:
        table.put_item(
            Item=manifest,
            ConditionExpression="attribute_not_exists(batch_id)",
        )
    except ClientError as error:
        if not _is_conditional_failure(error):
            raise _BatchManifestStorageError("Could not write batch manifest") from error
        existing = _load_batch_manifest(batch_id)
        if existing is None:
            raise _BatchManifestStorageError(
                "Conflicting batch manifest disappeared during read"
            ) from error
        return existing
    return manifest


def _batch_operational_error(event: dict[str, Any]) -> dict[str, Any]:
    return api_response(500, {"error": _BATCH_STORAGE_ERROR}, event)


def _batch_queue_summary(queued: _QueueResult) -> dict[str, Any]:
    item = queued.item
    return {
        "id": item["id"],
        "idea_id": item.get("idea_id", ""),
        "keyword_id": item.get("keyword_id", ""),
        "keyword": item.get("keyword", ""),
        "status": item.get("status", "pending"),
        "batch_position": item.get("batch_position"),
        "generation_attempts": to_int(item.get("generation_attempts"), 0),
        "generation_terminal_reason": item.get("generation_terminal_reason"),
        "idempotent_hit": queued.outcome == "existing",
    }


def _queue_batch_children(
    batch_id: str,
    children: list[dict[str, Any]],
    child_ids: list[str],
    request_payload_hash: str,
) -> list[_QueueResult]:
    """Queue every missing deterministic child after its manifest is durable."""
    outcomes: list[_QueueResult] = []
    batch_size = len(children)
    for position, (child, content_id) in enumerate(
        zip(children, child_ids, strict=True),
        start=1,
    ):
        outcomes.append(
            _queue_canonical_idea(
                child,
                batch_metadata={
                    "batch_id": batch_id,
                    "batch_size": batch_size,
                    "batch_position": position,
                    "batch_request_hash": request_payload_hash,
                    "keyword_id": child["keyword_ids"][0],
                },
                content_id=content_id,
            )
        )
    return outcomes


def _batch_response(
    event: dict[str, Any], batch_id: str, children: list[dict[str, Any]], outcomes: list[_QueueResult]
) -> dict[str, Any]:
    accepted_count = sum(result.outcome == "accepted" for result in outcomes)
    existing_count = sum(result.outcome == "existing" for result in outcomes)
    return success_response(
        {
            "success": True,
            "batch_id": batch_id,
            "batch_size": len(children),
            "accepted_count": accepted_count,
            "existing_count": existing_count,
            # Retained for existing clients; stream-backed persistence has no
            # immediate dispatch failure state, so this is always zero.
            "failed_count": 0,
            "children": [_batch_queue_summary(result) for result in outcomes],
        },
        event,
        202,
    )


def _batch_authority(
    batch_id: str,
    scope: dict[str, Any],
    brief: dict[str, Any],
    request_payload_hash: str,
) -> tuple[dict[str, Any] | None, ContentBriefValidationIssue | None]:
    """Read immutable authority first; resolve mutable inputs only when absent."""
    existing = _load_batch_manifest(batch_id)
    if existing is not None:
        return existing, None
    canonical, issue = _batch_request_idea(batch_id, scope, brief)
    if issue is not None or canonical is None:
        return None, issue
    batch_size = len(canonical["keyword_ids"])
    if batch_size > MAX_BATCH_KEYWORDS:
        return None, ContentBriefValidationIssue(
            "scope",
            f"scope must resolve to at most {MAX_BATCH_KEYWORDS} active keywords",
        )
    if not _canonical_brief_within_bound(canonical):
        return None, ContentBriefValidationIssue(
            "brief",
            "brief expands beyond the safe batch snapshot limit",
        )
    children = _batch_children(batch_id, canonical)
    child_ids = _batch_content_ids(children)
    manifest = _new_batch_manifest(
        batch_id,
        request_payload_hash,
        canonical,
        children,
        child_ids,
    )
    return _register_batch_manifest(manifest), None


@parse_json_body
@validate(
    {
        "batch_id": {
            "required": True,
            "type": str,
            "min_length": 1,
            "max_length": MAX_GROUP_ID_LENGTH,
            "source": "body",
        },
        "scope": {"required": True, "type": dict, "source": "body"},
        "brief": {"required": True, "type": dict, "source": "body"},
    }
)
def _generate_batch(
    event: dict[str, Any],
    context: Any,
    body: dict,
    batch_id: str,
    scope: dict[str, Any],
    brief: dict[str, Any],
) -> dict[str, Any]:
    """POST /content-studio/generate-batch - queue one child per keyword."""
    normalized_batch_id = batch_id.strip()
    if not normalized_batch_id:
        return validation_error("batch_id is required", event, "batch_id")
    request_payload_hash = _batch_request_payload_hash(scope, brief)
    try:
        manifest, issue = _batch_authority(
            normalized_batch_id,
            scope,
            brief,
            request_payload_hash,
        )
        if issue is not None:
            return validation_error(issue.message, event, issue.field)
        if manifest is None:
            return validation_error("brief is invalid", event, "brief")
        canonical, descriptors = _validated_manifest_snapshot(
            manifest,
            normalized_batch_id,
            request_payload_hash,
        )
    except ContentBriefTemplateNotFoundError:
        return not_found_response(resource="Template", event=event)
    except _BatchManifestConflictError:
        return api_response(
            409,
            {
                "error": "batch_id has already been used for a different batch request",
                "field": "batch_id",
            },
            event,
        )
    except _BatchManifestStorageError:
        logger.exception("Could not resolve batch manifest for %s", normalized_batch_id)
        return _batch_operational_error(event)

    children = _batch_children(normalized_batch_id, canonical)
    child_ids = [descriptor["id"] for descriptor in descriptors]
    outcomes = _queue_batch_children(
        normalized_batch_id,
        children,
        child_ids,
        request_payload_hash,
    )
    return _batch_response(event, normalized_batch_id, children, outcomes)


def _path_id(event: dict[str, Any], marker: str) -> str | None:
    path_params = event.get("pathParameters") or {}
    for key in ("id", "batch_id"):
        value = path_params.get(key)
        if isinstance(value, str) and value:
            return value
    parts = event.get("path", "").rstrip("/").split("/")
    try:
        marker_index = parts.index(marker)
    except ValueError:
        return None
    if marker_index + 1 >= len(parts):
        return None
    return parts[marker_index + 1] or None


def _has_generated_content(content: Any) -> bool:
    """Return whether a stored generated-content object has a useful title or body."""
    if not isinstance(content, dict):
        return False
    return any(
        isinstance(content.get(field_name), str) and bool(content[field_name].strip())
        for field_name in ('title', 'body')
    )


def _get_content_status(event: dict[str, Any], context: Any) -> dict[str, Any]:
    content_id = _path_id(event, "status")
    if not content_id:
        return validation_error("Content ID is required", event, "id")
    content = get_content_by_id(content_id)
    if not content:
        return not_found_response(resource="Content", event=event)
    _fail_if_generation_timed_out(content)
    return success_response(
        {
            "id": content_id,
            "status": content.get("status", "unknown"),
            "keyword": content.get("keyword"),
            "created_at": content.get("created_at"),
            "updated_at": content.get("updated_at"),
            "has_content": _has_generated_content(content.get("generated_content")),
            "content_warning": content.get("content_warning"),
            "error_message": content.get("error_message"),
            "generation_attempts": to_int(content.get("generation_attempts"), 0),
            "generation_terminal_reason": content.get("generation_terminal_reason"),
        },
        event,
    )


@parse_json_body
def _mark_viewed(event: dict[str, Any], context: Any, body: dict) -> dict[str, Any]:
    content_id = body.get("id")
    if not content_id:
        return validation_error("Content ID is required", event, "id")
    result = mark_content_viewed(content_id)
    if result.get("success"):
        return success_response({"success": True, "id": content_id}, event)
    return api_response(500, result, event)


@validate({"limit": {"type": int, "min": 1, "max": 100, "default": 20}})
def _get_history(event: dict[str, Any], context: Any, limit: int) -> dict[str, Any]:
    history = get_content_history(limit)
    return success_response(
        {
            "history": history,
            "total_count": len(history),
            "unviewed_count": get_unviewed_count(),
        },
        event,
    )


def _delete_content(event: dict[str, Any], context: Any) -> dict[str, Any]:
    content_id = _path_id(event, "content-studio")
    if not content_id or content_id in ("content-studio", "api"):
        return validation_error("Content ID is required", event, "id")
    result = delete_content(content_id)
    return api_response(200 if result.get("success") else 404, result, event)


def _list_templates(event: dict[str, Any], context: Any) -> dict[str, Any]:
    response = _templates_table().scan(Limit=MAX_CONTENT_BRIEF_TEMPLATES)
    saved = sorted(
        (_template_view(item) for item in response.get("Items", []) if item.get("id")),
        key=lambda item: (item["name"].casefold(), item["id"]),
    )
    items = [*builtin_content_brief_templates(), *saved]
    return success_response({"items": items, "count": len(items)}, event)


def _template_body_issue(name: str | None, prompt_template: str | None) -> ContentBriefValidationIssue | None:
    if name is not None and not name.strip():
        return ContentBriefValidationIssue("name", "name is required")
    if prompt_template is not None:
        if not prompt_template.strip():
            return ContentBriefValidationIssue("prompt_template", "prompt_template is required")
        placeholder_error = validate_template_placeholders(prompt_template)
        if placeholder_error:
            return ContentBriefValidationIssue("prompt_template", placeholder_error)
    return None


@parse_json_body
@validate(
    {
        "name": {
            "required": True,
            "type": str,
            "min_length": 1,
            "max_length": MAX_TEMPLATE_NAME_LENGTH,
            "source": "body",
        },
        "description": {
            "type": str,
            "max_length": MAX_TEMPLATE_DESCRIPTION_LENGTH,
            "default": "",
            "source": "body",
        },
        "content_angle": {
            "required": True,
            "type": str,
            "choices": list(GROUP_BRIEF_MODES),
            "source": "body",
        },
        "prompt_template": {
            "required": True,
            "type": str,
            "min_length": 1,
            "max_length": MAX_PROMPT_TEMPLATE_LENGTH,
            "source": "body",
        },
    }
)
def _create_template(
    event: dict[str, Any],
    context: Any,
    body: dict,
    name: str,
    description: str,
    content_angle: str,
    prompt_template: str,
) -> dict[str, Any]:
    issue = _template_body_issue(name, prompt_template)
    if issue:
        return validation_error(issue.message, event, issue.field)
    table = _templates_table()
    count = table.scan(Select="COUNT", Limit=MAX_CONTENT_BRIEF_TEMPLATES).get("Count", 0)
    if count >= MAX_CONTENT_BRIEF_TEMPLATES:
        return validation_error(f"Maximum of {MAX_CONTENT_BRIEF_TEMPLATES} templates allowed", event)
    timestamp = get_timestamp()
    item = {
        "id": str(uuid.uuid4()),
        "name": name.strip(),
        "description": description,
        "content_angle": content_angle,
        "prompt_template": prompt_template,
        "builtin": False,
        "created_by": get_caller_identity(event),
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    table.put_item(Item=item)
    return success_response(_template_view(item), event, 201)


def _template_changes(
    *,
    name: str | None,
    description: str | None,
    content_angle: str | None,
    prompt_template: str | None,
) -> dict[str, Any]:
    candidates = {
        "name": name.strip() if name is not None else None,
        "description": description,
        "content_angle": content_angle,
        "prompt_template": prompt_template,
    }
    return {field_name: value for field_name, value in candidates.items() if value is not None}


def _saved_template_target(
    event: dict[str, Any],
) -> tuple[str | None, Any | None, dict[str, Any] | None]:
    """Return an editable template id, table, and row; built-ins have no table."""
    template_id = _path_id(event, "templates")
    if not template_id or builtin_content_brief_template(template_id):
        return template_id, None, None
    table = _templates_table()
    item = table.get_item(
        Key={"id": template_id},
        ConsistentRead=True,
    ).get("Item")
    return template_id, table, item


@parse_json_body
@validate(
    {
        "name": {
            "type": str,
            "min_length": 1,
            "max_length": MAX_TEMPLATE_NAME_LENGTH,
            "source": "body",
        },
        "description": {
            "type": str,
            "max_length": MAX_TEMPLATE_DESCRIPTION_LENGTH,
            "source": "body",
        },
        "content_angle": {
            "type": str,
            "choices": list(GROUP_BRIEF_MODES),
            "source": "body",
        },
        "prompt_template": {
            "type": str,
            "min_length": 1,
            "max_length": MAX_PROMPT_TEMPLATE_LENGTH,
            "source": "body",
        },
    }
)
def _update_template(
    event: dict[str, Any],
    context: Any,
    body: dict,
    name: str | None,
    description: str | None,
    content_angle: str | None,
    prompt_template: str | None,
) -> dict[str, Any]:
    template_id, table, existing = _saved_template_target(event)
    if not template_id:
        return validation_error("Template ID is required", event, "id")
    if table is None:
        return validation_error("Built-in templates cannot be edited; save a copy instead", event, "id")
    if not existing:
        return not_found_response(resource="Template", event=event)
    issue = _template_body_issue(name, prompt_template)
    if issue:
        return validation_error(issue.message, event, issue.field)
    changes = _template_changes(
        name=name,
        description=description,
        content_angle=content_angle,
        prompt_template=prompt_template,
    )
    if not changes:
        return validation_error("Nothing to update", event)

    values: dict[str, Any] = {":updated_at": get_timestamp()}
    names: dict[str, str] = {}
    assignments = ["updated_at = :updated_at"]
    for index, (field_name, value) in enumerate(changes.items()):
        name_token = f"#field{index}"
        value_token = f":value{index}"
        names[name_token] = field_name
        values[value_token] = value
        assignments.append(f"{name_token} = {value_token}")
    response = table.update_item(
        Key={"id": template_id},
        UpdateExpression=f"SET {', '.join(assignments)}",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )
    attributes = response.get("Attributes")
    updated = (
        attributes if isinstance(attributes, dict) else {**existing, **changes, "updated_at": values[":updated_at"]}
    )
    return success_response(_template_view(updated), event)


def _delete_template(event: dict[str, Any], context: Any) -> dict[str, Any]:
    template_id, table, existing = _saved_template_target(event)
    if table is not None and existing:
        table.delete_item(Key={"id": template_id})
        return success_response({"message": "Template deleted successfully"}, event)
    if not template_id:
        return validation_error("Template ID is required", event, "id")
    if table is None:
        return validation_error("Built-in templates cannot be deleted", event, "id")
    return not_found_response(resource="Template", event=event)


def _manifest_descriptor(
    value: Any,
    expected_position: int,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _BatchManifestStorageError("Batch manifest child descriptor is invalid")
    descriptor = {
        "id": value.get("id"),
        "idea_id": value.get("idea_id"),
        "keyword_id": value.get("keyword_id"),
        "keyword": value.get("keyword"),
        "position": to_int(value.get("position"), 0),
    }
    if any(not isinstance(descriptor[field], str) or not descriptor[field] for field in ("id", "idea_id", "keyword_id", "keyword")):
        raise _BatchManifestStorageError("Batch manifest child descriptor fields are invalid")
    if descriptor["position"] != expected_position:
        raise _BatchManifestStorageError("Batch manifest child positions are invalid")
    return descriptor


def _legacy_manifest_descriptors(child_ids: Any) -> list[dict[str, Any]]:
    if (
        not isinstance(child_ids, list)
        or any(not isinstance(child_id, str) or not child_id for child_id in child_ids)
        or len(set(child_ids)) != len(child_ids)
    ):
        raise _BatchManifestStorageError("Batch manifest child ids are invalid")
    return [
        {
            "id": child_id,
            "idea_id": "",
            "keyword_id": "",
            "keyword": "",
            "position": position,
        }
        for position, child_id in enumerate(child_ids, start=1)
    ]


def _manifest_child_descriptors(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    """Read current descriptors while remaining compatible with legacy manifests."""
    raw_children = manifest.get("children")
    if raw_children is None:
        descriptors = _legacy_manifest_descriptors(manifest.get("child_ids"))
    elif isinstance(raw_children, list):
        descriptors = [
            _manifest_descriptor(value, position)
            for position, value in enumerate(raw_children, start=1)
        ]
    else:
        raise _BatchManifestStorageError("Batch manifest children are invalid")
    ids = [descriptor["id"] for descriptor in descriptors]
    if len(ids) != len(set(ids)):
        raise _BatchManifestStorageError("Batch manifest child ids are duplicated")
    if to_int(manifest.get("batch_size"), -1) != len(descriptors):
        raise _BatchManifestStorageError("Batch manifest batch_size is invalid")
    return descriptors


def _missing_batch_child(descriptor: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": descriptor["id"],
        "idea_id": descriptor["idea_id"],
        "keyword_id": descriptor["keyword_id"],
        "keyword": descriptor["keyword"],
        "status": "missing",
        "batch_position": descriptor["position"],
        "created_at": None,
        "updated_at": None,
        "generated_content": {},
        "error_message": _MISSING_CONTENT_ERROR,
    }


def _ordered_batch_children(descriptors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    child_ids = [descriptor["id"] for descriptor in descriptors]
    try:
        items = batch_get_items(
            dynamodb,
            CONTENT_STUDIO_TABLE,
            [{"id": child_id} for child_id in child_ids],
            consistent_read=True,
        )
    except (BatchGetUnprocessedError, ClientError) as error:
        raise _BatchManifestStorageError("Could not read batch children") from error
    by_id = {str(item["id"]): item for item in items if item.get("id")}
    return [
        by_id.get(descriptor["id"], _missing_batch_child(descriptor))
        for descriptor in descriptors
    ]


def _batch_child_summary(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "idea_id": item.get("idea_id"),
        "keyword_id": item.get("keyword_id"),
        "keyword": item.get("keyword"),
        "status": item.get("status", "unknown"),
        "batch_position": item.get("batch_position"),
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
        "has_content": _has_generated_content(item.get("generated_content")),
        "error_message": item.get("error_message"),
        "generation_attempts": to_int(item.get("generation_attempts"), 0),
        "generation_terminal_reason": item.get("generation_terminal_reason"),
    }


def _batch_status_counts(items: list[dict[str, Any]]) -> dict[str, int]:
    observed = Counter(str(item.get("status", "unknown")) for item in items)
    return {
        "pending": observed["pending"],
        "generating": observed["generating"],
        "generated": observed["generated"],
        "failed": observed["failed"],
        "missing": observed["missing"],
        "total": len(items),
    }


def _get_batch(event: dict[str, Any], context: Any) -> dict[str, Any]:
    batch_id = _path_id(event, "batches")
    if not batch_id:
        return validation_error("Batch ID is required", event, "batch_id")
    try:
        manifest = _load_batch_manifest(batch_id)
    except _BatchManifestStorageError:
        logger.exception("Could not load batch manifest for %s", batch_id)
        return _batch_operational_error(event)
    if manifest is None:
        return not_found_response(resource="Batch", event=event)
    try:
        descriptors = _manifest_child_descriptors(manifest)
        items = _ordered_batch_children(descriptors)
    except _BatchManifestStorageError:
        logger.exception("Could not load children for batch %s", batch_id)
        return _batch_operational_error(event)
    for item in items:
        _fail_if_generation_timed_out(item)
    batch_size = len(descriptors)
    return success_response(
        {
            "batch_id": batch_id,
            "batch_size": batch_size,
            "children": [_batch_child_summary(item) for item in items],
            "counts": _batch_status_counts(items),
        },
        event,
    )


@api_handler
@route_handler(
    {
        ("GET", "/ideas"): _get_ideas,
        ("POST", "/generate-batch"): _generate_batch,
        ("POST", "/generate"): _generate_content,
        ("GET", "/status"): _get_content_status,
        ("POST", "/viewed"): _mark_viewed,
        ("GET", "/history"): _get_history,
        ("GET", "/templates"): _list_templates,
        ("POST", "/templates"): _create_template,
        ("PUT", "/templates"): _update_template,
        ("DELETE", "/templates"): _delete_template,
        ("GET", "/batches"): _get_batch,
        ("DELETE", None): _delete_content,
    }
)
def _api_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Route API Gateway requests to Content Studio operations."""
    ...


def _worker_event_bytes(payload: dict[str, Any]) -> bytes:
    try:
        encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise _WorkerDispatchError("Worker event is not JSON serializable") from error
    if len(encoded) > _MAX_WORKER_EVENT_BYTES:
        raise _WorkerDispatchError("Worker event exceeds the bounded payload size")
    return encoded


def _validated_content_and_idea(event: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    content_id = event.get("content_id")
    idea = event.get("idea")
    if (
        not isinstance(content_id, str)
        or not content_id.strip()
        or len(content_id) > _MAX_CONTENT_ID_LENGTH
        or not isinstance(idea, dict)
        or not idea
    ):
        return None
    try:
        _worker_event_bytes({"content_id": content_id, "idea": idea})
    except _WorkerDispatchError:
        return None
    return content_id, idea


def _invoke_worker(payload: dict[str, Any]) -> None:
    try:
        response = invoke_self_async(
            payload,
            None,
            description="Content Studio generation",
            function_name=CONTENT_STUDIO_WORKER_FUNCTION_NAME,
            payload_bytes=_worker_event_bytes(payload),
            lambda_client=boto3.client("lambda"),
        )
    except SelfInvokeDispatchError as error:
        raise _WorkerDispatchError("Content Studio worker invocation failed") from error
    if response is None or to_int(response.get("StatusCode"), 0) != 202:
        raise _WorkerDispatchError("Content Studio worker did not accept the event")


def _forward_legacy_generation(event: dict[str, Any]) -> dict[str, Any]:
    """Temporarily bridge already-queued API self-invocations to the worker."""
    validated = _validated_content_and_idea(event)
    if validated is None:
        logger.error("Invalid legacy async generation event")
        return {"statusCode": 400, "body": "Invalid async event"}
    content_id, idea = validated
    _invoke_worker(
        {
            "legacy_generation": True,
            "content_id": content_id,
            "idea": idea,
        }
    )
    logger.info("Forwarded legacy generation for content_id=%s", content_id)
    return {"statusCode": 202, "body": "Legacy generation forwarded"}


def _load_direct_generation_idea(
    content_id: str,
    event_idea: dict[str, Any],
) -> dict[str, Any] | None:
    response = dynamodb.Table(CONTENT_STUDIO_TABLE).get_item(
        Key={"id": content_id},
        ConsistentRead=True,
    )
    item = response.get("Item")
    if not isinstance(item, dict) or item.get("idea_data") != event_idea:
        logger.error("Rejected mismatched direct generation for content_id=%s", content_id)
        return None
    return event_idea


def _run_direct_generation(
    event: dict[str, Any],
    *,
    legacy: bool,
) -> dict[str, Any]:
    validated = _validated_content_and_idea(event)
    owner = event.get("generation_owner")
    if validated is None or (
        not legacy
        and (
            not isinstance(owner, str)
            or not owner
            or len(owner) > _MAX_CONTENT_ID_LENGTH
        )
    ):
        logger.error("Invalid direct generation event")
        return {"statusCode": 400, "body": "Invalid generation event"}
    content_id, event_idea = validated
    idea = _load_direct_generation_idea(content_id, event_idea)
    if idea is None:
        return {"statusCode": 400, "body": "Invalid generation event"}
    claim_owner = f"legacy:{content_id}" if legacy else str(owner)
    _process_generation_async(content_id, idea, claim_owner)
    return {"statusCode": 200, "body": "Generation processing completed"}


def _reconciliation_cutoff() -> str:
    cutoff = utc_now() - timedelta(seconds=_GENERATION_LEASE_SECONDS)
    return cutoff.isoformat().replace("+00:00", "Z")


def _reconciliation_cursor_field(status: str) -> str:
    return f"{status}_cursor"


def _load_reconciliation_cursors(table: Any) -> dict[str, dict[str, Any]]:
    response = table.get_item(
        Key={"id": _RECONCILIATION_CURSOR_ID},
        ConsistentRead=True,
    )
    item = response.get("Item")
    if not isinstance(item, dict):
        return {}
    cursors: dict[str, dict[str, Any]] = {}
    for status in _RECONCILE_STATUSES:
        cursor = item.get(_reconciliation_cursor_field(status))
        if isinstance(cursor, dict):
            cursors[status] = cursor
    return cursors


def _save_reconciliation_cursors(
    table: Any,
    cursors: dict[str, dict[str, Any] | None],
) -> None:
    set_clauses = ["updated_at = :updated_at"]
    remove_clauses: list[str] = []
    names: dict[str, str] = {}
    values: dict[str, Any] = {":updated_at": get_timestamp()}
    for status in _RECONCILE_STATUSES:
        field = _reconciliation_cursor_field(status)
        name = f"#{field}"
        names[name] = field
        cursor = cursors.get(status)
        if cursor is None:
            remove_clauses.append(name)
            continue
        value = f":{field}"
        set_clauses.append(f"{name} = {value}")
        values[value] = cursor
    update_expression = f"SET {', '.join(set_clauses)}"
    if remove_clauses:
        update_expression += f" REMOVE {', '.join(remove_clauses)}"
    table.update_item(
        Key={"id": _RECONCILIATION_CURSOR_ID},
        UpdateExpression=update_expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def _query_reconciliation_status(
    table: Any,
    status: str,
    cutoff: str,
    start_key: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    params: dict[str, Any] = {
        "IndexName": HISTORY_INDEX,
        "KeyConditionExpression": (
            Key("status").eq(status) & Key("created_at").lte(cutoff)
        ),
        "FilterExpression": "generation_transport = :transport",
        "ExpressionAttributeValues": {":transport": _STREAM_TRANSPORT},
        "ScanIndexForward": True,
    }
    if start_key is not None:
        params["ExclusiveStartKey"] = start_key
    rows: list[dict[str, Any]] = []
    last_key: dict[str, Any] | None = None
    for _ in range(_RECONCILE_MAX_QUERY_PAGES):
        params["Limit"] = _RECONCILE_STATUS_BATCH_SIZE - len(rows)
        response = table.query(**params)
        rows.extend(item for item in response.get("Items", []) if isinstance(item, dict))
        candidate = response.get("LastEvaluatedKey")
        last_key = candidate if isinstance(candidate, dict) else None
        if len(rows) >= _RECONCILE_STATUS_BATCH_SIZE or last_key is None:
            break
        params["ExclusiveStartKey"] = last_key
    return rows, last_key


def _reconciliation_rows() -> tuple[
    Any,
    list[dict[str, Any]],
    dict[str, dict[str, Any] | None],
]:
    table = dynamodb.Table(CONTENT_STUDIO_TABLE)
    cutoff = _reconciliation_cutoff()
    current_cursors = _load_reconciliation_cursors(table)
    next_cursors: dict[str, dict[str, Any] | None] = {}
    rows: list[dict[str, Any]] = []
    for status in _RECONCILE_STATUSES:
        status_rows, next_cursor = _query_reconciliation_status(
            table,
            status,
            cutoff,
            current_cursors.get(status),
        )
        rows.extend(status_rows)
        next_cursors[status] = next_cursor
    return table, sorted(rows, key=lambda item: str(item.get("created_at", ""))), next_cursors


def _conditional_recovery_update(
    content_id: str,
    update_expression: str,
    condition_expression: str,
    values: dict[str, Any],
) -> bool:
    try:
        dynamodb.Table(CONTENT_STUDIO_TABLE).update_item(
            Key={"id": content_id},
            UpdateExpression=update_expression,
            ConditionExpression=condition_expression,
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues=values,
        )
    except ClientError as error:
        if _is_conditional_failure(error):
            return False
        raise
    return True


def _terminalize_exhausted_row(row: dict[str, Any], now_epoch: int) -> bool:
    content_id = row.get("id")
    status = row.get("status")
    if not isinstance(content_id, str) or status not in ("pending", "generating"):
        return False
    condition = "#status = :observed AND generation_attempts >= :max_attempts"
    values: dict[str, Any] = {
        ":observed": status,
        ":failed": "failed",
        ":max_attempts": _MAX_GENERATION_ATTEMPTS,
        ":error": _MAX_ATTEMPTS_ERROR,
        ":reason": "max_attempts_exhausted",
        ":updated_at": get_timestamp(),
    }
    if status == "generating":
        owner = row.get("generation_owner")
        lease = to_int(row.get("generation_lease_expires_at"), 0)
        if not isinstance(owner, str) or lease <= 0 or lease > now_epoch:
            return False
        condition += (
            " AND generation_owner = :owner "
            "AND generation_lease_expires_at = :lease_expires_at"
        )
        values[":owner"] = owner
        values[":lease_expires_at"] = lease
    return _conditional_recovery_update(
        content_id,
        (
            "SET #status = :failed, error_message = :error, "
            "generation_terminal_reason = :reason, updated_at = :updated_at "
            "REMOVE generation_lease_expires_at"
        ),
        condition,
        values,
    )


def _release_expired_generation(row: dict[str, Any], now_epoch: int) -> bool:
    content_id = row.get("id")
    owner = row.get("generation_owner")
    lease_expires_at = to_int(row.get("generation_lease_expires_at"), 0)
    if (
        not isinstance(content_id, str)
        or not isinstance(owner, str)
        or lease_expires_at <= 0
        or lease_expires_at > now_epoch
    ):
        return False
    return _conditional_recovery_update(
        content_id,
        "SET #status = :pending, updated_at = :updated_at REMOVE generation_lease_expires_at",
        (
            "#status = :generating AND generation_owner = :owner AND "
            "generation_lease_expires_at = :lease_expires_at"
        ),
        {
            ":pending": "pending",
            ":generating": "generating",
            ":owner": owner,
            ":lease_expires_at": lease_expires_at,
            ":updated_at": get_timestamp(),
        },
    )


def _recovery_payload(
    row: dict[str, Any],
    now_epoch: int,
) -> tuple[dict[str, Any] | None, bool]:
    if row.get("generation_transport") != _STREAM_TRANSPORT:
        return None, False
    content_id = row.get("id")
    idea = row.get("idea_data")
    status = row.get("status")
    if not isinstance(content_id, str) or not isinstance(idea, dict):
        return None, False
    if to_int(row.get("generation_attempts"), 0) >= _MAX_GENERATION_ATTEMPTS:
        return None, _terminalize_exhausted_row(row, now_epoch)
    if status == "generating" and not _release_expired_generation(row, now_epoch):
        return None, False
    if status not in ("pending", "generating"):
        return None, False
    return (
        {
            "action": "generate",
            "content_id": content_id,
            "idea": idea,
            "generation_owner": f"reconcile:{uuid.uuid4()}",
        },
        False,
    )


def _reconcile_generation() -> dict[str, int]:
    """Recover old stream work even after its original record has expired."""
    now_epoch = int(utc_now().timestamp())
    table, rows, next_cursors = _reconciliation_rows()
    dispatched = 0
    terminalized = 0
    for row in rows:
        if dispatched >= _RECONCILE_BATCH_SIZE:
            break
        payload, became_terminal = _recovery_payload(row, now_epoch)
        terminalized += int(became_terminal)
        if payload is None:
            continue
        _invoke_worker(payload)
        dispatched += 1
    _save_reconciliation_cursors(table, next_cursors)
    logger.info(
        "Reconciled Content Studio rows dispatched=%s terminalized=%s",
        dispatched,
        terminalized,
    )
    return {"dispatched": dispatched, "terminalized": terminalized}


def _deserialize_stream_item(record: dict[str, Any]) -> dict[str, Any] | None:
    if record.get("eventName") != "INSERT":
        return None
    dynamodb_record = record.get("dynamodb")
    if not isinstance(dynamodb_record, dict):
        return None
    new_image = dynamodb_record.get("NewImage")
    if not isinstance(new_image, dict):
        return None
    try:
        return {
            str(name): _STREAM_DESERIALIZER.deserialize(cast(Any, attribute))
            for name, attribute in new_image.items()
            if isinstance(attribute, dict)
        }
    except (TypeError, ValueError):
        logger.exception("Could not deserialize Content Studio stream record")
        return None


def _process_stream_record(record: dict[str, Any]) -> bool:
    item = _deserialize_stream_item(record)
    if (
        item is None
        or item.get("status") != "pending"
        or item.get("generation_transport") != _STREAM_TRANSPORT
    ):
        return False
    content_id = item.get("id")
    idea = item.get("idea_data")
    owner = record.get("eventID")
    if not isinstance(content_id, str) or not isinstance(idea, dict) or not isinstance(owner, str) or not owner:
        logger.error("Ignoring invalid Content Studio stream INSERT")
        return False
    return _process_generation_async(content_id, idea, owner)


def _process_stream_event(event: dict[str, Any]) -> None:
    records = event.get("Records")
    if not isinstance(records, list):
        raise ValueError("DynamoDB stream event must contain Records")
    for record in records:
        if isinstance(record, dict):
            _process_stream_record(record)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Handle API, versioned stream, recovery, and temporary rollout events."""
    if isinstance(event.get("Records"), list):
        _process_stream_event(event)
        return {"batchItemFailures": []}
    if event.get("async_generation") is True:
        return _forward_legacy_generation(event)
    if event.get("legacy_generation") is True:
        return _run_direct_generation(event, legacy=True)
    if event.get("action") == "generate":
        return _run_direct_generation(event, legacy=False)
    if event.get("action") == "reconcile":
        return _reconcile_generation()
    return _api_handler(event, context)
