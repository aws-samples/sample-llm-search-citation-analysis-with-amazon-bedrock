"""
Search Lambda Function - Lightweight Version
Queries multiple AI providers using direct HTTP API calls (no heavy SDKs).
"""

import json
import logging
import os
import re
import time
from collections.abc import Callable
from typing import Any

import boto3

# Import lightweight API clients
from api_clients import (
    ClaudeClient,
    GeminiClient,
    OpenAIClient,
    PerplexityClient,
    clean_url,
    extract_citations_from_response,
)
from brand_extractor import extract_brands_from_response
from search_clients import BraveSearchClient, ExaSearchClient, FirecrawlSearchClient, SerpAPIClient, TavilySearchClient

# Import centralized provider constants and error handling
from shared.config import Provider
from shared.constants import MAX_KEYWORD_LENGTH
from shared.dynamo_decimal import convert_floats_to_decimal
from shared.prompt_safety import sanitize_user_input
from shared.provider_health import record_provider_failure, record_provider_success
from shared.safe_fetch import fetch_following_validated_redirects, host_matches
from shared.secrets import get_api_key
from shared.step_function_response import log_error

# Configure logging
from shared.utils import get_brand_config, get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Load extraction config
_extraction_config = None
def get_extraction_config() -> dict[str, Any]:
    """Load extraction config from file (cached)."""
    global _extraction_config
    if _extraction_config is None:
        try:
            config_path = os.path.join(os.path.dirname(__file__), 'extraction_config.json')
            with open(config_path) as f:
                _extraction_config = json.load(f)
            logger.info("Loaded extraction config")
        except Exception as e:
            logger.warning(f"Failed to load extraction config: {e!s}, using defaults")
            _extraction_config = {"hotel_extraction": {"enabled": True, "config": {}}}
    return _extraction_config

# Environment variables
DYNAMODB_TABLE_SEARCH_RESULTS = os.environ.get('DYNAMODB_TABLE_SEARCH_RESULTS')
RAW_RESPONSES_BUCKET = os.environ.get('RAW_RESPONSES_BUCKET')
# Provider config table — canonical name first, legacy fallback for in-flight
# deploys. Default mirrors the CDK resource name so a bootstrap deploy works
# even before env vars flow through. Audit #12.
PROVIDER_CONFIG_TABLE = (
    os.environ.get('DYNAMODB_TABLE_PROVIDER_CONFIG')
    or os.environ.get('PROVIDER_CONFIG_TABLE')
    or 'CitationAnalysis-ProviderConfig'
)


def slugify(text: str) -> str:
    """Convert text to URL-safe slug for S3 keys."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '-', text)
    return text[:100]  # Limit length


def store_raw_response_to_s3(
    keyword: str,
    provider: str,
    timestamp: str,
    raw_response: dict[str, Any],
    extracted_data: dict[str, Any],
    metadata: dict[str, Any]
) -> str | None:
    """
    Store raw API response to S3.

    Structure: raw-responses/{date}/{keyword-slug}/{provider}/{timestamp}.json

    Returns S3 URI if successful, None otherwise.
    """
    if not RAW_RESPONSES_BUCKET:
        logger.warning("RAW_RESPONSES_BUCKET not set, skipping S3 storage")
        return None

    try:
        # Parse date from timestamp
        date_str = timestamp[:10]  # YYYY-MM-DD

        # Create S3 key
        keyword_slug = slugify(keyword)
        # Make timestamp safe for S3 key (replace : with -)
        safe_timestamp = timestamp.replace(':', '-')
        s3_key = f"raw-responses/{date_str}/{keyword_slug}/{provider}/{safe_timestamp}.json"

        # Build the full document
        document = {
            "keyword": keyword,
            "provider": provider,
            "timestamp": timestamp,
            "raw_api_response": raw_response,
            "extracted": extracted_data,
            "metadata": metadata
        }

        # Upload to S3
        s3_client.put_object(
            Bucket=RAW_RESPONSES_BUCKET,
            Key=s3_key,
            Body=json.dumps(document, default=str, indent=2),
            ContentType='application/json'
        )

        s3_uri = f"s3://{RAW_RESPONSES_BUCKET}/{s3_key}"
        logger.info(f"Stored raw response to {s3_uri}")
        return s3_uri

    except Exception as e:
        logger.error(f"Failed to store raw response to S3: {e!s}")
        return None


def is_provider_enabled(provider_id: str) -> bool:
    """Check if a provider is enabled in the config table.

    Fails closed: if the config table is unavailable, return False so we do
    not accidentally invoke a provider the user has disabled. A transient
    DynamoDB failure should not override user intent.
    """
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        response = table.get_item(Key={'provider_id': provider_id})
        item = response.get('Item')
        if item:
            return item.get('enabled', True)
        # No config row yet -> treat as enabled (first-run default)
        return True
    except Exception as e:
        logger.error(
            "provider_config_read_failed provider=%s error=%s action=fail_closed",
            provider_id,
            type(e).__name__,
        )
        return False

# Default models per provider (used when no override in ProviderConfig table)
DEFAULT_PROVIDER_MODELS = {
    Provider.OPENAI: 'gpt-5-mini',
    Provider.PERPLEXITY: 'sonar',
    Provider.GEMINI: 'gemini-3-flash-preview',
    Provider.CLAUDE: 'claude-sonnet-4-5',
}

# Cache for provider models (per Lambda invocation)
_provider_model_cache = {}

class ProviderConfigUnavailableError(RuntimeError):
    """Raised when provider config cannot be read and no safe default exists."""


def get_provider_model(provider_id: str) -> str:
    """Get configured model for a provider, with sensible defaults.

    Reads the 'model' field from the ProviderConfig table if set,
    otherwise falls back to DEFAULT_PROVIDER_MODELS.

    Fails closed: raises ProviderConfigUnavailableError on DynamoDB errors
    so the caller can skip the provider rather than silently using a
    different model than the admin configured.
    """
    if provider_id in _provider_model_cache:
        return _provider_model_cache[provider_id]

    default = DEFAULT_PROVIDER_MODELS.get(provider_id, '')
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        response = table.get_item(Key={'provider_id': provider_id})
        item = response.get('Item', {})
        model = item.get('model', default)
        if not model:
            model = default
        _provider_model_cache[provider_id] = model
        logger.info(f"Provider {provider_id} using model: {model}")
        return model
    except Exception as e:
        logger.error(
            "provider_model_read_failed provider=%s error=%s action=fail_closed",
            provider_id,
            type(e).__name__,
        )
        raise ProviderConfigUnavailableError(
            f"Cannot read model config for provider {provider_id}"
        ) from e



def build_provider_query(keyword: str, query_template: str | None) -> str:
    """Resolve the provider query from an optional ``{keyword}`` template.

    Every query_* function previously repeated this two-liner (bugs.md 3.2).

    **Every provider receives the identical string.** There used to be a
    ``default`` parameter for per-provider no-template phrasing, and OpenAI was
    the only caller using it — it asked ``"Search for information about: X"``
    while Perplexity and Gemini asked ``"X"``. Since the entire point of this
    system is comparing how different providers cite brands for the same query,
    a per-provider wording difference is an uncontrolled variable in the
    comparison. Provider-specific coaxing now belongs in provider-specific
    parameters (see ``CLAUDE_CITATION_SYSTEM_PROMPT``), never in the query.

    ``manage-query-prompts.py`` rejects any persona template lacking
    ``{keyword}`` on both create and update, so a template can never silently
    drop the keyword and send the same query for every keyword.
    """
    if query_template:
        return query_template.replace("{keyword}", keyword)
    return keyword


# Claude needs explicit prompting to emit source URLs, and citations are this
# system's primary output — without it Claude returns prose with nothing to
# extract. This used to be appended to the keyword itself, which meant Claude's
# query differed from every other provider's, and with a persona active the
# instruction landed wherever `{keyword}` happened to sit mid-template.
# Carrying it in the system prompt keeps the user-facing query identical across
# providers while preserving the behaviour it was added for.
CLAUDE_CITATION_SYSTEM_PROMPT = (
    "Include the source URL for every claim you make in your answer."
)


def provider_error_result(provider: str, model: str, error: Exception, start_time: float) -> dict[str, Any]:
    """The uniform error-result dict every query_* previously duplicated."""
    return {
        "provider": provider,
        "response": "",
        "citations": [],
        "status": "error",
        "error": str(error),
        "raw_response": None,
        "metadata": {"model": model, "latency_ms": int((time.time() - start_time) * 1000)}
    }


def query_openai(keyword: str, api_key: str, model: str = "gpt-5-mini", query_template: str | None = None) -> dict[str, Any]:
    """Query OpenAI API with native web search via Responses API."""
    start_time = time.time()
    try:
        client = OpenAIClient(api_key)

        query = build_provider_query(keyword, query_template)

        # Use Responses API with native web search
        raw_response = client.responses_with_web_search(
            query=query,
            model=model
        )

        latency_ms = int((time.time() - start_time) * 1000)

        # Extract response text and citations
        response_text = ""
        citations = []

        # Parse output items
        output = raw_response.get('output', [])
        for item in output:
            if item.get('type') == 'message':
                # Extract text content
                content = item.get('content', [])
                for content_item in content:
                    if content_item.get('type') == 'output_text':
                        response_text += content_item.get('text', '')

                        # Extract citations from annotations
                        annotations = content_item.get('annotations', [])
                        for annotation in annotations:
                            if annotation.get('type') == 'url_citation':
                                url = annotation.get('url')
                                if url:
                                    citations.append(clean_url(url))

            elif item.get('type') == 'web_search_call':
                # Extract sources from web search call
                action = item.get('action', {})
                sources = action.get('sources', [])
                for source in sources:
                    url = source.get('url')
                    if url:
                        citations.append(clean_url(url))

        # Fallback: extract from output_text if available
        if not response_text:
            response_text = raw_response.get('output_text', '')

        # Remove duplicates from citations
        citations = list(dict.fromkeys(citations))  # Preserves order

        logger.info(f"OpenAI found {len(citations)} citations for '{keyword}'")

        return {
            "provider": Provider.OPENAI,
            "response": response_text,
            "citations": citations,
            "status": "success",
            "raw_response": raw_response,
            "metadata": {
                "model": model,
                "latency_ms": latency_ms,
                "usage": raw_response.get('usage', {})
            }
        }
    except Exception as e:
        logger.error(f"OpenAI error: {e!s}")
        return provider_error_result(Provider.OPENAI, model, e, start_time)


def query_perplexity(keyword: str, api_key: str, query_template: str | None = None) -> dict[str, Any]:
    """Query Perplexity API."""
    start_time = time.time()
    try:
        client = PerplexityClient(api_key)
        query = build_provider_query(keyword, query_template)
        messages = [{"role": "user", "content": query}]
        raw_response = client.chat_completion(messages)

        latency_ms = int((time.time() - start_time) * 1000)

        response_text = raw_response['choices'][0]['message']['content']

        # Extract citations from search_results field (new format)
        citations = []
        search_results = raw_response.get('search_results', [])
        if search_results:
            citations = [clean_url(result.get('url')) for result in search_results if result.get('url')]

        # Fallback to old citations field if search_results is empty
        if not citations:
            citations = [clean_url(url) for url in raw_response.get('citations', [])]

        # Last resort: extract from response text
        if not citations:
            citations = extract_citations_from_response(response_text)

        return {
            "provider": Provider.PERPLEXITY,
            "response": response_text,
            "citations": citations,
            "status": "success",
            "raw_response": raw_response,
            "metadata": {
                "model": raw_response.get('model', 'sonar'),
                "latency_ms": latency_ms,
                "usage": raw_response.get('usage', {})
            }
        }
    except Exception as e:
        logger.error(f"Perplexity error: {e!s}")
        return provider_error_result(Provider.PERPLEXITY, "sonar", e, start_time)


# Hosts permitted to start a redirect chain. Gemini returns citation links
# wrapped in its own redirector, and the real domain can only be recovered by
# following the wrapper — so this un-wrapping has to keep working. Restricting
# the entry point means an arbitrary URL from a provider response cannot be
# turned into a server-side redirect chase.
GEMINI_REDIRECT_HOSTS = frozenset({'vertexaisearch.cloud.google.com'})


def resolve_gemini_redirect(redirect_url: str, timeout: int = 5) -> str:
    """
    Resolve Gemini's vertex redirect URL to get the real URL.
    Gemini returns vertexaisearch.cloud.google.com redirect links that need to be followed.

    Behaviour is unchanged for real Gemini wrappers. What changed is how the
    chain is followed: `allow_redirects=True` on unvalidated input let a
    provider-supplied URL send this HEAD request anywhere, using it as a blind
    probe of whatever the Lambda can reach (AUDIT-2026-08-19 §2.6). Now only
    Gemini's own redirector may start a chain, and every hop is revalidated.

    Returns the original URL unchanged on any failure or refusal, which is the
    pre-existing fallback contract — a citation that cannot be un-wrapped is
    better than no citation.
    """
    if not host_matches(redirect_url, GEMINI_REDIRECT_HOSTS):
        # Not a Gemini wrapper, so there is nothing to un-wrap. Returning it
        # untouched avoids making this a general-purpose redirect follower.
        return redirect_url

    _response, final_url, fetch_error = fetch_following_validated_redirects(
        redirect_url, method='HEAD', timeout=timeout
    )

    if fetch_error or not final_url:
        logger.warning(
            f"Failed to resolve Gemini redirect {redirect_url[:50]}...: {fetch_error}"
        )
        return redirect_url

    logger.info(f"Resolved Gemini redirect: {redirect_url[:50]}... -> {final_url}")
    return final_url


def query_gemini(keyword: str, api_key: str, query_template: str | None = None) -> dict[str, Any]:
    """Query Gemini API with Google Search."""
    start_time = time.time()
    try:
        client = GeminiClient(api_key)
        query = build_provider_query(keyword, query_template)
        raw_response = client.generate_content(query)

        latency_ms = int((time.time() - start_time) * 1000)

        # Extract text from Gemini response
        response_text = ""
        citations = []

        if 'candidates' in raw_response and len(raw_response['candidates']) > 0:
            candidate = raw_response['candidates'][0]
            if 'content' in candidate and 'parts' in candidate['content']:
                parts = candidate['content']['parts']
                response_text = ' '.join([part.get('text', '') for part in parts])

            # Extract citations from grounding metadata and resolve redirects
            if 'groundingMetadata' in candidate:
                grounding = candidate['groundingMetadata']
                if 'groundingChunks' in grounding:
                    for chunk in grounding['groundingChunks']:
                        if 'web' in chunk:
                            redirect_url = chunk['web'].get('uri')
                            if redirect_url:
                                # Resolve the vertex redirect to get the real URL, then clean it
                                real_url = resolve_gemini_redirect(redirect_url)
                                cleaned_url = clean_url(real_url)
                                if cleaned_url and cleaned_url not in citations:
                                    citations.append(cleaned_url)
                # Also check webSearchQueries if available
                if 'webSearchQueries' in grounding:
                    logger.info(f"Gemini search queries: {grounding['webSearchQueries']}")

        # Also extract any URLs from the text itself
        text_citations = extract_citations_from_response(response_text)
        for citation in text_citations:
            if citation not in citations:
                citations.append(citation)

        return {
            "provider": Provider.GEMINI,
            "response": response_text,
            "citations": citations,
            "status": "success",
            "raw_response": raw_response,
            "metadata": {
                "model": "gemini-3-flash-preview",
                "latency_ms": latency_ms,
                "usage": raw_response.get('usageMetadata', {})
            }
        }
    except Exception as e:
        logger.error(f"Gemini error: {e!s}")
        return provider_error_result(Provider.GEMINI, "gemini-3-flash-preview", e, start_time)


def query_claude(keyword: str, api_key: str, query_template: str | None = None) -> dict[str, Any]:
    """Query Claude API with web search."""
    start_time = time.time()
    try:
        client = ClaudeClient(api_key)
        query = build_provider_query(keyword, query_template)
        raw_response = client.generate_content(
            query, system_prompt=CLAUDE_CITATION_SYSTEM_PROMPT
        )

        latency_ms = int((time.time() - start_time) * 1000)

        # Log the full response structure for debugging
        logger.info(f"Claude raw response structure: {json.dumps(raw_response, default=str)[:1000]}")

        # Extract text and citations from Claude response
        response_text = ""
        citations = []

        if 'content' in raw_response and len(raw_response['content']) > 0:
            for content_block in raw_response['content']:
                block_type = content_block.get('type')
                logger.debug(f"Claude content block type: {block_type}")

                if block_type == 'text':
                    response_text += content_block.get('text', '')
                # Extract citations from tool_use blocks (Claude's web search)
                elif block_type == 'tool_use':
                    tool_name = content_block.get('name')
                    tool_input = content_block.get('input', {})
                    logger.debug(f"Claude tool_use: {tool_name}, input: {tool_input}")
                # Handle server_tool_use - Claude's internal tool invocation for web search
                elif block_type == 'server_tool_use':
                    tool_name = content_block.get('name')
                    tool_input = content_block.get('input', {})
                    logger.debug(f"Claude server_tool_use: {tool_name}, input: {tool_input}")
                    # Extract query if present (useful for debugging)
                    if tool_input and 'query' in tool_input:
                        logger.debug(f"Claude web search query: {tool_input['query']}")
                # Handle web_search_tool_result - contains actual search results with URLs
                elif block_type == 'web_search_tool_result':
                    search_results = content_block.get('content', [])
                    for result in search_results:
                        if result.get('type') == 'web_search_result':
                            url = result.get('url')
                            if url and url not in citations:
                                citations.append(clean_url(url))
                                logger.debug(f"Claude web search result URL: {url}")
                # Log any truly unknown block types at info level
                else:
                    logger.info(f"Claude unhandled block type '{block_type}': {json.dumps(content_block, default=str)[:300]}")

        # Extract any URLs from the text itself (primary method for Claude)
        text_citations = extract_citations_from_response(response_text)
        for citation in text_citations:
            if citation not in citations:
                citations.append(citation)

        logger.info(f"Claude extracted {len(citations)} citations from text for '{keyword}'")

        return {
            "provider": Provider.CLAUDE,
            "response": response_text,
            "citations": citations,
            "status": "success",
            "raw_response": raw_response,
            "metadata": {
                "model": raw_response.get('model', 'claude-sonnet-4-5'),
                "latency_ms": latency_ms,
                "usage": raw_response.get('usage', {})
            }
        }
    except Exception as e:
        logger.error(f"Claude error: {e!s}")
        return provider_error_result(Provider.CLAUDE, "claude-sonnet-4-5", e, start_time)


def _run_openai_provider(keyword: str, api_key: str, query_template: str | None) -> dict[str, Any]:
    """OpenAI is the one provider with a configurable model (fail-closed)."""
    model = get_provider_model(Provider.OPENAI)
    return query_openai(keyword, api_key, model=model, query_template=query_template)


def _run_perplexity_provider(keyword: str, api_key: str, query_template: str | None) -> dict[str, Any]:
    return query_perplexity(keyword, api_key, query_template=query_template)


def _run_gemini_provider(keyword: str, api_key: str, query_template: str | None) -> dict[str, Any]:
    return query_gemini(keyword, api_key, query_template=query_template)


def _run_claude_provider(keyword: str, api_key: str, query_template: str | None) -> dict[str, Any]:
    """Claude gets the same query as everyone else.

    The "include source URLs" instruction moved into Claude's system prompt
    (`CLAUDE_CITATION_SYSTEM_PROMPT`); it used to be concatenated onto the
    keyword here, which made Claude's query differ from the other providers'
    and corrupted persona templates by injecting the instruction at the
    `{keyword}` position.
    """
    return query_claude(keyword, api_key, query_template=query_template)


def _search_provider_runner(client_class: type) -> Callable[[str, str, str | None], dict[str, Any]]:
    """Search providers share one shape: build the client, search the keyword."""
    def run(keyword: str, api_key: str, query_template: str | None) -> dict[str, Any]:
        return client_class(api_key).search(keyword)
    return run


# Provider execution registry: (provider_id, secret name, log label,
# provider type, runner). Replaces the nine copy-pasted
# enabled/disabled/no-key ladders (bugs.md 3.2); execution order is
# unchanged.
PROVIDER_RUNNERS: list[tuple[str, str, str, str, Callable[[str, str, str | None], dict[str, Any]]]] = [
    (Provider.OPENAI, 'openai-key', 'OpenAI', 'llm', _run_openai_provider),
    (Provider.PERPLEXITY, 'perplexity-key', 'Perplexity', 'llm', _run_perplexity_provider),
    (Provider.GEMINI, 'gemini-key', 'Gemini', 'llm', _run_gemini_provider),
    (Provider.CLAUDE, 'claude-key', 'Claude', 'llm', _run_claude_provider),
    (Provider.BRAVE, 'brave-key', 'Brave Search', 'search', _search_provider_runner(BraveSearchClient)),
    (Provider.TAVILY, 'tavily-key', 'Tavily', 'search', _search_provider_runner(TavilySearchClient)),
    (Provider.EXA, 'exa-key', 'Exa', 'search', _search_provider_runner(ExaSearchClient)),
    (Provider.SERPAPI, 'serpapi-key', 'SerpAPI', 'search', _search_provider_runner(SerpAPIClient)),
    (Provider.FIRECRAWL, 'firecrawl-key', 'Firecrawl', 'search', _search_provider_runner(FirecrawlSearchClient)),
]


def _record_provider_outcome(provider_id: str, result: dict[str, Any]) -> None:
    """Persist provider health, and tag the result with the error category.

    Two separate jobs, both needed:

    1. The provider row gets `last_error`, `last_error_category`,
       `consecutive_failures` and friends, so Settings can say "No credit
       remaining" instead of showing a green tick. After three consecutive
       terminal failures (no credit / rejected key) the provider is
       auto-disabled, which is what stops a dead provider burning five retry
       attempts per query on every future run.
    2. `error_category` is written onto the result row so it survives into the
       deduplication rollup and out to the execution summary. Without it the
       summary sees `citations: 0` and cannot tell a broken provider from an
       unproductive search.

    Never raises: a health-bookkeeping failure must not take down a search that
    otherwise succeeded, and `record_provider_*` already swallow their own
    DynamoDB errors.
    """
    table = dynamodb.Table(PROVIDER_CONFIG_TABLE)

    if result.get('status') == 'error':
        outcome = record_provider_failure(
            table, provider_id, result.get('error', 'unknown provider error')
        )
        result['error_category'] = outcome['category']
        if outcome['auto_disabled']:
            result['provider_auto_disabled'] = True
        return

    record_provider_success(table, provider_id)


def execute_all_providers(keyword: str, provider_types: list[str] | None = None, providers: list[str] | None = None, query_template: str | None = None) -> list[dict[str, Any]]:
    """
    Execute queries across AI providers.

    Args:
        keyword: Search keyword
        provider_types: Optional list of provider types to run ("llm", "search", or both).
                       If None, runs all types.
        providers: Optional list of specific provider IDs to run.
                  If None, runs all enabled providers of the specified types.
        query_template: Optional query template with {keyword} placeholder.
                       If None, each provider uses its default query format.
    """
    results = []

    # Determine which types to run
    run_types = set()
    if provider_types is None or "llm" in provider_types:
        run_types.add("llm")
    if provider_types is None or "search" in provider_types:
        run_types.add("search")

    def should_run_provider(provider_id: str) -> bool:
        if providers is not None:
            return provider_id in providers
        return True

    for provider_id, secret_name, label, provider_type, run_query in PROVIDER_RUNNERS:
        if provider_type not in run_types:
            continue

        # Same decision ladder every provider block used to carry:
        # key + enabled + selected -> run; key + selected -> disabled;
        # selected -> no key configured.
        api_key = get_api_key(secret_name)
        if api_key and is_provider_enabled(provider_id) and should_run_provider(provider_id):
            logger.info(f"Querying {label}...")
            try:
                result = run_query(keyword, api_key, query_template)
                _record_provider_outcome(provider_id, result)
                results.append(result)
            except ProviderConfigUnavailableError:
                logger.error(f"{label} provider config unavailable, skipping this run")
        elif api_key and should_run_provider(provider_id):
            logger.info(f"{label} is disabled, skipping")
        elif should_run_provider(provider_id):
            logger.info(f"{label} API key not configured, skipping")

    return results


def store_search_results(keyword: str, timestamp: str, results: list[dict[str, Any]]) -> bool:
    """Store search results in DynamoDB and raw responses to S3."""
    if not DYNAMODB_TABLE_SEARCH_RESULTS:
        logger.error("DYNAMODB_TABLE_SEARCH_RESULTS not set")
        return False

    try:
        table = dynamodb.Table(DYNAMODB_TABLE_SEARCH_RESULTS)

        # Load extraction config
        extraction_config = get_extraction_config()
        brand_extraction_enabled = extraction_config.get("brand_extraction", {}).get("enabled", True)
        # Load brand config once upfront and reuse for all providers (avoids repeated DynamoDB reads)
        brand_config = None
        if brand_extraction_enabled:
            brand_config = get_brand_config()
            logger.info(f"Loaded brand config for extraction: industry={brand_config.get('industry') if brand_config else 'default'}")

        for result in results:
            provider = result.get("provider")
            provider_type = result.get("provider_type", "llm")  # Default to llm for backward compatibility
            query_prompt_id = result.get("query_prompt_id", "default")
            query_prompt_name = result.get("query_prompt_name", "Default")
            timestamp_provider = f"{timestamp}#{provider}#{query_prompt_id}"
            response_text = result.get("response", "")

            # Extract brand mentions from response if enabled (only for LLM providers with text responses)
            brand_data = {"brands": [], "brand_count": 0}
            if brand_extraction_enabled and response_text and provider_type == "llm":
                try:
                    logger.info(f"Starting brand extraction for {provider} (response length: {len(response_text)} chars)")
                    brand_data = extract_brands_from_response(response_text, config=brand_config)
                    logger.info(f"Brand extraction for {provider}: {brand_data.get('brand_count', 0)} brands found")
                except Exception as e:
                    logger.error(f"Brand extraction failed for {provider}: {e!s}", exc_info=True)

            # Store raw response to S3
            raw_response = result.get("raw_response")
            metadata = result.get("metadata", {})
            s3_uri = None

            if raw_response:
                extracted_data = {
                    "response_text": response_text,
                    "citations": result.get("citations", []),
                    "brands": brand_data.get("brands", []),
                    "search_results": result.get("search_results", [])  # For search providers
                }
                s3_uri = store_raw_response_to_s3(
                    keyword=keyword,
                    provider=provider,
                    timestamp=timestamp,
                    raw_response=raw_response,
                    extracted_data=extracted_data,
                    metadata=metadata
                )

            item = {
                "keyword": keyword,
                "timestamp_provider": timestamp_provider,
                "timestamp": timestamp,
                "provider": provider,
                "provider_type": provider_type,
                "query_prompt_id": query_prompt_id,
                "query_prompt_name": query_prompt_name,
                "response": response_text,
                "citations": result.get("citations", []),
                "status": result.get("status", "unknown"),
                "brands": brand_data.get("brands", []),
                "brand_count": brand_data.get("brand_count", 0),
            }

            # Add search results for search providers (convert floats to Decimal for DynamoDB)
            if provider_type == "search" and result.get("search_results"):
                item["search_results"] = convert_floats_to_decimal(result.get("search_results", []))

            # Add S3 URI if raw response was stored
            if s3_uri:
                item["raw_response_s3_uri"] = s3_uri

            # Add metadata (convert floats to Decimal for DynamoDB)
            if metadata:
                item["metadata"] = convert_floats_to_decimal(metadata)

            if "error" in result:
                item["error"] = result["error"]

            table.put_item(Item=item)
            logger.info(f"Stored result for {provider} ({provider_type}) with {item['brand_count']} brand mentions, S3: {s3_uri or 'N/A'}")

        return True
    except Exception as e:
        logger.error(f"Error storing results: {e!s}")
        return False


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for searching across AI providers.

    Input:
    {
        "keyword": "best hotels in malaga",
        "timestamp": "2025-01-15T10:30:00Z",
        "query_prompts": [{"id": "...", "name": "Family", "template": "As a family traveler, find me {keyword}"}],
        "provider_types": ["search"],  // Optional: "llm", "search", or both
        "providers": ["brave", "tavily"]  // Optional: specific provider IDs
    }

    Output:
    {
        "keyword": "best hotels in malaga",
        "timestamp": "2025-01-15T10:30:00Z",
        "results": [...]
    }
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        # Extract keyword and timestamp
        keyword_raw = event.get('keyword')
        timestamp = event.get('timestamp', get_timestamp())
        provider_types = event.get('provider_types')  # Optional: ["llm"], ["search"], or ["llm", "search"]
        providers = event.get('providers')  # Optional: specific provider IDs
        query_prompts = event.get('query_prompts', [])

        if not keyword_raw:
            error = ValueError("Missing required field: keyword")
            log_error(error, "search handler", event)
            raise error

        # Sanitize the keyword before it lands in any provider query string.
        # Keywords are dashboard-editable (see api/manage-keywords) so treated
        # as untrusted input. The brand extractor downstream wraps the full
        # provider response in <response_text> tags — this is defense in depth
        # so a crafted keyword can't poison the query itself.
        keyword = sanitize_user_input(keyword_raw, max_length=MAX_KEYWORD_LENGTH)
        if not keyword:
            error = ValueError("Keyword is empty after sanitization")
            log_error(error, "search handler", event)
            raise error

        # If no query prompts, use a single default (backward compatible)
        if not query_prompts:
            query_prompts = [{"id": "default", "name": "Default", "template": None}]

        logger.info(f"Processing keyword: {keyword}, prompts: {len(query_prompts)}, provider_types: {provider_types}")

        all_results = []
        for prompt in query_prompts:
            prompt_id = prompt.get('id', 'default')
            prompt_name = prompt.get('name', 'Default')
            prompt_template = prompt.get('template')

            logger.info(f"Running prompt '{prompt_name}' for keyword '{keyword}'")

            try:
                # Execute queries across providers with this prompt template
                results = execute_all_providers(
                    keyword,
                    provider_types=provider_types,
                    providers=providers,
                    query_template=prompt_template,
                )

                # Tag each result with the query prompt info
                for result in results:
                    result['query_prompt_id'] = prompt_id
                    result['query_prompt_name'] = prompt_name

                all_results.extend(results)
            except Exception as prompt_error:
                logger.error(f"Error running prompt '{prompt_name}' for '{keyword}': {prompt_error}")
                # Continue with remaining prompts

        # Store results in DynamoDB
        store_success = store_search_results(keyword, timestamp, all_results)

        if not store_success:
            logger.warning("Failed to store some results in DynamoDB")

        # Strip large fields from results before returning to Step Functions
        # (raw_response is already stored to S3, search_results stored to DynamoDB)
        # This prevents States.DataLimitExceeded errors (256KB limit)
        slim_results = []
        for result in all_results:
            slim_result = {
                "provider": result.get("provider"),
                "provider_type": result.get("provider_type", "llm"),
                "status": result.get("status"),
                "citation_count": len(result.get("citations", [])),
                "citations": result.get("citations", []),  # Keep citations for deduplication
                "query_prompt_id": result.get("query_prompt_id", "default"),
            }
            if "error" in result:
                slim_result["error"] = result["error"]
            slim_results.append(slim_result)

        # Return slim results
        return {
            "keyword": keyword,
            "timestamp": timestamp,
            "provider_types": provider_types,
            "providers": providers,
            "results": slim_results,
            "stored": store_success
        }

    except Exception as e:
        # !r so a keyword with interior newlines can't forge log records; this
        # path logs the PRE-sanitization keyword straight from the event.
        log_error(e, f"search handler for keyword {event.get('keyword', 'unknown')!r}", event)
        raise
