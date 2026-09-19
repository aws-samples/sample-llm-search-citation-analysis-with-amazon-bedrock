"""Crawler Lambda for AgentCore browser extraction and page analysis."""

import json
import logging
import os
import time
from typing import Any

import boto3

from shared.browser_tools import SimpleBrowserTools
from shared.config import LambdaConfig
from shared.crawl_cache import (
    CachedCrawl,
    blocked_cache_scope,
    find_fresh_crawl,
    success_cache_scope,
)
from shared.llm_json import parse_llm_json
from shared.models import ModelRole, invoke_bedrock
from shared.prompt_safety import untrusted_input_system_instruction, wrap_user_input
from shared.step_function_response import log_error
from shared.url_validator import validate_url_safe
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

config = LambdaConfig()
dynamodb: Any = boto3.resource('dynamodb', region_name=config.region)
SCREENSHOTS_BUCKET = os.environ['SCREENSHOTS_BUCKET']


def analyze_content_combined(content: str, title: str, url: str, keyword: str) -> tuple[str, dict[str, Any]]:
    """Generate summary and keyword-specific SEO analysis in one Bedrock call."""
    try:
        logger.info("Analyzing crawled content (summary + SEO)")
        max_content_length = 8000
        truncated_content = content[:max_content_length] if len(content) > max_content_length else content

        url_tag = wrap_user_input(url, "url", max_length=2048)
        title_tag = wrap_user_input(title, "title")
        keyword_tag = wrap_user_input(keyword, "keyword")
        content_tag = wrap_user_input(truncated_content, "page_content", max_length=max_content_length + 200)

        prompt = f"""{untrusted_input_system_instruction()}

Analyze this web page and provide both a summary and SEO analysis.

URL: {url_tag}
Title: {title_tag}
Search Keyword: {keyword_tag}

Content:
{content_tag}

Please provide:
1. A concise 2-3 sentence summary of the page
2. SEO analysis in JSON format

Format your response as:
SUMMARY: [your 2-3 sentence summary here]

SEO_ANALYSIS:
{{
  "relevance_score": 1-10,
  "keyword_usage": "description of how keyword is used",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "recommendations": ["action 1", "action 2", "action 3"],
  "competitive_advantage": "what makes this page rank well"
}}"""

        response_text = invoke_bedrock(prompt, ModelRole.SUMMARIZATION, max_tokens=1200, temperature=0.3)

        summary = ""
        if "SUMMARY:" in response_text:
            summary_start = response_text.find("SUMMARY:") + len("SUMMARY:")
            summary_end = response_text.find("SEO_ANALYSIS:")
            if summary_end == -1:
                summary_end = response_text.find("{")
            summary = response_text[summary_start:summary_end].strip()

        parsed_analysis = parse_llm_json(response_text, expect="object")
        seo_analysis = parsed_analysis if isinstance(parsed_analysis, dict) else {}
        if not seo_analysis:
            logger.warning("Could not parse SEO JSON for crawled page")

        logger.info("Combined crawl analysis completed")
        return summary, seo_analysis

    except Exception as exc:
        logger.error("Error in combined crawl analysis: %s", exc)
        return "", {}


def upload_screenshot_to_s3(screenshot_base64: str, url: str, timestamp: str) -> str:
    """Upload a base64-encoded screenshot under the crawler evidence prefix."""
    try:
        import base64
        from urllib.parse import urlparse

        screenshot_bytes = base64.b64decode(screenshot_base64)
        parsed_url = urlparse(url)
        domain = parsed_url.netloc.replace('www.', '')
        date_prefix = timestamp[:10]
        s3_key = f"screenshots/{date_prefix}/{domain}/{timestamp}.png"

        s3_client = boto3.client('s3', region_name=config.region)
        s3_client.put_object(
            Bucket=SCREENSHOTS_BUCKET,
            Key=s3_key,
            Body=screenshot_bytes,
            ContentType='image/png',
            Metadata={
                'url': url,
                'timestamp': timestamp,
            },
        )

        s3_uri = f"s3://{SCREENSHOTS_BUCKET}/{s3_key}"
        logger.info("Crawler screenshot uploaded")
        return s3_uri

    except Exception as exc:
        logger.error("Error uploading screenshot: %s", exc)
        return ""


def _load_block_patterns() -> dict[str, list[str]]:
    """Load the bundled block-page pattern dictionary once per cold start."""
    patterns_path = os.path.join(os.path.dirname(__file__), 'block_patterns.json')
    try:
        with open(patterns_path, encoding='utf-8') as file_handle:
            data = json.load(file_handle)
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Failed to load block_patterns.json: %s", exc)
        return {}

    return {
        reason: [pattern for pattern in patterns if isinstance(pattern, str)]
        for reason, patterns in data.items()
        if isinstance(patterns, list)
    }


_BLOCK_PATTERNS = _load_block_patterns()


def detect_blocked_page(content: str, title: str) -> tuple[bool, str | None]:
    """Detect known publisher block pages without attempting any bypass."""
    combined_text = f'{content} {title}'.lower()
    for reason, indicators in _BLOCK_PATTERNS.items():
        if any(indicator in combined_text for indicator in indicators):
            return True, reason

    content_stripped = content.strip() if content else ''
    if len(content_stripped) < 100:
        return True, 'empty_content'

    return False, None


def store_crawled_content(
    normalized_url: str,
    keyword: str,
    title: str,
    content: str,
    summary: str,
    citation_count: int,
    citing_providers: list[str],
    status: str,
    error_message: str | None = None,
    page_load_time_ms: int | None = None,
    content_length: int | None = None,
    screenshot_s3_uri: str | None = None,
    seo_analysis: dict[str, Any] | None = None,
    block_reason: str | None = None,
    analysis_status: str | None = None,
) -> None:
    """Append a crawl artifact to the URL-partitioned DynamoDB history."""
    logger.info("Storing crawled content")
    table = dynamodb.Table(config.crawled_content_table)
    stored_keyword = keyword if keyword and keyword.strip() else 'unknown'
    item: dict[str, Any] = {
        'normalized_url': normalized_url,
        'crawled_at': get_timestamp(),
        'keyword': stored_keyword,
        'title': title,
        'content': content,
        'summary': summary,
        'citation_count': citation_count,
        'citing_providers': citing_providers,
        'status': status,
    }

    if page_load_time_ms is not None or content_length is not None:
        item['metadata'] = {}
        if page_load_time_ms is not None:
            item['metadata']['page_load_time_ms'] = page_load_time_ms
        if content_length is not None:
            item['metadata']['content_length'] = content_length
    if error_message:
        item['error_message'] = error_message
    if block_reason:
        item['block_reason'] = block_reason
    if screenshot_s3_uri:
        item['screenshot_s3_uri'] = screenshot_s3_uri
    if seo_analysis:
        item['seo_analysis'] = seo_analysis
    if analysis_status:
        item['analysis_status'] = analysis_status
    if status in {'success', 'error'}:
        item['cache_scope'] = success_cache_scope(normalized_url, stored_keyword)
        item['cache_status'] = status
    elif status == 'blocked':
        item['cache_scope'] = blocked_cache_scope(normalized_url)
        item['cache_status'] = status

    table.put_item(Item=item)
    logger.info("Crawled content stored")


def _cached_result(url: str, cached: CachedCrawl) -> dict[str, Any]:
    """Build the compact Step Functions result for a cache hit."""
    result: dict[str, Any] = {
        'url': url,
        'status': cached['status'],
        'cached': True,
        'crawled_at': cached['crawled_at'],
    }
    block_reason = cached.get('block_reason')
    if block_reason:
        result['block_reason'] = block_reason
    logger.info("Crawl cache hit (%s)", cached['status'])
    return result


def _refresh_cached_citation_metadata(
    table: Any,
    url: str,
    cached: CachedCrawl,
    citation_count: int,
    citing_providers: list[str],
) -> None:
    """Keep cache artifact citation metrics aligned with current evidence."""
    try:
        table.update_item(
            Key={
                'normalized_url': url,
                'crawled_at': cached['crawled_at'],
            },
            UpdateExpression='SET citation_count = :count, citing_providers = :providers',
            ExpressionAttributeValues={
                ':count': citation_count,
                ':providers': citing_providers,
            },
        )
    except Exception as exc:
        logger.warning("Could not refresh cached citation metadata (%s)", type(exc).__name__)


def _error_result(
    *,
    url: str,
    keyword: str,
    citation_count: int,
    citing_providers: list[str],
    error_message: str,
    title: str = '',
    page_load_time_ms: int | None = None,
) -> dict[str, Any]:
    """Persist and return one compact crawl error."""
    store_crawled_content(
        normalized_url=url,
        keyword=keyword,
        title=title,
        content='',
        summary='',
        citation_count=citation_count,
        citing_providers=citing_providers,
        status='error',
        error_message=error_message,
        page_load_time_ms=page_load_time_ms,
    )
    return {
        'url': url,
        'status': 'error',
        'error': error_message,
    }


def _navigation_blocked_result(
    *,
    url: str,
    keyword: str,
    citation_count: int,
    citing_providers: list[str],
    block_reason: str,
    page_load_time_ms: int,
) -> dict[str, Any]:
    """Persist an early navigation block without converting it to an error."""
    store_crawled_content(
        normalized_url=url,
        keyword=keyword,
        title='',
        content='',
        summary='',
        citation_count=citation_count,
        citing_providers=citing_providers,
        status='blocked',
        error_message=f'Bot detection - {block_reason}',
        page_load_time_ms=page_load_time_ms,
        block_reason=block_reason,
    )
    return {
        'url': url,
        'status': 'blocked',
        'block_reason': block_reason,
    }


def crawl_citation(citation: dict[str, Any]) -> dict[str, Any]:
    """Return a cached verdict or crawl and persist one citation URL."""
    raw_url = citation.get('normalized_url')
    url = raw_url if isinstance(raw_url, str) else ''
    raw_keyword = citation.get('keyword', '')
    keyword = raw_keyword if isinstance(raw_keyword, str) and raw_keyword.strip() else 'unknown'
    citation_count = citation.get('citation_count', 0)
    citing_providers = citation.get('citing_providers', [])
    browser_tools: SimpleBrowserTools | None = None

    logger.info("Starting citation crawl")

    try:
        is_safe, validation_error = validate_url_safe(url)
        if not is_safe:
            logger.warning("Citation URL rejected by crawler safety policy")
            return _error_result(
                url=url,
                keyword=keyword,
                citation_count=citation_count,
                citing_providers=citing_providers,
                error_message=validation_error,
            )

        table = dynamodb.Table(config.crawled_content_table)
        cached = find_fresh_crawl(
            table,
            config.crawl_cache_index_name,
            url,
            keyword,
            success_freshness_days=config.crawl_freshness_days,
            blocked_freshness_days=config.crawl_blocked_freshness_days,
        )
        if cached is not None:
            if cached['status'] == 'success':
                _refresh_cached_citation_metadata(
                    table,
                    url,
                    cached,
                    citation_count,
                    citing_providers,
                )
            return _cached_result(url, cached)

        browser_tools = SimpleBrowserTools(config)
        start_time = time.monotonic()
        browser_tools.create_browser()
        browser_tools.initialize_browser_session()

        nav_result = browser_tools.navigate_to_url(url)
        page_load_time_ms = int((time.monotonic() - start_time) * 1000)
        if nav_result['status'] == 'blocked':
            block_reason = nav_result.get('block_reason', 'captcha')
            browser_tools.cleanup()
            browser_tools = None
            return _navigation_blocked_result(
                url=url,
                keyword=keyword,
                citation_count=citation_count,
                citing_providers=citing_providers,
                block_reason=block_reason,
                page_load_time_ms=page_load_time_ms,
            )
        if nav_result['status'] != 'success':
            error_message = nav_result.get('error', 'Navigation failed')
            logger.error("Navigation failed: %s", error_message)
            browser_tools.cleanup()
            browser_tools = None
            return _error_result(
                url=url,
                keyword=keyword,
                citation_count=citation_count,
                citing_providers=citing_providers,
                error_message=error_message,
                page_load_time_ms=page_load_time_ms,
            )

        content_result = browser_tools.extract_page_content()
        if content_result['status'] != 'success':
            error_message = content_result.get('error', 'Content extraction failed')
            logger.error("Content extraction failed: %s", error_message)
            browser_tools.cleanup()
            browser_tools = None
            return _error_result(
                url=url,
                keyword=keyword,
                citation_count=citation_count,
                citing_providers=citing_providers,
                error_message=error_message,
                title=nav_result.get('title', ''),
                page_load_time_ms=page_load_time_ms,
            )

        title = content_result.get('title', '')
        content = content_result.get('content', '')
        content_length = content_result.get('content_length', 0)
        logger.info("Extracted %s visible characters", content_length)

        screenshot_result = browser_tools.take_screenshot()
        if screenshot_result['status'] != 'success':
            logger.warning("Screenshot capture failed: %s", screenshot_result.get('error'))

        # Freeze the captured page before any external write or model work.
        # This closes the final redirect race and stops paid AgentCore time
        # while S3/Bedrock/DynamoDB consume already-extracted data.
        browser_tools.cleanup()
        navigation_guard_error = browser_tools.navigation_guard_error
        browser_tools = None
        if navigation_guard_error:
            return _error_result(
                url=url,
                keyword=keyword,
                citation_count=citation_count,
                citing_providers=citing_providers,
                error_message=navigation_guard_error,
                title=title,
                page_load_time_ms=page_load_time_ms,
            )

        screenshot_s3_uri = None
        if screenshot_result['status'] == 'success':
            screenshot_s3_uri = upload_screenshot_to_s3(
                screenshot_result['screenshot_base64'],
                url,
                get_timestamp(),
            )

        is_blocked, block_reason = detect_blocked_page(content, title)
        if is_blocked:
            logger.warning("Publisher block page detected (%s)", block_reason)
            store_crawled_content(
                normalized_url=url,
                keyword=keyword,
                title=title,
                content=content,
                summary='',
                citation_count=citation_count,
                citing_providers=citing_providers,
                status='blocked',
                error_message=f'Bot detection - {block_reason}',
                page_load_time_ms=page_load_time_ms,
                content_length=content_length,
                screenshot_s3_uri=screenshot_s3_uri,
                block_reason=block_reason,
            )
            return {
                'url': url,
                'status': 'blocked',
                'block_reason': block_reason,
            }

        summary, seo_analysis = analyze_content_combined(content, title, url, keyword)
        analysis_status = 'complete' if summary and seo_analysis else 'failed'
        store_crawled_content(
            normalized_url=url,
            keyword=keyword,
            title=title,
            content=content,
            summary=summary,
            citation_count=citation_count,
            citing_providers=citing_providers,
            status='success',
            page_load_time_ms=page_load_time_ms,
            content_length=content_length,
            screenshot_s3_uri=screenshot_s3_uri,
            seo_analysis=seo_analysis,
            analysis_status=analysis_status,
        )
        return {
            'url': url,
            'status': 'success',
        }

    except Exception as exc:
        if browser_tools is not None:
            browser_tools.cleanup()
            browser_tools = None
        logger.error("Error crawling citation: %s", exc)
        try:
            return _error_result(
                url=url,
                keyword=keyword,
                citation_count=citation_count,
                citing_providers=citing_providers,
                error_message=str(exc),
            )
        except Exception as store_error:
            logger.error("Failed to store crawler error status: %s", store_error)
            return {
                'url': url,
                'status': 'error',
                'error': str(exc),
            }

    finally:
        if browser_tools is not None:
            browser_tools.cleanup()


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Crawl one Step Functions citation item."""
    logger.info("Received crawler event")
    citation = event.get('citation', {})
    url = citation.get('normalized_url')

    keyword_override = event.get('keyword', '')
    if keyword_override:
        citation['keyword'] = keyword_override

    if not url:
        error = ValueError("Missing required parameter: normalized_url")
        log_error(error, "crawler handler", event)
        raise error

    try:
        result = crawl_citation(citation)
        logger.info("Crawl completed with status %s", result.get('status'))
        return result
    except Exception as exc:
        log_error(exc, f"crawling URL {url}", event)
        raise
