"""
Search Lambda Function - Lightweight Version
Queries multiple AI providers using direct HTTP API calls (no heavy SDKs).
"""

import json
import os
import logging
import time
import re
from typing import Dict, List, Any, Optional
from datetime import datetime
from decimal import Decimal
import boto3
from botocore.exceptions import ClientError

# Import lightweight API clients
from api_clients import (
    OpenAIClient, PerplexityClient, GeminiClient, ClaudeClient,
    extract_citations_from_response, clean_url
)
from search_clients import (
    BraveSearchClient, TavilySearchClient, ExaSearchClient,
    SerpAPIClient, FirecrawlSearchClient
)
from brand_extractor import extract_brands_from_response

# Import centralized provider constants and error handling
from shared.config import Provider, ProviderType, LLM_PROVIDERS, SEARCH_PROVIDERS
from shared.step_function_response import log_error

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def convert_floats_to_decimal(obj: Any) -> Any:
    """Recursively convert floats to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_floats_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    return obj

# Initialize AWS clients
secrets_client = boto3.client('secretsmanager')
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Load extraction config
_extraction_config = None
def get_extraction_config() -> Dict[str, Any]:
    """Load extraction config from file (cached)."""
    global _extraction_config
    if _extraction_config is None:
        try:
            config_path = os.path.join(os.path.dirname(__file__), 'extraction_config.json')
            with open(config_path, 'r') as f:
                _extraction_config = json.load(f)
            logger.info("Loaded extraction config")
        except Exception as e:
            logger.warning(f"Failed to load extraction config: {str(e)}, using defaults")
            _extraction_config = {"hotel_extraction": {"enabled": True, "config": {}}}
    return _extraction_config

# Environment variables
SECRETS_PREFIX = os.environ.get('SECRETS_PREFIX', 'citation-analysis/')
DYNAMODB_TABLE_SEARCH_RESULTS = os.environ.get('DYNAMODB_TABLE_SEARCH_RESULTS')
RAW_RESPONSES_BUCKET = os.environ.get('RAW_RESPONSES_BUCKET')
PROVIDER_CONFIG_TABLE = os.environ.get('PROVIDER_CONFIG_TABLE', 'CitationAnalysis-ProviderConfig')

# Cache for secrets with TTL
_secrets_cache = {}
_secrets_cache_time = {}
SECRETS_CACHE_TTL = 300  # 5 minutes


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
    raw_response: Dict[str, Any],
    extracted_data: Dict[str, Any],
    metadata: Dict[str, Any]
) -> Optional[str]:
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
        logger.error(f"Failed to store raw response to S3: {str(e)}")
        return None


def get_secret(secret_name: str) -> Optional[str]:
    """Retrieve a secret from AWS Secrets Manager with TTL-based caching."""
    current_time = time.time()
    # Derive provider label from secret path (e.g. "citation-analysis/openai-key" -> "OpenAI")
    provider_label = secret_name.rsplit('/', 1)[-1].replace('-key', '').title()
    
    # Check if cached and not expired
    if secret_name in _secrets_cache:
        cache_time = _secrets_cache_time.get(secret_name, 0)
        if current_time - cache_time < SECRETS_CACHE_TTL:
            return _secrets_cache[secret_name]
        else:
            logger.info(f"Cache expired for {provider_label}, refreshing")
            del _secrets_cache[secret_name]
            del _secrets_cache_time[secret_name]
    
    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
        if 'SecretString' in response:
            secret_data = json.loads(response['SecretString'])
            api_key = secret_data.get('api_key')
            if api_key:
                _secrets_cache[secret_name] = api_key
                _secrets_cache_time[secret_name] = current_time
                return api_key
    except Exception as e:
        logger.error(f"No secret found for {provider_label}: {str(e)}")
    
    return None


def is_provider_enabled(provider_id: str) -> bool:
    """Check if a provider is enabled in the config table."""
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        response = table.get_item(Key={'provider_id': provider_id})
        item = response.get('Item')
        if item:
            return item.get('enabled', True)
        # Default to enabled if no config exists
        return True
    except Exception as e:
        logger.warning(f"Error checking provider config for {provider_id}: {str(e)}, defaulting to enabled")
        return True

# Default models per provider (used when no override in ProviderConfig table)
DEFAULT_PROVIDER_MODELS = {
    Provider.OPENAI: 'gpt-5-mini',
    Provider.PERPLEXITY: 'sonar',
    Provider.GEMINI: 'gemini-2.0-flash',
    Provider.CLAUDE: 'claude-sonnet-4-5',
}

# Cache for provider models (per Lambda invocation)
_provider_model_cache = {}

def get_provider_model(provider_id: str) -> str:
    """Get configured model for a provider, with sensible defaults.

    Reads the 'model' field from the ProviderConfig table if set,
    otherwise falls back to DEFAULT_PROVIDER_MODELS.
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
        logger.warning(f"Error reading model config for {provider_id}: {e}, using default: {default}")
        _provider_model_cache[provider_id] = default
        return default



def query_openai(keyword: str, api_key: str, model: str = "gpt-5-mini", query_template: Optional[str] = None) -> Dict[str, Any]:
    """Query OpenAI API with native web search via Responses API."""
    start_time = time.time()
    try:
        client = OpenAIClient(api_key)
        
        # Build query from template or use default
        if query_template:
            query = query_template.replace("{keyword}", keyword)
        else:
            query = f"Search for information about: {keyword}"
        
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
        logger.error(f"OpenAI error: {str(e)}")
        return {
            "provider": Provider.OPENAI,
            "response": "",
            "citations": [],
            "status": "error",
            "error": str(e),
            "raw_response": None,
            "metadata": {"model": model, "latency_ms": int((time.time() - start_time) * 1000)}
        }


def query_perplexity(keyword: str, api_key: str, query_template: Optional[str] = None) -> Dict[str, Any]:
    """Query Perplexity API."""
    start_time = time.time()
    try:
        client = PerplexityClient(api_key)
        query = query_template.replace("{keyword}", keyword) if query_template else keyword
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
        logger.error(f"Perplexity error: {str(e)}")
        return {
            "provider": Provider.PERPLEXITY,
            "response": "",
            "citations": [],
            "status": "error",
            "error": str(e),
            "raw_response": None,
            "metadata": {"model": "sonar", "latency_ms": int((time.time() - start_time) * 1000)}
        }


def resolve_gemini_redirect(redirect_url: str, timeout: int = 5) -> str:
    """
    Resolve Gemini's vertex redirect URL to get the real URL.
    Gemini returns vertexaisearch.cloud.google.com redirect links that need to be followed.
    """
    try:
        import requests
        # Follow redirects and get the final URL
        response = requests.head(redirect_url, allow_redirects=True, timeout=timeout)
        real_url = response.url
        logger.info(f"Resolved Gemini redirect: {redirect_url[:50]}... -> {real_url}")
        return real_url
    except Exception as e:
        logger.warning(f"Failed to resolve Gemini redirect {redirect_url[:50]}...: {str(e)}")
        # Return the redirect URL as fallback
        return redirect_url


def query_gemini(keyword: str, api_key: str, query_template: Optional[str] = None) -> Dict[str, Any]:
    """Query Gemini API with Google Search."""
    start_time = time.time()
    try:
        client = GeminiClient(api_key)
        query = query_template.replace("{keyword}", keyword) if query_template else keyword
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
                "model": "gemini-2.0-flash",
                "latency_ms": latency_ms,
                "usage": raw_response.get('usageMetadata', {})
            }
        }
    except Exception as e:
        logger.error(f"Gemini error: {str(e)}")
        return {
            "provider": Provider.GEMINI,
            "response": "",
            "citations": [],
            "status": "error",
            "error": str(e),
            "raw_response": None,
            "metadata": {"model": "gemini-2.0-flash", "latency_ms": int((time.time() - start_time) * 1000)}
        }


def query_claude(keyword: str, api_key: str, query_template: Optional[str] = None) -> Dict[str, Any]:
    """Query Claude API with web search."""
    start_time = time.time()
    try:
        client = ClaudeClient(api_key)
        query = query_template.replace("{keyword}", keyword) if query_template else keyword
        raw_response = client.generate_content(query)
        
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
        logger.error(f"Claude error: {str(e)}")
        return {
            "provider": Provider.CLAUDE,
            "response": "",
            "citations": [],
            "status": "error",
            "error": str(e),
            "raw_response": None,
            "metadata": {"model": "claude-sonnet-4-5", "latency_ms": int((time.time() - start_time) * 1000)}
        }


def execute_all_providers(keyword: str, provider_types: Optional[List[str]] = None, providers: Optional[List[str]] = None, query_template: Optional[str] = None) -> List[Dict[str, Any]]:
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
    run_llm = provider_types is None or "llm" in provider_types
    run_search = provider_types is None or "search" in provider_types
    
    # Get API keys for LLM providers (only if needed)
    if run_llm:
        openai_key = get_secret(f"{SECRETS_PREFIX}openai-key")
        perplexity_key = get_secret(f"{SECRETS_PREFIX}perplexity-key")
        gemini_key = get_secret(f"{SECRETS_PREFIX}gemini-key")
        claude_key = get_secret(f"{SECRETS_PREFIX}claude-key")
    else:
        openai_key = perplexity_key = gemini_key = claude_key = None
    
    # Get API keys for Search providers (only if needed)
    if run_search:
        brave_key = get_secret(f"{SECRETS_PREFIX}brave-key")
        tavily_key = get_secret(f"{SECRETS_PREFIX}tavily-key")
        exa_key = get_secret(f"{SECRETS_PREFIX}exa-key")
        serpapi_key = get_secret(f"{SECRETS_PREFIX}serpapi-key")
        firecrawl_key = get_secret(f"{SECRETS_PREFIX}firecrawl-key")
    else:
        brave_key = tavily_key = exa_key = serpapi_key = firecrawl_key = None
    
    # Helper to check if a specific provider should run
    def should_run_provider(provider_id: str) -> bool:
        if providers is not None:
            return provider_id in providers
        return True
    
    # Query LLM providers (only if enabled and has API key)
    if run_llm:
        if openai_key and is_provider_enabled(Provider.OPENAI) and should_run_provider(Provider.OPENAI):
            logger.info("Querying OpenAI...")
            openai_model = get_provider_model(Provider.OPENAI)
            results.append(query_openai(keyword, openai_key, model=openai_model, query_template=query_template))
        elif openai_key and should_run_provider(Provider.OPENAI):
            logger.info("OpenAI is disabled, skipping")
        elif should_run_provider(Provider.OPENAI):
            logger.info("OpenAI API key not configured, skipping")
        
        if perplexity_key and is_provider_enabled(Provider.PERPLEXITY) and should_run_provider(Provider.PERPLEXITY):
            logger.info("Querying Perplexity...")
            results.append(query_perplexity(keyword, perplexity_key, query_template=query_template))
        elif perplexity_key and should_run_provider(Provider.PERPLEXITY):
            logger.info("Perplexity is disabled, skipping")
        elif should_run_provider(Provider.PERPLEXITY):
            logger.info("Perplexity API key not configured, skipping")
        
        if gemini_key and is_provider_enabled(Provider.GEMINI) and should_run_provider(Provider.GEMINI):
            logger.info("Querying Gemini...")
            results.append(query_gemini(keyword, gemini_key, query_template=query_template))
        elif gemini_key and should_run_provider(Provider.GEMINI):
            logger.info("Gemini is disabled, skipping")
        elif should_run_provider(Provider.GEMINI):
            logger.info("Gemini API key not configured, skipping")
        
        if claude_key and is_provider_enabled(Provider.CLAUDE) and should_run_provider(Provider.CLAUDE):
            logger.info("Querying Claude...")
            enhanced_keyword = f"{keyword}\n\nPlease include source URLs for all information provided."
            results.append(query_claude(enhanced_keyword, claude_key, query_template=query_template))
        elif claude_key and should_run_provider(Provider.CLAUDE):
            logger.info("Claude is disabled, skipping")
        elif should_run_provider(Provider.CLAUDE):
            logger.info("Claude API key not configured, skipping")
    
    # Query Search providers
    if run_search:
        if brave_key and is_provider_enabled(Provider.BRAVE) and should_run_provider(Provider.BRAVE):
            logger.info("Querying Brave Search...")
            client = BraveSearchClient(brave_key)
            results.append(client.search(keyword))
        elif brave_key and should_run_provider(Provider.BRAVE):
            logger.info("Brave Search is disabled, skipping")
        elif should_run_provider(Provider.BRAVE):
            logger.info("Brave Search API key not configured, skipping")
        
        if tavily_key and is_provider_enabled(Provider.TAVILY) and should_run_provider(Provider.TAVILY):
            logger.info("Querying Tavily...")
            client = TavilySearchClient(tavily_key)
            results.append(client.search(keyword))
        elif tavily_key and should_run_provider(Provider.TAVILY):
            logger.info("Tavily is disabled, skipping")
        elif should_run_provider(Provider.TAVILY):
            logger.info("Tavily API key not configured, skipping")
        
        if exa_key and is_provider_enabled(Provider.EXA) and should_run_provider(Provider.EXA):
            logger.info("Querying Exa...")
            client = ExaSearchClient(exa_key)
            results.append(client.search(keyword))
        elif exa_key and should_run_provider(Provider.EXA):
            logger.info("Exa is disabled, skipping")
        elif should_run_provider(Provider.EXA):
            logger.info("Exa API key not configured, skipping")
        
        if serpapi_key and is_provider_enabled(Provider.SERPAPI) and should_run_provider(Provider.SERPAPI):
            logger.info("Querying SerpAPI...")
            client = SerpAPIClient(serpapi_key)
            results.append(client.search(keyword))
        elif serpapi_key and should_run_provider(Provider.SERPAPI):
            logger.info("SerpAPI is disabled, skipping")
        elif should_run_provider(Provider.SERPAPI):
            logger.info("SerpAPI API key not configured, skipping")
        
        if firecrawl_key and is_provider_enabled(Provider.FIRECRAWL) and should_run_provider(Provider.FIRECRAWL):
            logger.info("Querying Firecrawl...")
            client = FirecrawlSearchClient(firecrawl_key)
            results.append(client.search(keyword))
        elif firecrawl_key and should_run_provider(Provider.FIRECRAWL):
            logger.info("Firecrawl is disabled, skipping")
        elif should_run_provider(Provider.FIRECRAWL):
            logger.info("Firecrawl API key not configured, skipping")
    
    return results


def store_search_results(keyword: str, timestamp: str, results: List[Dict[str, Any]]) -> bool:
    """Store search results in DynamoDB and raw responses to S3."""
    if not DYNAMODB_TABLE_SEARCH_RESULTS:
        logger.error("DYNAMODB_TABLE_SEARCH_RESULTS not set")
        return False
    
    try:
        table = dynamodb.Table(DYNAMODB_TABLE_SEARCH_RESULTS)
        
        # Load extraction config
        extraction_config = get_extraction_config()
        brand_extraction_enabled = extraction_config.get("brand_extraction", {}).get("enabled", True)
        # Pass None to let brand_extractor load config from DynamoDB (which has the actual tracked brands)
        brand_config = None
        
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
                    brand_data = extract_brands_from_response(response_text, config=brand_config)
                except Exception as e:
                    logger.error(f"Brand extraction failed for {provider}: {str(e)}")
            
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
        logger.error(f"Error storing results: {str(e)}")
        return False


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
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
        keyword = event.get('keyword')
        timestamp = event.get('timestamp', datetime.utcnow().isoformat() + 'Z')
        provider_types = event.get('provider_types')  # Optional: ["llm"], ["search"], or ["llm", "search"]
        providers = event.get('providers')  # Optional: specific provider IDs
        query_prompts = event.get('query_prompts', [])

        if not keyword:
            error = ValueError("Missing required field: keyword")
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
        log_error(e, f"search handler for keyword {event.get('keyword', 'unknown')}", event)
        raise
# Force rebuild
