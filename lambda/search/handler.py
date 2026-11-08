"""
Search Lambda Function - Lightweight Version
Queries multiple AI providers using direct HTTP API calls (no heavy SDKs).
"""

import json
import logging
import math
import os
import re
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any, NamedTuple

import boto3
from boto3.dynamodb.conditions import Key
from branded_query import BRANDED_MATCHER_VERSION, branded_query_matcher_for
from perplexity_sources import perplexity_sources

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
from search_clients import (
    AgentCoreSearchClient,
    BraveSearchClient,
    ExaSearchClient,
    FirecrawlSearchClient,
    SerpAPIClient,
    TavilySearchClient,
)

# Import centralized provider constants and error handling
from shared.ai_clients import (
    CLAUDE_TIMEOUT_SECONDS,
    DEFAULT_MAX_RETRIES,
    GEMINI_TIMEOUT_SECONDS,
    OPENAI_TIMEOUT_SECONDS,
    PERPLEXITY_TIMEOUT_SECONDS,
    perplexity_agent_text,
)
from shared.config import Provider
from shared.constants import MAX_KEYWORD_LENGTH
from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_locations import UnsupportedMarketError, market_codes
from shared.dataforseo_serp import AIO_MODEL, AIO_TIMEOUT_SECONDS, AiOverviewResult, OrganicItem, ai_overview_search
from shared.dynamo_decimal import convert_floats_to_decimal
from shared.dynamodb_batch import collect_all_items
from shared.kpi_engine import NO_ANSWER
from shared.markets import GLOBAL_MARKET_ID, Market, brand_config_for_market, market_from_payload
from shared.prompt_safety import sanitize_user_input
from shared.provider_health import record_provider_failure, record_provider_success
from shared.provider_models import DEFAULT_PROVIDER_MODELS, ProviderConfigUnavailableError, read_provider_model
from shared.provider_pacing import MAX_WAIT_SECONDS, provider_min_interval_seconds, wait_for_send_slot
from shared.request_deadline import Deadline, activate_deadline, budget_from_context, clear_request_deadline
from shared.safe_fetch import fetch_following_validated_redirects, host_matches
from shared.search_results import search_results_table_name
from shared.secrets import get_api_key
from shared.serpapi import DEFAULT_DEADLINE_SECONDS as SERPAPI_POLL_DEADLINE_SECONDS
from shared.serpapi import MAX_REQUEST_ATTEMPTS as SERPAPI_REQUEST_ATTEMPTS
from shared.serpapi import REQUEST_TIMEOUT_SECONDS as SERPAPI_REQUEST_TIMEOUT_SECONDS
from shared.step_function_response import log_error

# Configure logging
from shared.utils import get_brand_config, get_timestamp
from shared.web_search_gateway import gateway_url

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
DYNAMODB_TABLE_SEARCH_RESULTS = search_results_table_name()
RAW_RESPONSES_BUCKET = os.environ['RAW_RESPONSES_BUCKET']
#: The citation rule an answer row was stored under (D2, D3). 2: only the sources the answer cites count
#: (``citations``), the pages an engine only read are ``retrieved_urls``, and Perplexity and Claude are asked to
#: cite (2.43.0). Rows without the field predate it and counted every source the engine returned.
CITATIONS_VERSION = 2
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

# Attempts (timeouts and 5xx) for the engines with long per-attempt timeouts
# (OpenAI 180 s, Claude 120 s). The default five would let one stalled answer
# outlast the provider Lambda's 900 s; three keep a persona under ~9 minutes
# in the worst case, and a 429 still gets its extra throttle attempts.
SLOW_ENGINE_MAX_ATTEMPTS = 3


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


class ParsedAnswer(NamedTuple):
    """What one engine response yields.

    ``citations`` are the URLs the answer cites: annotations, inline citations,
    grounding chunks and raw URLs written in the text. ``retrieved_urls`` are
    the URLs the engine only fetched while searching (search results it did not
    cite); they are stored for inspection but never count as citations, since a
    page the engine read and did not cite is not a source of the answer.
    """

    text: str
    citations: list[str]
    retrieved_urls: list[str]


def _parsed_answer(text: str, cited: Iterable[str], retrieved: Iterable[str] = ()) -> ParsedAnswer:
    """``text`` with its cited URLs once each, and the retrieved URLs that are not also cited."""
    citations = list(dict.fromkeys(url for url in cited if url))
    cited_set = set(citations)
    retrieved_only = [url for url in dict.fromkeys(retrieved) if url and url not in cited_set]
    return ParsedAnswer(text, citations, retrieved_only)


def _query_llm(
    provider: str,
    keyword: str,
    query_template: str | None,
    request: Callable[[str], dict[str, Any]],
    parse: Callable[[dict[str, Any]], ParsedAnswer],
    *,
    model: str,
    usage_key: str = 'usage',
    model_from_response: bool = False,
    extra_metadata: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The request/parse/error flow every LLM provider shares.

    ``request`` sends the resolved query and returns the raw payload; ``parse``
    reads the ``ParsedAnswer`` out of it. A failure anywhere in that
    flow becomes the uniform error result rather than an exception, so one dead
    provider cannot take the keyword down and ``_record_provider_outcome`` can
    classify what went wrong. ``model`` labels the metadata (and the error
    result); with ``model_from_response`` the payload's own ``model`` wins.
    ``extra_metadata`` adds provider-specific fields read from the payload.

    A call that returns no answer text (blank after trimming) is ``no_answer``:
    the engine worked, so it is not a failure, but there is no answer to read
    a brand from, and counting it would lower every rate.
    """
    start_time = time.time()
    try:
        raw_response = request(build_provider_query(keyword, query_template))
        latency_ms = int((time.time() - start_time) * 1000)
        parsed = parse(raw_response)
    except Exception as e:
        logger.exception('%s error', provider)
        return provider_error_result(provider, model, e, start_time)

    status = "success" if parsed.text.strip() else NO_ANSWER
    logger.info(
        "%s %s: %s cited and %s retrieved URLs for '%s'",
        provider, status, len(parsed.citations), len(parsed.retrieved_urls), keyword,
    )
    return {
        "provider": provider,
        "response": parsed.text,
        "citations": parsed.citations,
        "retrieved_urls": parsed.retrieved_urls,
        "status": status,
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


def _parse_openai_response(raw_response: dict[str, Any]) -> ParsedAnswer:
    """Message text and its ``url_citation`` annotations; the web-search ``sources`` are only retrieved."""
    response_text = ""
    citations: list[str] = []
    retrieved: list[str] = []
    for item in raw_response.get('output', []):
        if item.get('type') == 'message':
            text, urls = _openai_message_content(item)
            response_text += text
            citations.extend(urls)
        elif item.get('type') == 'web_search_call':
            sources = item.get('action', {}).get('sources', [])
            retrieved.extend(clean_url(source['url']) for source in sources if source.get('url'))
    # Fallback: extract from output_text if available
    return _parsed_answer(response_text or raw_response.get('output_text', ''), citations, retrieved)


def query_openai(
    keyword: str, api_key: str, model: str = DEFAULT_PROVIDER_MODELS[Provider.OPENAI], query_template: str | None = None,
    market: Market | None = None,
) -> ProviderResult:
    """Query OpenAI API with native web search via Responses API."""
    def request(query: str) -> dict[str, Any]:
        return OpenAIClient(api_key).responses_with_web_search(
            query=query, model=model, market=market, max_retries=SLOW_ENGINE_MAX_ATTEMPTS,
        )

    return _query_llm(Provider.OPENAI, keyword, query_template, request, _parse_openai_response, model=model)


def _parse_perplexity_response(raw_response: dict[str, Any]) -> ParsedAnswer:
    """Agent API answer text; the sources it cites (``perplexity_sources``) and the URLs in the text are cited."""
    response_text = perplexity_agent_text(raw_response)
    sources = perplexity_sources(raw_response, response_text)
    cited = _merge_citations([clean_url(url) for url in sources.cited], extract_citations_from_response(response_text))
    return _parsed_answer(response_text, cited, (clean_url(url) for url in sources.retrieved))


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
        # Handled by design (the citation keeps the wrapper URL); the answer-level
        # summary in ``_gemini_grounding_citations`` warns when none resolved.
        logger.info('Failed to resolve Gemini redirect %s...: %s', redirect_url[:50], fetch_error)
        return redirect_url

    logger.info('Resolved Gemini redirect: %s... -> %s', redirect_url[:50], final_url)
    return final_url


def _gemini_grounding_citations(grounding: dict[str, Any]) -> list[str]:
    """Real URLs behind the grounding chunks' redirect wrappers, deduplicated in order."""
    citations: list[str] = []
    wrappers = 0
    unresolved = 0
    for chunk in grounding.get('groundingChunks', []):
        redirect_url = chunk['web'].get('uri') if 'web' in chunk else None
        if not redirect_url:
            continue
        # Resolve the vertex redirect to get the real URL, then clean it
        resolved_url = resolve_gemini_redirect(redirect_url)
        wrappers += 1
        unresolved += resolved_url == redirect_url
        cleaned_url = clean_url(resolved_url)
        if cleaned_url and cleaned_url not in citations:
            citations.append(cleaned_url)
    if wrappers > 1 and unresolved == wrappers:
        logger.warning('None of the %s Gemini redirects of this answer resolved; citations keep the wrapper host', wrappers)
    # Also check webSearchQueries if available
    if 'webSearchQueries' in grounding:
        logger.info('Gemini search queries: %s', grounding['webSearchQueries'])
    return citations


def _parse_gemini_response(raw_response: dict[str, Any]) -> ParsedAnswer:
    """First candidate's text; its grounding chunks and the URLs in the text are cited (Gemini reports nothing else)."""
    response_text = ""
    citations: list[str] = []
    candidates = raw_response.get('candidates', [])
    if candidates:
        candidate = candidates[0]
        if 'content' in candidate and 'parts' in candidate['content']:
            response_text = ' '.join([part.get('text', '') for part in candidate['content']['parts']])
        if 'groundingMetadata' in candidate:
            citations = _gemini_grounding_citations(candidate['groundingMetadata'])
    return _parsed_answer(response_text, _merge_citations(citations, extract_citations_from_response(response_text)))


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


def _claude_search_result_urls(content_block: dict[str, Any], retrieved: list[str]) -> None:
    """Append the URLs of a ``web_search_tool_result`` block (pages Claude retrieved) that are not listed yet.

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
            _merge_citations(retrieved, [clean_url(url)])
            logger.debug('Claude web search result URL: %s', url)


def _claude_text_citation_urls(content_block: dict[str, Any]) -> list[str]:
    """The cleaned URLs a text block cites (``citations[].url``, ``web_search_result_location``)."""
    return [
        clean_url(citation['url'])
        for citation in content_block.get('citations') or []
        if isinstance(citation, dict) and citation.get('url')
    ]


def _parse_claude_response(raw_response: dict[str, Any]) -> ParsedAnswer:
    """Text blocks; their cited URLs and the URLs in the text are cited, the web-search results only retrieved."""
    # Log the full response structure for debugging
    logger.info('Claude raw response structure: %s', json.dumps(raw_response, default=str)[:1000])
    response_text = ""
    citations: list[str] = []
    retrieved: list[str] = []
    for content_block in raw_response.get('content', []):
        block_type = content_block.get('type')
        logger.debug('Claude content block type: %s', block_type)
        if block_type == 'text':
            response_text += content_block.get('text', '')
            _merge_citations(citations, _claude_text_citation_urls(content_block))
        elif block_type == 'web_search_tool_result':
            _claude_search_result_urls(content_block, retrieved)
        else:
            _log_claude_tool_block(block_type, content_block)
    return _parsed_answer(
        response_text, _merge_citations(citations, extract_citations_from_response(response_text)), retrieved,
    )


def query_claude(
    keyword: str, api_key: str, model: str = DEFAULT_PROVIDER_MODELS[Provider.CLAUDE], query_template: str | None = None,
    market: Market | None = None,
) -> ProviderResult:
    """Query Claude API with web search."""
    def request(query: str) -> dict[str, Any]:
        return ClaudeClient(api_key, model=model).generate_content(
            query, system_prompt=CLAUDE_CITATION_SYSTEM_PROMPT, market=market, max_retries=SLOW_ENGINE_MAX_ATTEMPTS,
        )

    return _query_llm(
        Provider.CLAUDE, keyword, query_template, request, _parse_claude_response,
        model=model, model_from_response=True,
    )


# --- Google AI Overviews (DataForSEO SERP) ------------------------------------

#: The organic results kept on an AI Overviews row (the SERP is fetched at depth 10).
AIO_ORGANIC_LIMIT = 10

#: ``error_category`` of a market DataForSEO cannot localise: nothing was sent, nothing billed.
UNSUPPORTED_MARKET = 'unsupported_market'

#: Engines asked the plain keyword once per keyword and run: Google takes no persona
#: wording, and a long persona prompt rarely triggers an overview. Their single row carries the
#: unpersonalised prompt (``DEFAULT_QUERY_PROMPT``) even when the run has personas.
PLAIN_KEYWORD_PROVIDERS = frozenset({Provider.GOOGLE_AI_OVERVIEW})

#: The prompt of an unpersonalised query (also the run's only prompt when it has no personas).
DEFAULT_QUERY_PROMPT: dict[str, Any] = {"id": "default", "name": "Default", "template": None}


def _aio_search_result(item: OrganicItem) -> dict[str, Any]:
    """One organic result as an entry of a SearchResults row's ``search_results``."""
    return {
        "url": item.url,
        "title": item.title,
        "snippet": item.description,
        "position": item.position,
        "domain": item.domain,
        "rank_absolute": item.rank_absolute,
        "source": Provider.GOOGLE_AI_OVERVIEW,
    }


def _aio_result(overview: AiOverviewResult) -> ProviderResult:
    """The row of an answered (``success``) or overview-less (``no_answer``) results page."""
    organic = [_aio_search_result(item) for item in overview.organic[:AIO_ORGANIC_LIMIT]]
    return {
        "provider": Provider.GOOGLE_AI_OVERVIEW,
        "provider_type": "llm",
        "response": overview.answer_text,
        "citations": list(overview.citations),
        "status": overview.status,
        "search_results": organic,
        # Bronze: DataForSEO's task result as returned (D2), so the overview's references can be read again (D3).
        # The rendered markdown is kept beside it; the row's `response` is the plain prose brands are read from.
        "raw_response": {"dataforseo_result": overview.raw_result},
        "answer_markdown": overview.answer_markdown,
        "metadata": overview.metadata,
    }


def _aio_error(error: Exception, start_time: float, **fields: Any) -> ProviderResult:
    """The error row of a failed AI Overviews call, with ``fields`` (``error_code``, ``error_category``) added."""
    result = provider_error_result(Provider.GOOGLE_AI_OVERVIEW, AIO_MODEL, error, start_time)
    result["provider_type"] = "llm"
    return {**result, **fields}


def query_google_ai_overview(keyword: str, market: Market | None = None) -> ProviderResult:
    """The AI Overview Google shows for the plain ``keyword`` in ``market``.

    A market DataForSEO cannot localise is an error row with ``error_category``
    ``unsupported_market`` and no call. A DataForSEO failure keeps its
    ``DataForSeoError.code`` as ``error_code`` (provider health maps it) and
    any billed cost in ``metadata.cost_usd``.
    """
    start_time = time.time()
    try:
        codes = market_codes(market)
    except UnsupportedMarketError as error:
        logger.info('Google AI Overviews skipped: %s', error)
        return _aio_error(error, start_time, error_category=UNSUPPORTED_MARKET)
    try:
        overview = ai_overview_search(keyword, codes)
    except DataForSeoError as error:
        logger.warning('Google AI Overviews failed: %s %s', error.code, error.provider_status)
        result = _aio_error(error, start_time, error_code=error.code)
        if error.cost_usd:
            result["metadata"]["cost_usd"] = error.cost_usd
        return result
    except Exception as error:
        logger.exception('Google AI Overviews error')
        return _aio_error(error, start_time)
    logger.info(
        "Google AI Overviews: %s with %s citations for '%s'", overview.status, len(overview.citations), keyword,
    )
    return _aio_result(overview)


def _run_google_ai_overview_provider(
    keyword: str, api_key: str, query_template: str | None, market: Market | None,
) -> ProviderResult:
    """Google AI Overviews for the plain keyword (no persona template); the DataForSEO
    client reads the ``dataforseo-key`` login itself, so ``api_key`` only proves it is set."""
    return query_google_ai_overview(keyword, market)


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
PROVIDER_RUNNERS: list[tuple[str, str | None, str, ProviderRunner]] = [
    (Provider.OPENAI, 'openai-key', 'OpenAI', _run_openai_provider),
    (Provider.PERPLEXITY, 'perplexity-key', 'Perplexity', _run_perplexity_provider),
    (Provider.GEMINI, 'gemini-key', 'Gemini', _run_gemini_provider),
    (Provider.CLAUDE, 'claude-key', 'Claude', _run_claude_provider),
    # The DataForSEO login (`login:password`) shared with the SEO stack.
    (Provider.GOOGLE_AI_OVERVIEW, 'dataforseo-key', 'Google AI Overviews', _run_google_ai_overview_provider),
    (Provider.BRAVE, 'brave-key', 'Brave Search', _search_provider_runner(BraveSearchClient)),
    (Provider.TAVILY, 'tavily-key', 'Tavily', _search_provider_runner(TavilySearchClient)),
    (Provider.EXA, 'exa-key', 'Exa', _search_provider_runner(ExaSearchClient)),
    (Provider.SERPAPI, 'serpapi-key', 'SerpAPI', _search_provider_runner(SerpAPIClient)),
    (Provider.FIRECRAWL, 'firecrawl-key', 'Firecrawl', _search_provider_runner(FirecrawlSearchClient)),
    # No secret: IAM-signed calls to the Web Search gateway, whose URL is the credential.
    (Provider.AGENTCORE, None, 'Bedrock Web Search', _search_provider_runner(AgentCoreSearchClient)),
]


# ---------------------------------------------------------------------------
# Time budget (2.42.0): one invocation never starts a call it cannot finish
# ---------------------------------------------------------------------------

#: Seconds kept back from the Lambda's remaining time for the slim results and the resumable error.
SEARCH_SAFETY_MARGIN_SECONDS = 10.0
#: Worst case of storing one query prompt's answers: brand extraction (Bedrock), the S3 put and the put_item.
STORE_RESERVE_SECONDS = 60.0
#: Backoff between a call's attempts (1 + 2.5 + 5 + 9.5 s over five attempts), rounded up.
RETRY_BACKOFF_SECONDS = 20.0
#: Gemini's grounding redirects are resolved one 5 s HEAD at a time; room for 20 of them.
GEMINI_REDIRECT_RESERVE_SECONDS = 100.0

#: Seconds one provider call may take when every attempt times out (attempts x per-attempt timeout + backoff).
#: Waiting out 429s is not counted: those answers take milliseconds and the waits are capped by the client.
PROVIDER_CALL_WORST_CASE_SECONDS: dict[str, float] = {
    Provider.OPENAI: SLOW_ENGINE_MAX_ATTEMPTS * OPENAI_TIMEOUT_SECONDS + RETRY_BACKOFF_SECONDS,
    Provider.CLAUDE: SLOW_ENGINE_MAX_ATTEMPTS * CLAUDE_TIMEOUT_SECONDS + RETRY_BACKOFF_SECONDS,
    Provider.PERPLEXITY: DEFAULT_MAX_RETRIES * PERPLEXITY_TIMEOUT_SECONDS + RETRY_BACKOFF_SECONDS,
    Provider.GEMINI: DEFAULT_MAX_RETRIES * GEMINI_TIMEOUT_SECONDS + RETRY_BACKOFF_SECONDS + GEMINI_REDIRECT_RESERVE_SECONDS,
    # The submit's attempts, then the Search Archive polled until its own deadline.
    Provider.SERPAPI: SERPAPI_REQUEST_ATTEMPTS * SERPAPI_REQUEST_TIMEOUT_SECONDS + SERPAPI_POLL_DEADLINE_SECONDS
    + RETRY_BACKOFF_SECONDS,
    # One live SERP call, never re-sent (billed): its own timeout.
    Provider.GOOGLE_AI_OVERVIEW: AIO_TIMEOUT_SECONDS,
    **{
        client.provider_id: DEFAULT_MAX_RETRIES * client.timeout + RETRY_BACKOFF_SECONDS
        for client in (BraveSearchClient, TavilySearchClient, ExaSearchClient, FirecrawlSearchClient, AgentCoreSearchClient)
    },
}


class SearchTimeBudgetSpentError(RuntimeError):
    """Query prompts are left that this invocation had no time to run; a retry resumes after the stored ones.

    Raised only after every answer this invocation got has been stored, so the
    retry (its own Step Functions retrier) skips them and never asks a
    provider again for a stored (keyword, run, provider, prompt).
    """


def invocation_deadline(context: Any) -> Deadline:
    """The invocation's budget: the Lambda's remaining time less ``SEARCH_SAFETY_MARGIN_SECONDS``.

    Without a Lambda context (a script, a test) nothing is bounded.
    """
    if not callable(getattr(context, 'get_remaining_time_in_millis', None)):
        return Deadline(math.inf)
    return Deadline(budget_from_context(context, SEARCH_SAFETY_MARGIN_SECONDS))


def prompt_time_needed(providers: Iterable[str]) -> float:
    """Seconds one query prompt may take across ``providers`` (asked one after another) and its storage.

    A paced provider (``provider_min_interval_seconds``) may also wait up to
    ``MAX_WAIT_SECONDS`` for its send slot before each call.
    """
    fallback = max(PROVIDER_CALL_WORST_CASE_SECONDS.values())
    calls = [PROVIDER_CALL_WORST_CASE_SECONDS.get(provider, fallback) for provider in providers]
    slot_wait = MAX_WAIT_SECONDS * len(calls) if provider_min_interval_seconds() > 0 else 0.0
    return sum(calls) + slot_wait + STORE_RESERVE_SECONDS


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

    A result that already carries `error_category` was refused before any
    call (an unsupported market): it says nothing about the provider's health
    and is not recorded. A DataForSEO failure is classified by its
    `error_code`; a `no_answer` page is a successful call.
    """
    table = dynamodb.Table(PROVIDER_CONFIG_TABLE)

    if result.get('status') == 'error':
        if result.get('error_category'):
            return
        message = result.get('error', 'unknown provider error')
        error_code = result.get('error_code')
        failure: object = DataForSeoError(error_code, message) if error_code else message
        outcome = record_provider_failure(table, provider_id, failure)
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
        api_key = get_api_key(secret_name) if secret_name else gateway_url()
        if not api_key:
            logger.info('%s credential not configured, skipping', label)
            continue
        if not is_provider_enabled(provider_id):
            logger.info('%s is disabled, skipping', label)
            continue

        logger.info('Querying %s...', label)
        # The provider's shared send-time ledger: no two slots send inside its interval.
        wait_for_send_slot(dynamodb.Table(PROVIDER_CONFIG_TABLE), provider_id, provider_min_interval_seconds())
        try:
            result = run_query(keyword, api_key, query_template, market)
        except ProviderConfigUnavailableError:
            logger.exception('%s provider config unavailable, skipping this run', label)
            continue
        _record_provider_outcome(provider_id, result)
        results.append(result)

    return results


def _extraction_brand_config(market: Market | None, stored: dict[str, Any]) -> dict[str, Any] | None:
    """The brand config extraction uses (``market``'s competitors and aliases added), or ``None`` when extraction is off.

    Without a market it is the stored config as is; with one, the stored
    config (the extractor's defaults when nothing is stored) plus the
    market's extra names.
    """
    extraction_config = get_extraction_config()
    if not extraction_config.get("brand_extraction", {}).get("enabled", True):
        return None
    brand_config = brand_config_for_market(stored or DEFAULT_EXTRACTION_CONFIG, market) if market else stored
    logger.info('Loaded brand config for extraction: industry=%s', (brand_config or {}).get('industry') or 'default')
    return brand_config


def _extracted_brands(result: dict[str, Any], brand_config: dict[str, Any] | None) -> dict[str, Any]:
    """Brand mentions in an LLM result's text (none for search providers, non-``success`` rows,
    empty answers or extraction off)."""
    provider = result.get("provider", "unknown")
    response_text = result.get("response", "")
    answered = result.get("status", "success") == "success"
    if brand_config is None or not answered or not response_text or result.get("provider_type", "llm") != "llm":
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
    *, is_branded: Callable[[str], bool] | None = None,
) -> dict[str, Any]:
    """The SearchResults row of one provider result.

    Answer-engine rows carry ``retrieved_urls`` (pages the engine read but did
    not cite; never counted as citations) and ``branded`` (whether the query
    named the tracked brand, per ``is_branded``; fixed at write time).
    """
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
    # Add search results for search providers and the AI Overviews organic top 10
    # (convert floats to Decimal for DynamoDB)
    if (provider_type == "search" or provider in PLAIN_KEYWORD_PROVIDERS) and result.get("search_results"):
        item["search_results"] = convert_floats_to_decimal(result.get("search_results", []))
    if provider_type == "llm":
        item["retrieved_urls"] = list(result.get("retrieved_urls") or [])
        item["branded"] = bool(is_branded and is_branded(str(result.get("query") or keyword)))
        item["branded_version"] = BRANDED_MATCHER_VERSION
        item["citations_version"] = CITATIONS_VERSION
    if s3_uri:
        item["raw_response_s3_uri"] = s3_uri
    metadata = result.get("metadata", {})
    if metadata:
        item["metadata"] = convert_floats_to_decimal(metadata)
    if "error" in result:
        item["error"] = result["error"]
    if "error_category" in result:
        item["error_category"] = result["error_category"]
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
        "retrieved_urls": result.get("retrieved_urls", []),
        "brands": brand_data.get("brands", []),
        "search_results": result.get("search_results", []),  # For search providers
        **({"answer_markdown": result["answer_markdown"]} if result.get("answer_markdown") else {}),
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
    names added to the tracked lists; the same names (and the owned domains)
    decide whether an answer row is ``branded``.
    """
    market_id = market.market_id if market else GLOBAL_MARKET_ID
    try:
        table = dynamodb.Table(DYNAMODB_TABLE_SEARCH_RESULTS)
        # Load brand config once upfront and reuse for all providers (avoids repeated DynamoDB reads)
        stored = get_brand_config()
        brand_config = _extraction_brand_config(market, stored)
        is_branded = branded_query_matcher_for(brand_config_for_market(stored, market))

        for result in results:
            brand_data = _extracted_brands(result, brand_config)
            s3_uri = _store_raw_result(keyword, timestamp, result, brand_data, market_id)
            item = _result_item(keyword, timestamp, result, brand_data, market_id, s3_uri, is_branded=is_branded)
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


#: The SearchResults attributes a stored answer's slim result is rebuilt from.
_STORED_SLIM_PROJECTION = '#provider, provider_type, #status, citations, query_prompt_id, #error, error_category'
_STORED_SLIM_NAMES = {'#provider': 'provider', '#status': 'status', '#error': 'error'}


def _run_prompt(
    keyword: str, prompt: dict[str, Any], providers: list[str], market: Market | None,
) -> list[dict[str, Any]]:
    """``prompt``'s answers from ``providers``, tagged with the prompt; none when the fan-out raised."""
    prompt_id = prompt.get('id', 'default')
    prompt_name = prompt.get('name', 'Default')
    logger.info("Running prompt '%s' for keyword '%s'", prompt_name, keyword)
    try:
        results = execute_all_providers(keyword, providers=providers, query_template=prompt.get('template'), market=market)
    except Exception:
        logger.exception("Error running prompt '%s' for '%s'", prompt_name, keyword)
        return []
    for result in results:
        result['query_prompt_id'] = prompt_id
        result['query_prompt_name'] = prompt_name
        # The string the engines were asked: what decides whether the row is branded.
        result['query'] = build_provider_query(keyword, prompt.get('template'))
    return results


@dataclass
class _SearchRun:
    """One invocation's keyword run: what is stored, what it asked, and when it must stop starting prompts."""

    keyword: str
    timestamp: str
    market: Market | None
    deadline: Deadline
    stored: dict[tuple[str, str], dict[str, Any]]
    prompts_run: int = 0
    pending: list[str] = field(default_factory=list)

    def missing_providers(self, prompt_id: str, providers: list[str]) -> list[str]:
        return [provider for provider in providers if (provider, prompt_id) not in self.stored]

    def stored_for(self, prompt_id: str, providers: list[str]) -> list[dict[str, Any]]:
        return [self.stored[(provider, prompt_id)] for provider in providers if (provider, prompt_id) in self.stored]

    def has_time_for(self, providers: list[str]) -> bool:
        """Whether a prompt over ``providers`` can finish in time; the first prompt always runs, so a retry progresses."""
        return self.prompts_run == 0 or self.deadline.remaining() >= prompt_time_needed(providers)

    def answer(self, prompt: dict[str, Any], providers: list[str]) -> list[dict[str, Any]]:
        """``prompt``'s slim results from ``providers``: the stored ones, plus the missing ones asked and stored now."""
        prompt_id = str(prompt.get('id', 'default'))
        slims = self.stored_for(prompt_id, providers)
        missing = self.missing_providers(prompt_id, providers)
        if not missing:
            return slims
        if not self.has_time_for(missing):
            self.pending.append(prompt_id)
            return slims
        self.prompts_run += 1
        results = _run_prompt(self.keyword, prompt, missing, self.market)
        # Stored before the next prompt starts: a timeout later in this invocation keeps these answers.
        if not store_search_results(self.keyword, self.timestamp, results, self.market):
            logger.warning("Failed to store some results in DynamoDB")
        return slims + [_slim_result(result) for result in results]

    def finished(self, results: list[dict[str, Any]]) -> dict[str, Any]:
        """The invocation's answer when every prompt is answered; raises ``SearchTimeBudgetSpentError`` when some are left."""
        if self.pending:
            logger.warning('Time budget spent: %d query prompt(s) left for the retry', len(self.pending))
            raise SearchTimeBudgetSpentError(f'{len(self.pending)} query prompt(s) left for the retry')
        # Only `results` is read: the workflow's resultSelector keeps `$.Payload.results`.
        return {"results": results}


def _search_keyword(event: dict[str, Any], deadline: Deadline | None = None) -> dict[str, Any]:
    """Run every query prompt across the selected providers, storing each prompt's answers as it finishes.

    Plain-keyword engines (``PLAIN_KEYWORD_PROVIDERS``) are asked once, under
    ``DEFAULT_QUERY_PROMPT``, whatever the personas. Prompts whose answers an
    earlier attempt of the same run stored are not asked again. When
    ``deadline`` leaves too little time for the next prompt's worst case, no
    new prompt starts and ``SearchTimeBudgetSpentError`` hands the rest to a
    retry.
    """
    keyword = _sanitized_keyword(event)
    market = _event_market(event)
    resumable = isinstance(event.get('timestamp'), str) and bool(event.get('timestamp'))
    timestamp = event['timestamp'] if resumable else get_timestamp()
    providers = event['providers']
    # If no query prompts, use a single default (backward compatible)
    query_prompts = event.get('query_prompts') or [DEFAULT_QUERY_PROMPT]

    logger.info(
        'Processing keyword: %s, market: %s, prompts: %s, providers: %s',
        keyword, market.market_id if market else GLOBAL_MARKET_ID, len(query_prompts), providers,
    )
    run = _SearchRun(
        keyword, timestamp, market, deadline or invocation_deadline(None),
        stored_slim_results(keyword, timestamp) if resumable else {},
    )
    if run.stored:
        logger.info('Resuming the run: %d answer(s) already stored are not asked again', len(run.stored))

    # Plain-keyword engines run once, unpersonalised, whatever the personas.
    prompted = [provider for provider in providers if provider not in PLAIN_KEYWORD_PROVIDERS]
    plain = [provider for provider in providers if provider in PLAIN_KEYWORD_PROVIDERS]
    all_results: list[dict[str, Any]] = []
    if prompted:
        for prompt in query_prompts:
            all_results.extend(run.answer(prompt, prompted))
    if plain:
        all_results.extend(run.answer(DEFAULT_QUERY_PROMPT, plain))
    return run.finished(all_results)


def stored_slim_results(keyword: str, timestamp: str) -> dict[tuple[str, str], dict[str, Any]]:
    """The slim results already stored for ``keyword``'s run ``timestamp``, by (provider, query prompt id).

    A retried invocation (a Lambda timeout, or ``SearchTimeBudgetSpentError``)
    finds here what an earlier attempt stored and asks no provider again for
    it. One run of one keyword is at most prompts x providers rows. A read
    error raises: running blind could pay twice for an answer already stored.
    """
    rows = collect_all_items(
        dynamodb.Table(DYNAMODB_TABLE_SEARCH_RESULTS).query,
        KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').begins_with(f'{timestamp}#'),
        ProjectionExpression=_STORED_SLIM_PROJECTION,
        ExpressionAttributeNames=_STORED_SLIM_NAMES,
    )
    stored: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        provider = row.get('provider')
        if isinstance(provider, str) and provider:
            slim = _slim_result(row)
            stored[(provider, str(slim['query_prompt_id']))] = slim
    return stored


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Search one keyword with the selected providers, each query prompt in turn, inside the time budget.

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

    # Active for the invocation, so the provider clients' retry waits
    # (shared.ai_clients.retry_with_backoff) never sleep past it either.
    deadline = activate_deadline(invocation_deadline(context))
    try:
        return _search_keyword(event, deadline)
    except SearchTimeBudgetSpentError:
        raise
    except Exception as e:
        # !r so a keyword with interior newlines can't forge log records; this
        # path logs the PRE-sanitization keyword straight from the event.
        log_error(e, f"search handler for keyword {event.get('keyword', 'unknown')!r}", event)
        raise
    finally:
        clear_request_deadline()
