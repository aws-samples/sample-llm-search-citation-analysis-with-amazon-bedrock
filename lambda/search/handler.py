"""
Search Lambda Function - Lightweight Version
Queries multiple AI providers using direct HTTP API calls (no heavy SDKs).
"""

import json
import logging
import os
import re
import time
from collections.abc import Callable, Iterable
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
from brand_extractor import DEFAULT_EXTRACTION_CONFIG, extract_brands_from_response
from search_clients import BraveSearchClient, ExaSearchClient, FirecrawlSearchClient, SerpAPIClient, TavilySearchClient

# Import centralized provider constants and error handling
from shared.ai_clients import perplexity_agent_text
from shared.config import Provider
from shared.constants import MAX_KEYWORD_LENGTH
from shared.dynamo_decimal import convert_floats_to_decimal
from shared.markets import GLOBAL_MARKET_ID, Market, brand_config_for_market, market_from_payload
from shared.prompt_safety import sanitize_user_input
from shared.provider_health import record_provider_failure, record_provider_success
from shared.provider_models import DEFAULT_PROVIDER_MODELS, ProviderConfigUnavailableError, read_provider_model
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
            with open(config_path, encoding='utf-8') as f:
                _extraction_config = json.load(f)
            logger.info("Loaded extraction config")
        except (OSError, json.JSONDecodeError) as e:
            logger.warning('Failed to load extraction config: %s, using defaults', e)
            _extraction_config = {"hotel_extraction": {"enabled": True, "config": {}}}
    return _extraction_config

# Environment variables
DYNAMODB_TABLE_SEARCH_RESULTS = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
RAW_RESPONSES_BUCKET = os.environ['RAW_RESPONSES_BUCKET']
# Provider config table. Default mirrors the CDK resource name so a bootstrap
# deploy works even before env vars flow through. Audit #12.
PROVIDER_CONFIG_TABLE = (
    os.environ.get('DYNAMODB_TABLE_PROVIDER_CONFIG')
    or 'CitationAnalysis-ProviderConfig'
)


def slugify(text: str) -> str:
    """Convert text to URL-safe slug for S3 keys."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '-', text)
    return text[:100]  # Limit length


def raw_response_s3_key(keyword: str, provider: str, query_prompt_id: str, timestamp: str) -> str:
    """``raw-responses/{date}/{keyword-slug}/{provider}/{query_prompt_id}/{timestamp}.json``.

    The query prompt is part of the key: every persona of one keyword and
    provider shares the run timestamp, so without it each persona's answer
    overwrote the one before.
    """
    date_str = timestamp[:10]  # YYYY-MM-DD
    prompt_slug = slugify(query_prompt_id) or 'default'
    # Make timestamp safe for S3 key (replace : with -)
    safe_timestamp = timestamp.replace(':', '-')
    return f"raw-responses/{date_str}/{slugify(keyword)}/{provider}/{prompt_slug}/{safe_timestamp}.json"


def store_raw_response_to_s3(
    keyword: str,
    provider: str,
    timestamp: str,
    raw_response: dict[str, Any],
    extracted_data: dict[str, Any],
    metadata: dict[str, Any],
    *,
    query_prompt_id: str = 'default',
    market_id: str = GLOBAL_MARKET_ID,
) -> str | None:
    """
    Store raw API response to S3 (key: ``raw_response_s3_key``).

    Returns S3 URI if successful, None otherwise.
    """
    try:
        s3_key = raw_response_s3_key(keyword, provider, query_prompt_id, timestamp)

        # Build the full document
        document = {
            "keyword": keyword,
            "provider": provider,
            "timestamp": timestamp,
            "query_prompt_id": query_prompt_id,
            "market_id": market_id,
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
    except Exception:
        logger.exception("Failed to store raw response to S3")
        return None

    s3_uri = f"s3://{RAW_RESPONSES_BUCKET}/{s3_key}"
    logger.info('Stored raw response to %s', s3_uri)
    return s3_uri


def is_provider_enabled(provider_id: str) -> bool:
    """Check if a provider is enabled in the config table.

    Fails closed: if the config table is unavailable, return False so we do
    not accidentally invoke a provider the user has disabled. A transient
    DynamoDB failure should not override user intent.
    """
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        item = table.get_item(Key={'provider_id': provider_id}).get('Item')
    except Exception as e:
        # The message line carries the error type only; str(e) can name
        # tables or ARNs, so it stays in the traceback.
        logger.exception(
            "provider_config_read_failed provider=%s error=%s action=fail_closed",
            provider_id,
            type(e).__name__,
        )
        return False
    if item:
        return bool(item.get('enabled', True))
    # No config row yet -> treat as enabled (first-run default)
    return True

# Cache for provider models, cleared at the start of every invocation. It used
# to live for the whole warm container, so a model changed in Settings reached
# a warm Lambda only after its next cold start.
_provider_model_cache: dict[str, str] = {}


def get_provider_model(provider_id: str) -> str:
    """The model this invocation uses for ``provider_id``.

    Reads the administrator's override from the ProviderConfig row
    (``shared.provider_models``), falling back to the provider's default.
    Fails closed: raises ``ProviderConfigUnavailableError`` on DynamoDB
    errors so the caller skips the provider rather than silently running a
    different model than the admin configured.
    """
    if provider_id not in _provider_model_cache:
        model = read_provider_model(dynamodb.Table(PROVIDER_CONFIG_TABLE), provider_id)
        _provider_model_cache[provider_id] = model
        logger.info('Provider %s using model: %s', provider_id, model)
    return _provider_model_cache[provider_id]



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


ProviderResult = dict[str, Any]
"""One provider's answer to one query: ``provider``, ``response``, ``citations``, ``status``, ``metadata``, ..."""


def provider_error_result(provider: str, model: str, error: Exception, start_time: float) -> ProviderResult:
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


def _merge_citations(citations: list[str], extra: Iterable[str]) -> list[str]:
    """Append the URLs in ``extra`` that ``citations`` does not already hold, keeping order."""
    for citation in extra:
        if citation not in citations:
            citations.append(citation)
    return citations


def _query_llm(
    provider: str,
    keyword: str,
    query_template: str | None,
    request: Callable[[str], dict[str, Any]],
    parse: Callable[[dict[str, Any]], tuple[str, list[str]]],
    *,
    model: str,
    usage_key: str = 'usage',
    model_from_response: bool = False,
    extra_metadata: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The request/parse/error flow every LLM provider shares.

    ``request`` sends the resolved query and returns the raw payload; ``parse``
    reads ``(response_text, citations)`` out of it. A failure anywhere in that
    flow becomes the uniform error result rather than an exception, so one dead
    provider cannot take the keyword down and ``_record_provider_outcome`` can
    classify what went wrong. ``model`` labels the metadata (and the error
    result); with ``model_from_response`` the payload's own ``model`` wins.
    ``extra_metadata`` adds provider-specific fields read from the payload.
    """
    start_time = time.time()
    try:
        raw_response = request(build_provider_query(keyword, query_template))
        latency_ms = int((time.time() - start_time) * 1000)
        response_text, citations = parse(raw_response)
    except Exception as e:
        logger.exception('%s error', provider)
        return provider_error_result(provider, model, e, start_time)

    logger.info("%s found %s citations for '%s'", provider, len(citations), keyword)
    return {
        "provider": provider,
        "response": response_text,
        "citations": citations,
        "status": "success",
        "raw_response": raw_response,
        "metadata": {
            "model": raw_response.get('model', model) if model_from_response else model,
            "latency_ms": latency_ms,
            "usage": raw_response.get(usage_key, {}),
            **(extra_metadata(raw_response) if extra_metadata else {}),
        }
    }


def _openai_message_content(item: dict[str, Any]) -> tuple[str, list[str]]:
    """Text and ``url_citation`` annotations of one Responses API ``message`` item."""
    text = ""
    citations: list[str] = []
    for content_item in item.get('content', []):
        if content_item.get('type') != 'output_text':
            continue
        text += content_item.get('text', '')
        citations.extend(
            clean_url(annotation['url'])
            for annotation in content_item.get('annotations', [])
            if annotation.get('type') == 'url_citation' and annotation.get('url')
        )
    return text, citations


def _parse_openai_response(raw_response: dict[str, Any]) -> tuple[str, list[str]]:
    """Message text plus the URLs cited in annotations and web-search sources, deduplicated in order."""
    response_text = ""
    citations: list[str] = []
    for item in raw_response.get('output', []):
        if item.get('type') == 'message':
            text, urls = _openai_message_content(item)
            response_text += text
            citations.extend(urls)
        elif item.get('type') == 'web_search_call':
            sources = item.get('action', {}).get('sources', [])
            citations.extend(clean_url(source['url']) for source in sources if source.get('url'))
    # Fallback: extract from output_text if available
    return response_text or raw_response.get('output_text', ''), list(dict.fromkeys(citations))


def query_openai(
    keyword: str, api_key: str, model: str = DEFAULT_PROVIDER_MODELS[Provider.OPENAI], query_template: str | None = None,
    market: Market | None = None,
) -> ProviderResult:
    """Query OpenAI API with native web search via Responses API."""
    def request(query: str) -> dict[str, Any]:
        return OpenAIClient(api_key).responses_with_web_search(query=query, model=model, market=market)

    return _query_llm(Provider.OPENAI, keyword, query_template, request, _parse_openai_response, model=model)


def _perplexity_cited_urls(raw_response: dict[str, Any]) -> list[str]:
    """The ``search_results`` hit URLs, then any message annotation URLs, of an Agent API response."""
    urls: list[str] = []
    for item in raw_response.get('output') or []:
        if not isinstance(item, dict):
            continue
        if item.get('type') == 'search_results':
            urls.extend(result['url'] for result in item.get('results') or [] if isinstance(result, dict) and result.get('url'))
        elif item.get('type') == 'message':
            urls.extend(
                annotation['url']
                for part in item.get('content') or [] if isinstance(part, dict)
                for annotation in part.get('annotations') or [] if isinstance(annotation, dict) and annotation.get('url')
            )
    return urls


def _parse_perplexity_response(raw_response: dict[str, Any]) -> tuple[str, list[str]]:
    """Agent API answer text plus the searched and annotated URLs (deduplicated in order), else the text's URLs."""
    response_text = perplexity_agent_text(raw_response)
    citations = list(dict.fromkeys(clean_url(url) for url in _perplexity_cited_urls(raw_response)))
    if not citations:
        citations = extract_citations_from_response(response_text)
    return response_text, citations


def _perplexity_cost(raw_response: dict[str, Any]) -> dict[str, Any]:
    """``cost_usd``: the call's total price as Perplexity reports it (``usage.cost.total_cost``), when present."""
    cost = ((raw_response.get('usage') or {}).get('cost') or {}).get('total_cost')
    return {'cost_usd': cost} if isinstance(cost, int | float) and not isinstance(cost, bool) else {}


def query_perplexity(
    keyword: str, api_key: str, model: str = DEFAULT_PROVIDER_MODELS[Provider.PERPLEXITY], query_template: str | None = None,
    market: Market | None = None,
) -> ProviderResult:
    """Query Perplexity's Agent API with web search."""
    def request(query: str) -> dict[str, Any]:
        return PerplexityClient(api_key, model=model).agent_response(query, market=market)

    return _query_llm(
        Provider.PERPLEXITY, keyword, query_template, request, _parse_perplexity_response,
        model=model, model_from_response=True, extra_metadata=_perplexity_cost,
    )


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
            'Failed to resolve Gemini redirect %s...: %s', redirect_url[:50], fetch_error
        )
        return redirect_url

    logger.info('Resolved Gemini redirect: %s... -> %s', redirect_url[:50], final_url)
    return final_url


def _gemini_grounding_citations(grounding: dict[str, Any]) -> list[str]:
    """Real URLs behind the grounding chunks' redirect wrappers, deduplicated in order."""
    citations: list[str] = []
    for chunk in grounding.get('groundingChunks', []):
        redirect_url = chunk['web'].get('uri') if 'web' in chunk else None
        if not redirect_url:
            continue
        # Resolve the vertex redirect to get the real URL, then clean it
        cleaned_url = clean_url(resolve_gemini_redirect(redirect_url))
        if cleaned_url and cleaned_url not in citations:
            citations.append(cleaned_url)
    # Also check webSearchQueries if available
    if 'webSearchQueries' in grounding:
        logger.info('Gemini search queries: %s', grounding['webSearchQueries'])
    return citations


def _parse_gemini_response(raw_response: dict[str, Any]) -> tuple[str, list[str]]:
    """First candidate's text and grounding citations, plus any URLs in the text itself."""
    response_text = ""
    citations: list[str] = []
    candidates = raw_response.get('candidates', [])
    if candidates:
        candidate = candidates[0]
        if 'content' in candidate and 'parts' in candidate['content']:
            response_text = ' '.join([part.get('text', '') for part in candidate['content']['parts']])
        if 'groundingMetadata' in candidate:
            citations = _gemini_grounding_citations(candidate['groundingMetadata'])
    return response_text, _merge_citations(citations, extract_citations_from_response(response_text))


def query_gemini(
    keyword: str, api_key: str, model: str = DEFAULT_PROVIDER_MODELS[Provider.GEMINI], query_template: str | None = None,
    market: Market | None = None,
) -> ProviderResult:
    """Query Gemini API with Google Search grounding, using ``model``."""
    def request(query: str) -> dict[str, Any]:
        return GeminiClient(api_key, model=model).generate_content(query, market=market)

    return _query_llm(
        Provider.GEMINI, keyword, query_template, request, _parse_gemini_response,
        model=model, usage_key='usageMetadata',
    )


def _log_claude_tool_block(block_type: str | None, content_block: dict[str, Any]) -> None:
    """Debug-log Claude's tool invocations; info-log block types this parser does not know."""
    if block_type in ('tool_use', 'server_tool_use'):
        tool_input = content_block.get('input', {})
        logger.debug('Claude %s: %s, input: %s', block_type, content_block.get('name'), tool_input)
        # Extract query if present (useful for debugging)
        if block_type == 'server_tool_use' and tool_input and 'query' in tool_input:
            logger.debug('Claude web search query: %s', tool_input['query'])
    else:
        logger.info("Claude unhandled block type '%s': %s", block_type, json.dumps(content_block, default=str)[:300])


def _claude_search_result_urls(content_block: dict[str, Any], citations: list[str]) -> None:
    """Append the URLs of a ``web_search_tool_result`` block that are not listed yet.

    A failed search carries an error object (``{"error_code": ...}``)
    instead of the result list; it adds nothing.
    """
    results = content_block.get('content')
    if not isinstance(results, list):
        logger.warning('Claude web search result without results: %s', json.dumps(results, default=str)[:200])
        return
    for result in results:
        url = result.get('url') if isinstance(result, dict) and result.get('type') == 'web_search_result' else None
        if url:
            _merge_citations(citations, [clean_url(url)])
            logger.debug('Claude web search result URL: %s', url)


def _claude_text_citation_urls(content_block: dict[str, Any]) -> list[str]:
    """The cleaned URLs a text block cites (``citations[].url``, ``web_search_result_location``)."""
    return [
        clean_url(citation['url'])
        for citation in content_block.get('citations') or []
        if isinstance(citation, dict) and citation.get('url')
    ]


def _parse_claude_response(raw_response: dict[str, Any]) -> tuple[str, list[str]]:
    """Text blocks, their cited URLs and the web-search result URLs, plus any URLs in the text itself."""
    # Log the full response structure for debugging
    logger.info('Claude raw response structure: %s', json.dumps(raw_response, default=str)[:1000])
    response_text = ""
    citations: list[str] = []
    for content_block in raw_response.get('content', []):
        block_type = content_block.get('type')
        logger.debug('Claude content block type: %s', block_type)
        if block_type == 'text':
            response_text += content_block.get('text', '')
            _merge_citations(citations, _claude_text_citation_urls(content_block))
        elif block_type == 'web_search_tool_result':
            _claude_search_result_urls(content_block, citations)
        else:
            _log_claude_tool_block(block_type, content_block)
    return response_text, _merge_citations(citations, extract_citations_from_response(response_text))


def query_claude(
    keyword: str, api_key: str, model: str = DEFAULT_PROVIDER_MODELS[Provider.CLAUDE], query_template: str | None = None,
    market: Market | None = None,
) -> ProviderResult:
    """Query Claude API with web search."""
    def request(query: str) -> dict[str, Any]:
        return ClaudeClient(api_key, model=model).generate_content(
            query, system_prompt=CLAUDE_CITATION_SYSTEM_PROMPT, market=market,
        )

    return _query_llm(
        Provider.CLAUDE, keyword, query_template, request, _parse_claude_response,
        model=model, model_from_response=True,
    )


def _run_openai_provider(keyword: str, api_key: str, query_template: str | None, market: Market | None) -> dict[str, Any]:
    """OpenAI answers with the model configured in Settings (fail-closed)."""
    model = get_provider_model(Provider.OPENAI)
    return query_openai(keyword, api_key, model=model, query_template=query_template, market=market)


def _run_perplexity_provider(keyword: str, api_key: str, query_template: str | None, market: Market | None) -> dict[str, Any]:
    """Perplexity answers with the model configured in Settings (fail-closed)."""
    model = get_provider_model(Provider.PERPLEXITY)
    return query_perplexity(keyword, api_key, model=model, query_template=query_template, market=market)


def _run_gemini_provider(keyword: str, api_key: str, query_template: str | None, market: Market | None) -> dict[str, Any]:
    """Gemini answers with the model configured in Settings (fail-closed)."""
    model = get_provider_model(Provider.GEMINI)
    return query_gemini(keyword, api_key, model=model, query_template=query_template, market=market)


def _run_claude_provider(keyword: str, api_key: str, query_template: str | None, market: Market | None) -> dict[str, Any]:
    """Claude answers with the model configured in Settings (fail-closed), to the same query as everyone else.

    The "include source URLs" instruction moved into Claude's system prompt
    (`CLAUDE_CITATION_SYSTEM_PROMPT`); it used to be concatenated onto the
    keyword here, which made Claude's query differ from the other providers'
    and corrupted persona templates by injecting the instruction at the
    `{keyword}` position.
    """
    model = get_provider_model(Provider.CLAUDE)
    return query_claude(keyword, api_key, model=model, query_template=query_template, market=market)


ProviderRunner = Callable[[str, str, str | None, Market | None], ProviderResult]
"""``(keyword, api_key, query_template, market) -> result``."""


def _search_provider_runner(client_class: type) -> ProviderRunner:
    """Search providers share one shape: build the client, search the keyword (they take no template)."""
    def run(keyword: str, api_key: str, query_template: str | None, market: Market | None) -> dict[str, Any]:
        return client_class(api_key).search(keyword, market)
    return run


# Provider execution registry: (provider_id, secret name, log label,
# runner). Replaces the nine copy-pasted
# enabled/disabled/no-key ladders (bugs.md 3.2); execution order is
# unchanged.
PROVIDER_RUNNERS: list[tuple[str, str, str, ProviderRunner]] = [
    (Provider.OPENAI, 'openai-key', 'OpenAI', _run_openai_provider),
    (Provider.PERPLEXITY, 'perplexity-key', 'Perplexity', _run_perplexity_provider),
    (Provider.GEMINI, 'gemini-key', 'Gemini', _run_gemini_provider),
    (Provider.CLAUDE, 'claude-key', 'Claude', _run_claude_provider),
    (Provider.BRAVE, 'brave-key', 'Brave Search', _search_provider_runner(BraveSearchClient)),
    (Provider.TAVILY, 'tavily-key', 'Tavily', _search_provider_runner(TavilySearchClient)),
    (Provider.EXA, 'exa-key', 'Exa', _search_provider_runner(ExaSearchClient)),
    (Provider.SERPAPI, 'serpapi-key', 'SerpAPI', _search_provider_runner(SerpAPIClient)),
    (Provider.FIRECRAWL, 'firecrawl-key', 'Firecrawl', _search_provider_runner(FirecrawlSearchClient)),
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
        return

    record_provider_success(table, provider_id)


def execute_all_providers(
    keyword: str, providers: list[str], query_template: str | None = None, market: Market | None = None,
) -> list[dict[str, Any]]:
    """
    Execute queries across the selected AI and search providers.

    Args:
        keyword: Search keyword
        providers: The provider IDs to run (the analysis workflow sends one per invocation).
        query_template: Optional query template with {keyword} placeholder.
                       If None, each provider uses its default query format.
        market: The keyword's market (``None``: the global market, asked as before markets existed).
    """
    results = []

    for provider_id, secret_name, label, run_query in PROVIDER_RUNNERS:
        # Selection first: a Lambda asked for one provider reads one secret
        # and one enablement row, not all nine.
        if provider_id not in providers:
            continue
        api_key = get_api_key(secret_name)
        if not api_key:
            logger.info('%s API key not configured, skipping', label)
            continue
        if not is_provider_enabled(provider_id):
            logger.info('%s is disabled, skipping', label)
            continue

        logger.info('Querying %s...', label)
        try:
            result = run_query(keyword, api_key, query_template, market)
        except ProviderConfigUnavailableError:
            logger.exception('%s provider config unavailable, skipping this run', label)
            continue
        _record_provider_outcome(provider_id, result)
        results.append(result)

    return results


def _extraction_brand_config(market: Market | None) -> dict[str, Any] | None:
    """The brand config extraction uses (``market``'s competitors and aliases added), or ``None`` when extraction is off.

    Without a market it is the stored config as is; with one, the stored
    config (the extractor's defaults when nothing is stored) plus the
    market's extra names.
    """
    extraction_config = get_extraction_config()
    if not extraction_config.get("brand_extraction", {}).get("enabled", True):
        return None
    stored = get_brand_config()
    brand_config = brand_config_for_market(stored or DEFAULT_EXTRACTION_CONFIG, market) if market else stored
    logger.info('Loaded brand config for extraction: industry=%s', (brand_config or {}).get('industry') or 'default')
    return brand_config


def _extracted_brands(result: dict[str, Any], brand_config: dict[str, Any] | None) -> dict[str, Any]:
    """Brand mentions in an LLM result's text (none for search providers, empty answers or extraction off)."""
    provider = result.get("provider", "unknown")
    response_text = result.get("response", "")
    if brand_config is None or not response_text or result.get("provider_type", "llm") != "llm":
        return {"brands": [], "brand_count": 0}
    try:
        logger.info('Starting brand extraction for %s (response length: %s chars)', provider, len(response_text))
        brand_data = extract_brands_from_response(response_text, config=brand_config)
    except Exception:
        logger.exception('Brand extraction failed for %s', provider)
        return {"brands": [], "brand_count": 0}
    logger.info('Brand extraction for %s: %s brands found', provider, brand_data.get('brand_count', 0))
    return brand_data


def _result_item(
    keyword: str, timestamp: str, result: dict[str, Any], brand_data: dict[str, Any], market_id: str, s3_uri: str | None,
) -> dict[str, Any]:
    """The SearchResults row of one provider result."""
    # Every runner sets "provider"; "unknown" mirrors deduplication's rollup for a row without one.
    provider: str = result.get("provider", "unknown")
    provider_type = result.get("provider_type", "llm")  # Default to llm for backward compatibility
    query_prompt_id = result.get("query_prompt_id", "default")
    item: dict[str, Any] = {
        "keyword": keyword,
        "timestamp_provider": f"{timestamp}#{provider}#{query_prompt_id}",
        "timestamp": timestamp,
        "provider": provider,
        "provider_type": provider_type,
        "query_prompt_id": query_prompt_id,
        "query_prompt_name": result.get("query_prompt_name", "Default"),
        "market_id": market_id,
        "response": result.get("response", ""),
        "citations": result.get("citations", []),
        "status": result.get("status", "unknown"),
        "brands": brand_data.get("brands", []),
        "brand_count": brand_data.get("brand_count", 0),
    }
    # Add search results for search providers (convert floats to Decimal for DynamoDB)
    if provider_type == "search" and result.get("search_results"):
        item["search_results"] = convert_floats_to_decimal(result.get("search_results", []))
    if s3_uri:
        item["raw_response_s3_uri"] = s3_uri
    metadata = result.get("metadata", {})
    if metadata:
        item["metadata"] = convert_floats_to_decimal(metadata)
    if "error" in result:
        item["error"] = result["error"]
    return item


def _store_raw_result(
    keyword: str, timestamp: str, result: dict[str, Any], brand_data: dict[str, Any], market_id: str,
) -> str | None:
    """Store one result's raw provider answer to S3; its URI, or ``None`` when there is none to store."""
    raw_response = result.get("raw_response")
    if not raw_response:
        return None
    extracted_data = {
        "response_text": result.get("response", ""),
        "citations": result.get("citations", []),
        "brands": brand_data.get("brands", []),
        "search_results": result.get("search_results", [])  # For search providers
    }
    return store_raw_response_to_s3(
        keyword=keyword,
        provider=result.get("provider", "unknown"),
        timestamp=timestamp,
        raw_response=raw_response,
        extracted_data=extracted_data,
        metadata=result.get("metadata", {}),
        query_prompt_id=result.get("query_prompt_id", "default"),
        market_id=market_id,
    )


def store_search_results(
    keyword: str, timestamp: str, results: list[dict[str, Any]], market: Market | None = None,
) -> bool:
    """Store search results in DynamoDB and raw responses to S3.

    Every row carries ``market_id`` (``GLOBAL_MARKET_ID`` without a market),
    and brands are extracted with the market's competitors and local brand
    names added to the tracked lists.
    """
    market_id = market.market_id if market else GLOBAL_MARKET_ID
    try:
        table = dynamodb.Table(DYNAMODB_TABLE_SEARCH_RESULTS)
        # Load brand config once upfront and reuse for all providers (avoids repeated DynamoDB reads)
        brand_config = _extraction_brand_config(market)

        for result in results:
            brand_data = _extracted_brands(result, brand_config)
            s3_uri = _store_raw_result(keyword, timestamp, result, brand_data, market_id)
            item = _result_item(keyword, timestamp, result, brand_data, market_id, s3_uri)
            table.put_item(Item=item)
            logger.info(
                'Stored result for %s (%s) with %s brand mentions, S3: %s',
                item['provider'], item['provider_type'], item['brand_count'], s3_uri or 'N/A',
            )
    except Exception:
        logger.exception("Error storing results")
        return False
    return True


def _sanitized_keyword(event: dict[str, Any]) -> str:
    """The event's keyword, sanitized; raises ``ValueError`` when it is missing or empties out.

    Keywords are dashboard-editable (see api/manage-keywords) so treated as
    untrusted input before they land in any provider query string. The brand
    extractor downstream wraps the full provider response in <response_text>
    tags — this is defense in depth so a crafted keyword can't poison the
    query itself.
    """
    keyword_raw = event.get('keyword')
    if not keyword_raw:
        error = ValueError("Missing required field: keyword")
        log_error(error, "search handler", event)
        raise error

    keyword = sanitize_user_input(keyword_raw, max_length=MAX_KEYWORD_LENGTH)
    if not keyword:
        error = ValueError("Keyword is empty after sanitization")
        log_error(error, "search handler", event)
        raise error
    return keyword


def _slim_result(result: dict[str, Any]) -> dict[str, Any]:
    """Strip the large fields before the result goes back to Step Functions.

    ``raw_response`` is already stored to S3 and ``search_results`` to DynamoDB;
    keeping them out of the state prevents States.DataLimitExceeded (256KB).
    Citations stay because deduplication reads them.
    """
    slim_result = {
        "provider": result.get("provider"),
        "provider_type": result.get("provider_type", "llm"),
        "status": result.get("status"),
        "citation_count": len(result.get("citations", [])),
        "citations": result.get("citations", []),
        "query_prompt_id": result.get("query_prompt_id", "default"),
    }
    if "error" in result:
        slim_result["error"] = result["error"]
    if "error_category" in result:
        slim_result["error_category"] = result["error_category"]
    return slim_result


def _event_market(event: dict[str, Any]) -> Market | None:
    """The event's market, re-validated; ``None`` (the global market) when it carries none.

    A market that fails validation raises ``ValueError`` instead of falling
    back to the global market: asking the keyword globally would store its
    answers under the wrong market.
    """
    payload = event.get('market')
    market = market_from_payload(payload)
    if payload is not None and market is None:
        error = ValueError("Invalid market in event")
        log_error(error, "search handler", {'keyword': event.get('keyword')})
        raise error
    return market


def _search_keyword(event: dict[str, Any]) -> dict[str, Any]:
    """Run every query prompt across the selected providers and store the results."""
    keyword = _sanitized_keyword(event)
    market = _event_market(event)
    timestamp = event.get('timestamp', get_timestamp())
    providers = event['providers']
    # If no query prompts, use a single default (backward compatible)
    query_prompts = event.get('query_prompts') or [{"id": "default", "name": "Default", "template": None}]

    logger.info(
        'Processing keyword: %s, market: %s, prompts: %s, providers: %s',
        keyword, market.market_id if market else GLOBAL_MARKET_ID, len(query_prompts), providers,
    )

    all_results: list[dict[str, Any]] = []
    for prompt in query_prompts:
        prompt_id = prompt.get('id', 'default')
        prompt_name = prompt.get('name', 'Default')
        logger.info("Running prompt '%s' for keyword '%s'", prompt_name, keyword)
        try:
            results = execute_all_providers(
                keyword,
                providers=providers,
                query_template=prompt.get('template'),
                market=market,
            )
        except Exception:
            logger.exception("Error running prompt '%s' for '%s'", prompt_name, keyword)
            # Continue with remaining prompts
            continue
        # Tag each result with the query prompt info
        for result in results:
            result['query_prompt_id'] = prompt_id
            result['query_prompt_name'] = prompt_name
        all_results.extend(results)

    store_success = store_search_results(keyword, timestamp, all_results, market)
    if not store_success:
        logger.warning("Failed to store some results in DynamoDB")

    # Only `results` is read: the workflow's resultSelector keeps `$.Payload.results`.
    return {"results": [_slim_result(result) for result in all_results]}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for searching across AI providers.

    Input:
    {
        "keyword": "best hotels in malaga",
        "timestamp": "2025-01-15T10:30:00Z",
        "query_prompts": [{"id": "...", "name": "Family", "template": "As a family traveler, find me {keyword}"}],
        "market": {...} | null,  // Market.to_json() of the keyword's market; null/absent = global
        "providers": ["brave"]  // the provider IDs to run; the analysis workflow
                                // sends one id per invocation
    }

    Output:
    {
        "results": [...]  // slim results; [] when the one provider is disabled or has no key
    }
    """
    logger.info('Received event: %s', json.dumps(event))
    # A model changed in Settings must reach the very next invocation, not
    # wait for this warm container to be recycled.
    _provider_model_cache.clear()

    try:
        return _search_keyword(event)
    except Exception as e:
        # !r so a keyword with interior newlines can't forge log records; this
        # path logs the PRE-sanitization keyword straight from the event.
        log_error(e, f"search handler for keyword {event.get('keyword', 'unknown')!r}", event)
        raise
