"""
Keyword Research API Lambda

Provides keyword expansion and competitor analysis using AI providers with web search.
Leverages the same AI providers (OpenAI, Perplexity, Gemini, Claude) used in the main
search functionality, all with native web search capabilities for real-time data.
"""

import contextlib
import json
import logging
import os
import re
import sys
import uuid
from typing import Any
from urllib.parse import urlparse

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

# HTML parsing
from bs4 import BeautifulSoup

from shared.ai_clients import get_web_search_clients, search_with_fallback
from shared.api_response import error_response, success_response, validation_error
from shared.constants import MAX_KEYWORD_LENGTH
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.llm_json import parse_llm_json
from shared.prompt_safety import wrap_user_input
from shared.safe_fetch import fetch_following_validated_redirects
from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async
from shared.stale_jobs import stale_elapsed_seconds
from shared.url_validator import validate_url_safe

# Configure logging
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
KEYWORD_RESEARCH_TABLE = os.environ['KEYWORD_RESEARCH_TABLE']

research_table = dynamodb.Table(KEYWORD_RESEARCH_TABLE)

# Budget after which a non-terminal research row cannot still be running, so
# the reader-side sweep marks it failed. MUST stay above the KeywordMgmt Lambda
# timeout (120s) — a threshold below it would mark live jobs as failed and they
# would then flip back to completed. See `shared.stale_jobs`.
RESEARCH_TIMEOUT_SECONDS = int(os.environ.get('RESEARCH_TIMEOUT_SECONDS', '180'))

# User agent for web requests
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


# =============================================================================
# Research status updates
#
# AI provider clients, fallback, and response-text extraction live in
# `shared.ai_clients` (bugs.md 3.1) — this file previously carried drifted
# simplified copies without retry, justified by a stale bundling comment.
# =============================================================================

def _set_research_status(research_id: str, status: str) -> None:
    """Set the status field of a research record."""
    research_table.update_item(
        Key={'id': research_id},
        UpdateExpression='SET #s = :s',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': status},
    )


def _mark_research_failed(research_id: str, error: Exception) -> None:
    """Record a failed run; never let the bookkeeping write mask the error."""
    with contextlib.suppress(Exception):
        research_table.update_item(
            Key={'id': research_id},
            UpdateExpression='SET #s = :s, error_message = :e',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': 'failed', ':e': str(error)[:500]},
        )


def _fail_if_research_timed_out(row: dict[str, Any]) -> None:
    """Mark a non-terminal row failed once it has outlived the worker's budget.

    `_mark_research_failed` only ever runs from an `except` block, and a Lambda
    timeout is a SIGKILL that raises nothing. So a background run killed at the
    120s ceiling used to leave `status='processing'` forever, with no sweep
    anywhere in this module — the UI polled `/history` and spun indefinitely
    (AUDIT-2026-08-19 §2.9). Content Studio already had this sweep; keyword
    research did not.

    Mutates ``row`` in place so the same response that triggers the sweep
    reports the corrected status.
    """
    if row.get('status') not in ('pending', 'processing'):
        return

    elapsed = stale_elapsed_seconds(row.get('created_at', ''), RESEARCH_TIMEOUT_SECONDS)
    if elapsed is None:
        return

    message = f'Research timed out after {int(elapsed)} seconds. Please try again.'
    with contextlib.suppress(Exception):
        research_table.update_item(
            Key={'id': row['id']},
            UpdateExpression='SET #s = :s, error_message = :e',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': 'failed', ':e': message},
        )
    row['status'] = 'failed'
    row['error_message'] = message
    logger.info(f"Marked research {row['id']} as failed due to timeout ({int(elapsed)}s)")


# =============================================================================
# Page Scraping (fallback when AI web search doesn't have enough context)
# =============================================================================

def fetch_page_seo_elements(url: str) -> dict[str, Any]:
    """
    Fetch a webpage and extract SEO-relevant elements.
    Used as supplementary data for AI analysis.

    Performs its own SSRF validation (rebind-safe) so a direct future
    caller can't bypass the check — `validate_url_safe` is already called
    in the async competitor flow, but belt-and-suspenders.
    """
    # Re-validate here. This is a cheap defense-in-depth check — the
    # primary SSRF gate lives in `_analyze_competitor`, but placing it
    # here ensures any future caller of this function is protected.
    is_safe, ssrf_error = validate_url_safe(url)
    if not is_safe:
        logger.warning("fetch_page_seo_elements rejected URL: %s", ssrf_error)
        return {
            'success': False,
            'error': f'URL rejected: {ssrf_error}',
            'domain': urlparse(url).netloc.replace('www.', ''),
        }

    try:
        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        }

        # Redirects are followed one hop at a time with the destination
        # revalidated each time. `allow_redirects=True` used to hand the chain
        # to `requests`, so the validation above only ever covered the URL the
        # caller typed — one `301` to an internal address bypassed it entirely
        # and this function returns the body (AUDIT-2026-08-19 §2.6).
        response, _final_url, fetch_error = fetch_following_validated_redirects(
            url, headers=headers, timeout=5
        )
        if fetch_error:
            logger.warning("fetch_page_seo_elements rejected URL: %s", fetch_error)
            return {
                'success': False,
                'error': f'URL rejected: {fetch_error}',
                'domain': urlparse(url).netloc.replace('www.', ''),
            }

        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Extract title
        title = ''
        title_tag = soup.find('title')
        if title_tag:
            title = title_tag.get_text(strip=True)

        # Extract meta description
        meta_description = ''
        meta_desc_tag = soup.find('meta', attrs={'name': 'description'})
        if meta_desc_tag:
            meta_description = meta_desc_tag.get('content', '')

        # Extract meta keywords
        meta_keywords = ''
        meta_kw_tag = soup.find('meta', attrs={'name': 'keywords'})
        if meta_kw_tag:
            meta_keywords = meta_kw_tag.get('content', '')

        # Extract H1 tags
        h1_tags = [h1.get_text(strip=True) for h1 in soup.find_all('h1') if h1.get_text(strip=True)][:5]

        # Extract H2 tags
        h2_tags = [h2.get_text(strip=True) for h2 in soup.find_all('h2') if h2.get_text(strip=True)][:10]

        # Extract Open Graph tags
        og_tags = {}
        for og in soup.find_all('meta', attrs={'property': re.compile(r'^og:')}):
            prop = og.get('property', '').replace('og:', '')
            content = og.get('content', '')
            if prop and content:
                og_tags[prop] = content

        # Parse domain
        parsed_url = urlparse(url)
        domain = parsed_url.netloc.replace('www.', '')

        return {
            'success': True,
            'domain': domain,
            'title': title,
            'meta_description': meta_description,
            'meta_keywords': meta_keywords,
            'h1_tags': h1_tags,
            'h2_tags': h2_tags,
            'og_tags': og_tags,
        }

    except Exception as e:
        logger.warning(f"Error fetching {url}: {e}")
        return {
            'success': False,
            'error': str(e),
            'domain': urlparse(url).netloc.replace('www.', '')
        }


@parse_json_body
@validate({
    'seed_keyword': {'required': True, 'type': str, 'max_length': MAX_KEYWORD_LENGTH, 'source': 'body'},
    'industry': {'type': str, 'max_length': 100, 'default': 'general', 'source': 'body'},
    'count': {'type': int, 'min': 1, 'max': 50, 'default': 20, 'source': 'body'}
})
def _expand_keywords(event: dict[str, Any], context: Any, body: dict, seed_keyword: str, industry: str, count: int) -> dict[str, Any]:
    """
    POST /api/keyword-research/expand
    Starts async keyword expansion. Returns immediately with a pending record.

    Unexpected errors are handled by the @api_handler on the router.
    """
    if not get_web_search_clients():
        return error_response("No API keys configured.", event, 400)

    # Create pending record
    research_id = str(uuid.uuid4())
    timestamp = get_timestamp()

    item = {
        'id': research_id,
        'type': 'expansion',
        'seed_keyword': seed_keyword,
        'industry': industry,
        'status': 'pending',
        'keyword_count': 0,
        'created_at': timestamp,
    }
    research_table.put_item(Item=item)

    try:
        invoke_self_async(
            {
                'async_expand': True,
                'research_id': research_id,
                'seed_keyword': seed_keyword,
                'industry': industry,
                'count': count,
            },
            lambda: _process_expand_sync(research_id, seed_keyword, industry, count),
            description='expand',
        )
    except SelfInvokeDispatchError as exc:
        # Running the expansion here instead would outlive API Gateway's 29s
        # timeout: the client gets a 504 while the multi-provider LLM work
        # continues invisibly (AUDIT-2026-08-19 §2.9). Fail fast and mark the
        # row terminal so it does not sit at `pending` forever.
        _mark_research_failed(research_id, exc)
        return error_response(
            'Could not start keyword expansion. Please try again.', event, 503
        )

    return success_response({
        'id': research_id,
        'seed_keyword': seed_keyword,
        'status': 'pending',
        'message': 'Keyword expansion started. Poll /history for results.',
    }, event, 202)


@parse_json_body
@validate({
    'url': {'required': True, 'type': str, 'max_length': 2048, 'source': 'body'}
})
def _analyze_competitor(event: dict[str, Any], context: Any, body: dict, url: str) -> dict[str, Any]:
    """
    POST /api/keyword-research/competitor
    Starts async competitor URL analysis. Returns immediately with a pending record.
    """
    competitor_url = url.strip()
    if not competitor_url.startswith(('http://', 'https://')):
        competitor_url = 'https://' + competitor_url

    is_safe, ssrf_error = validate_url_safe(competitor_url)
    if not is_safe:
        return validation_error(ssrf_error, event)

    if not get_web_search_clients():
        return error_response("No API keys configured.", event, 400)

    # Create pending record
    research_id = str(uuid.uuid4())
    timestamp = get_timestamp()
    parsed_url = urlparse(competitor_url)
    domain = parsed_url.netloc.replace('www.', '')

    item = {
        'id': research_id,
        'type': 'competitor',
        'url': competitor_url,
        'domain': domain,
        'status': 'pending',
        'keyword_count': 0,
        'created_at': timestamp,
    }
    research_table.put_item(Item=item)

    try:
        invoke_self_async(
            {
                'async_competitor': True,
                'research_id': research_id,
                'url': competitor_url,
                'domain': domain,
            },
            lambda: _process_competitor_sync(research_id, competitor_url, domain),
            description='competitor analysis',
            success_log=f"Triggered async competitor analysis for {domain} (id={research_id})",
        )
    except SelfInvokeDispatchError as exc:
        # See the matching guard in `_expand_keywords`.
        _mark_research_failed(research_id, exc)
        return error_response(
            'Could not start competitor analysis. Please try again.', event, 503
        )

    return success_response({
        'id': research_id,
        'url': competitor_url,
        'domain': domain,
        'status': 'pending',
        # There is no /status/{id} route for keyword research — the CDK only
        # registers /expand, /competitor, /history and /{id}. Advertising one
        # sent clients to a 404.
        'message': 'Competitor analysis started. Poll /history for results.',
    }, event, 202)


def _process_expand_sync(research_id: str, seed_keyword: str, industry: str, count: int):
    """Run keyword expansion synchronously (called from async invoke or fallback)."""
    try:
        logger.info(f"Processing keyword expansion for {seed_keyword!r} (id={research_id})")

        _set_research_status(research_id, 'processing')

        all_clients = get_web_search_clients()
        if not all_clients:
            raise Exception("No API keys configured")

        prompt = f"""Search the web for keyword research data about {wrap_user_input(seed_keyword, "seed_keyword")} in the {wrap_user_input(industry, "industry")} industry.

Find {count} related keywords that people actually search for. Use your web search to find:
- Popular search queries related to this topic
- Long-tail keyword variations
- Question-based searches (how, what, why, best, top)
- Comparison searches (vs, alternative, compared to)
- Commercial/transactional keywords

For each keyword, analyze:
1. Search intent (informational, commercial, transactional, navigational)
2. Competition level based on search results (low, medium, high)
3. Relevance to the seed keyword (1-10)

Return ONLY a JSON array with this exact structure, no other text or explanation:
[
  {{"keyword": "example keyword", "intent": "informational", "competition": "medium", "relevance": 8, "source": "where you found this"}},
  ...
]"""

        response_text, provider = search_with_fallback(all_clients, prompt)
        keywords = parse_llm_json(response_text, expect="array") or []

        research_table.update_item(
            Key={'id': research_id},
            UpdateExpression='SET #s = :s, provider = :p, keywords = :kw, keyword_count = :kc, raw_response = :rr',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':s': 'completed',
                ':p': provider,
                ':kw': keywords,
                ':kc': len(keywords),
                ':rr': response_text[:5000],
            },
        )
        logger.info(f"Keyword expansion complete: {len(keywords)} keywords for {seed_keyword!r}")

    except Exception as e:
        logger.error(f"Keyword expansion failed for {seed_keyword!r}: {e}")
        _mark_research_failed(research_id, e)


def _process_competitor_sync(research_id: str, competitor_url: str, domain: str):
    """Run competitor analysis synchronously (called from async invoke or fallback)."""
    try:
        logger.info(f"Processing competitor analysis for {domain} (id={research_id})")

        _set_research_status(research_id, 'processing')

        page_data = fetch_page_seo_elements(competitor_url)

        all_clients = get_web_search_clients()
        if not all_clients:
            raise Exception("No API keys configured")

        # Page SEO elements came from a scraped-on-the-web page so treat as
        # untrusted. Wrap each field.
        seo_context = ""
        if page_data.get('success'):
            title_tag = wrap_user_input(page_data.get('title', 'N/A'), "page_title")
            meta_tag = wrap_user_input(
                page_data.get('meta_description', 'N/A'), "page_meta", max_length=2000
            )
            h1_wrapped = ', '.join(
                wrap_user_input(h, "h1") for h in page_data.get('h1_tags', [])[:3]
            ) or 'N/A'
            h2_wrapped = ', '.join(
                wrap_user_input(h, "h2") for h in page_data.get('h2_tags', [])[:5]
            ) or 'N/A'
            seo_context = f"""
Page SEO Elements (from direct scrape):
- Title: {title_tag}
- Meta Description: {meta_tag}
- H1 Tags: {h1_wrapped}
- H2 Tags: {h2_wrapped}
"""

        domain_tag = wrap_user_input(domain, "domain")
        prompt = f"""Search the web to find HIGH-TRAFFIC, NON-BRANDED, LONG-TAIL keywords that the website {domain_tag} ranks for or should target.

{seo_context}

Find 20 keywords across these categories:
1. Primary Keywords (5): High-traffic product category searches
2. Secondary Keywords (5): Product comparison and "best of" searches
3. Long-tail Keywords (5): Specific product + feature + intent searches
4. Content Gaps (5): Keywords competitors rank for but this site might be missing

For each keyword provide: search intent, competition level, relevance score (1-10).

Return ONLY valid JSON:
{{
  "domain": {json.dumps(domain)},
  "industry": "detected industry",
  "page_focus": "main business focus",
  "primary_keywords": [{{"keyword": "...", "intent": "commercial", "competition": "high", "relevance": 10, "source": "..."}}],
  "secondary_keywords": [{{"keyword": "...", "intent": "commercial", "competition": "medium", "relevance": 8, "source": "..."}}],
  "longtail_keywords": [{{"keyword": "...", "intent": "transactional", "competition": "low", "relevance": 9, "source": "..."}}],
  "content_gaps": [{{"keyword": "...", "intent": "commercial", "competition": "medium", "relevance": 7, "opportunity": "..."}}]
}}"""

        response_text, provider = search_with_fallback(all_clients, prompt)
        # Merge over the default shape so downstream reads never miss keys,
        # exactly as the old local parser guaranteed.
        analysis = {
            **_competitor_analysis_defaults(),
            **(parse_llm_json(response_text, expect="object") or {}),
        }

        if page_data.get('success'):
            analysis['seo_elements'] = {
                'title': page_data.get('title', ''),
                'meta_description': page_data.get('meta_description', ''),
                'h1_tags': page_data.get('h1_tags', []),
                'h2_tags': page_data.get('h2_tags', []),
            }

        total_keywords = sum(len(analysis.get(k, [])) for k in ['primary_keywords', 'secondary_keywords', 'longtail_keywords', 'content_gaps'])

        research_table.update_item(
            Key={'id': research_id},
            UpdateExpression='SET #s = :s, provider = :p, analysis = :a, keyword_count = :kc, raw_response = :rr, industry = :ind, page_focus = :pf',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':s': 'completed',
                ':p': provider,
                ':a': analysis,
                ':kc': total_keywords,
                ':rr': response_text[:5000],
                ':ind': analysis.get('industry', 'unknown'),
                ':pf': analysis.get('page_focus', ''),
            },
        )
        logger.info(f"Competitor analysis complete: {total_keywords} keywords for {domain}")

    except Exception as e:
        logger.error(f"Competitor analysis failed for {domain}: {e}")
        _mark_research_failed(research_id, e)


@validate({
    'type': {'type': str, 'choices': ['expansion', 'competitor']},
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 20}
})
def _get_history(event: dict[str, Any], context: Any, type: str | None = None, limit: int = 20) -> dict[str, Any]:
    """GET /api/keyword-research/history - Get keyword research history.

    Unexpected errors are handled by the @api_handler on the router.
    """
    scan_params = {'Limit': limit}

    if type:
        scan_params['FilterExpression'] = '#t = :type'
        scan_params['ExpressionAttributeNames'] = {'#t': 'type'}
        scan_params['ExpressionAttributeValues'] = {':type': type}

    response = research_table.scan(**scan_params)
    items = response.get('Items', [])

    for item in items:
        _fail_if_research_timed_out(item)

    # Sort by created_at descending
    items.sort(key=lambda x: x.get('created_at', ''), reverse=True)

    # Remove raw_response from list view
    for item in items:
        item.pop('raw_response', None)

    return success_response({
        'items': items,
        'count': len(items)
    }, event)


def _delete_research(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """DELETE /api/keyword-research/{id} - Delete a research result.

    Unexpected errors are handled by the @api_handler on the router.
    """
    path_params = event.get('pathParameters') or {}
    research_id = path_params.get('id')

    if not research_id:
        return validation_error('Research ID is required', event, 'id')

    research_table.delete_item(Key={'id': research_id})
    return success_response({'message': 'Research deleted successfully'}, event)


@api_handler
@route_handler({
    ('POST', '/expand'): _expand_keywords,
    ('POST', '/competitor'): _analyze_competitor,
    ('GET', '/history'): _get_history,
    ('DELETE', None): _delete_research,
})
def _route_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Route handler for API Gateway requests."""
    pass  # Routes handle everything


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Main handler - dispatches async invocations or routes API requests.
    """
    # Handle async keyword expansion
    if event.get('async_expand'):
        _process_expand_sync(
            event['research_id'],
            event['seed_keyword'],
            event['industry'],
            event.get('count', 20),
        )
        return {'status': 'completed'}

    # Handle async competitor analysis invocation
    if event.get('async_competitor'):
        _process_competitor_sync(
            event['research_id'],
            event['url'],
            event['domain'],
        )
        return {'status': 'completed'}

    # Normal API Gateway request
    return _route_handler(event, context)


def _competitor_analysis_defaults() -> dict[str, Any]:
    """Fresh default shape for a competitor analysis result.

    Built per call so the empty lists are never shared between requests.
    JSON parsing itself is `shared.llm_json.parse_llm_json` (bugs.md 3.1) —
    the local parsers it replaced lacked fence stripping and truncation
    salvage.
    """
    return {
        'domain': '',
        'industry': 'unknown',
        'page_focus': '',
        'primary_keywords': [],
        'secondary_keywords': [],
        'longtail_keywords': [],
        'content_gaps': [],
    }
