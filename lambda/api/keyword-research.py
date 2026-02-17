"""
Keyword Research API Lambda

Provides keyword expansion and competitor analysis using AI providers with web search.
Leverages the same AI providers (OpenAI, Perplexity, Gemini, Claude) used in the main
search functionality, all with native web search capabilities for real-time data.
"""

import json
import boto3
import requests
import logging
import sys
from typing import Dict, Any, List, Optional
import os
from datetime import datetime
import uuid
import re
from urllib.parse import urlparse
import time

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, parse_json_body, validate, route_handler
from shared.api_response import success_response, validation_error, error_response
from shared.url_validator import validate_url_safe

# HTML parsing
from bs4 import BeautifulSoup

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
secrets_client = boto3.client('secretsmanager')

# Fail-fast: Required environment variables
KEYWORD_RESEARCH_TABLE = os.environ['KEYWORD_RESEARCH_TABLE']
SECRETS_PREFIX = os.environ.get('SECRETS_PREFIX', 'citation-analysis/')

research_table = dynamodb.Table(KEYWORD_RESEARCH_TABLE)

# User agent for web requests
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# Cache for secrets
_secrets_cache = {}
_secrets_cache_time = {}
SECRETS_CACHE_TTL = 300


def get_secret(secret_name: str) -> Optional[str]:
    """Retrieve secret from Secrets Manager with caching."""
    current_time = time.time()
    full_name = f"{SECRETS_PREFIX}{secret_name}"
    
    # Check cache
    if full_name in _secrets_cache:
        cache_time = _secrets_cache_time.get(full_name, 0)
        if current_time - cache_time < SECRETS_CACHE_TTL:
            return _secrets_cache[full_name]
    
    try:
        response = secrets_client.get_secret_value(SecretId=full_name)
        secret_string = response['SecretString']
        try:
            secret_data = json.loads(secret_string)
            api_key = secret_data.get('api_key', secret_string)
        except json.JSONDecodeError:
            api_key = secret_string
        
        _secrets_cache[full_name] = api_key
        _secrets_cache_time[full_name] = current_time
        return api_key
    except Exception as e:
        logger.warning(f"Secret {secret_name} not found: {e}")
        return None


# =============================================================================
# AI Provider Clients with Web Search
# Note: These are simplified versions of the clients in lambda/search/api_clients.py.
# They live here because API Lambda bundling (createApiLambdaCode) only includes
# the handler file. Provider fallback is handled by search_with_fallback() instead
# of per-request retry logic.
# =============================================================================

class PerplexityClient:
    """Perplexity API client - best for keyword research due to native web search."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.perplexity.ai"
    
    def search(self, query: str, model: str = "sonar") -> Dict[str, Any]:
        """Execute search with web grounding."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": query}]
        }
        
        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=payload,
            timeout=90
        )
        response.raise_for_status()
        return response.json()


class OpenAIClient:
    """OpenAI API client with web search via Responses API."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.openai.com/v1"
    
    def search(self, query: str, model: str = "gpt-5-mini") -> Dict[str, Any]:
        """Execute search with web grounding."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model,
            "tools": [{"type": "web_search_preview"}],
            "tool_choice": "auto",
            "input": query
        }
        
        response = requests.post(
            f"{self.base_url}/responses",
            headers=headers,
            json=payload,
            timeout=90
        )
        response.raise_for_status()
        return response.json()


class GeminiClient:
    """Gemini API client with Google Search grounding."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"
        self.model = "gemini-2.0-flash"
    
    def search(self, query: str) -> Dict[str, Any]:
        """Execute search with Google Search grounding."""
        url = f"{self.base_url}/models/{self.model}:generateContent"
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        payload = {
            "contents": [{"role": "user", "parts": [{"text": query}]}],
            "tools": [{"googleSearch": {}}]
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=20)
        response.raise_for_status()
        return response.json()


def get_ai_client():
    """Get the best available AI client for keyword research.

    Returns a list of (client, provider_name) tuples ordered by preference.
    Skips providers with placeholder keys.
    """
    clients = []

    for secret_name, ClientClass, provider_name in [
        ('perplexity-key', PerplexityClient, 'perplexity'),
        ('openai-key', OpenAIClient, 'openai'),
        ('gemini-key', GeminiClient, 'gemini'),
    ]:
        key = get_secret(secret_name)
        if key and key != 'placeholder':
            clients.append((ClientClass(key), provider_name))

    # Return first working client for backwards compat, plus all as fallbacks
    if clients:
        return clients[0][0], clients[0][1], clients
    return None, None, []


def search_with_fallback(clients, prompt):
    """Try each provider in order, falling back on errors."""
    last_error = None
    for client, provider in clients:
        try:
            logger.info(f"Trying {provider}")
            raw_response = client.search(prompt)
            return raw_response, provider
        except Exception as e:
            logger.warning(f"{provider} failed: {e}")
            last_error = e
            continue
    raise last_error or Exception("All providers failed")


def extract_response_text(response: Dict, provider: str) -> str:
    """Extract text from provider response."""
    logger.info(f"Extracting response text from {provider}, response keys: {list(response.keys())}")
    
    if provider == 'perplexity':
        choices = response.get('choices', [])
        if not choices:
            logger.warning(f"Perplexity response has no choices: {response}")
            return ''
        content = choices[0].get('message', {}).get('content', '')
        logger.info(f"Perplexity content length: {len(content)}")
        return content
    elif provider == 'openai':
        output = response.get('output', [])
        for item in output:
            if item.get('type') == 'message':
                content = item.get('content', [])
                for c in content:
                    if c.get('type') == 'output_text':
                        return c.get('text', '')
        return response.get('output_text', '')
    elif provider == 'gemini':
        candidates = response.get('candidates', [])
        if candidates:
            parts = candidates[0].get('content', {}).get('parts', [])
            return ' '.join([p.get('text', '') for p in parts])
    return ''


# =============================================================================
# Page Scraping (fallback when AI web search doesn't have enough context)
# =============================================================================

def fetch_page_seo_elements(url: str) -> Dict[str, Any]:
    """
    Fetch a webpage and extract SEO-relevant elements.
    Used as supplementary data for AI analysis.
    """
    try:
        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        }
        
        response = requests.get(url, headers=headers, timeout=5, allow_redirects=True)
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
    'seed_keyword': {'required': True, 'type': str, 'max_length': 500, 'source': 'body'},
    'industry': {'type': str, 'max_length': 100, 'default': 'general', 'source': 'body'},
    'count': {'type': int, 'min': 1, 'max': 50, 'default': 20, 'source': 'body'}
})
def _expand_keywords(event: Dict[str, Any], context: Any, body: Dict, seed_keyword: str, industry: str, count: int) -> Dict[str, Any]:
    """
    POST /api/keyword-research/expand
    Starts async keyword expansion. Returns immediately with a pending record.
    """
    try:
        _, _, all_clients = get_ai_client()
        if not all_clients:
            return error_response("No API keys configured.", event, 400)

        # Create pending record
        research_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat() + 'Z'

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

        # Invoke self asynchronously
        function_name = os.environ.get('AWS_LAMBDA_FUNCTION_NAME', '')
        if function_name:
            lambda_client = boto3.client('lambda')
            try:
                lambda_client.invoke(
                    FunctionName=function_name,
                    InvocationType='Event',
                    Payload=json.dumps({
                        'async_expand': True,
                        'research_id': research_id,
                        'seed_keyword': seed_keyword,
                        'industry': industry,
                        'count': count,
                    })
                )
            except Exception as e:
                logger.error(f"Failed to trigger async expand: {e}")
                _process_expand_sync(research_id, seed_keyword, industry, count)
        else:
            _process_expand_sync(research_id, seed_keyword, industry, count)

        return success_response({
            'id': research_id,
            'seed_keyword': seed_keyword,
            'status': 'pending',
            'message': 'Keyword expansion started. Poll /history for results.',
        }, event, 202)

    except Exception as e:
        logger.error(f"Keyword expansion failed: {e}")
        return error_response(e, event)


@parse_json_body
@validate({
    'url': {'required': True, 'type': str, 'max_length': 2048, 'source': 'body'}
})
def _analyze_competitor(event: Dict[str, Any], context: Any, body: Dict, url: str) -> Dict[str, Any]:
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

    _, _, all_clients = get_ai_client()
    if not all_clients:
        return error_response("No API keys configured.", event, 400)

    # Create pending record
    research_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().isoformat() + 'Z'
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

    # Invoke self asynchronously
    function_name = os.environ.get('AWS_LAMBDA_FUNCTION_NAME', '')
    if function_name:
        lambda_client = boto3.client('lambda')
        try:
            lambda_client.invoke(
                FunctionName=function_name,
                InvocationType='Event',
                Payload=json.dumps({
                    'async_competitor': True,
                    'research_id': research_id,
                    'url': competitor_url,
                    'domain': domain,
                })
            )
            logger.info(f"Triggered async competitor analysis for {domain} (id={research_id})")
        except Exception as e:
            logger.error(f"Failed to trigger async competitor analysis: {e}")
            _process_competitor_sync(research_id, competitor_url, domain)
    else:
        _process_competitor_sync(research_id, competitor_url, domain)

    return success_response({
        'id': research_id,
        'url': competitor_url,
        'domain': domain,
        'status': 'pending',
        'message': 'Competitor analysis started. Poll /history or /status/{id} for results.',
    }, event, 202)


def _process_expand_sync(research_id: str, seed_keyword: str, industry: str, count: int):
    """Run keyword expansion synchronously (called from async invoke or fallback)."""
    try:
        logger.info(f"Processing keyword expansion for '{seed_keyword}' (id={research_id})")

        research_table.update_item(
            Key={'id': research_id},
            UpdateExpression='SET #s = :s',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': 'processing'},
        )

        _, _, all_clients = get_ai_client()
        if not all_clients:
            raise Exception("No API keys configured")

        prompt = f"""Search the web for keyword research data about "{seed_keyword}" in the {industry} industry.

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

        raw_response, provider = search_with_fallback(all_clients, prompt)
        response_text = extract_response_text(raw_response, provider)
        keywords = parse_keyword_json(response_text)

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
        logger.info(f"Keyword expansion complete: {len(keywords)} keywords for '{seed_keyword}'")

    except Exception as e:
        logger.error(f"Keyword expansion failed for '{seed_keyword}': {e}")
        try:
            research_table.update_item(
                Key={'id': research_id},
                UpdateExpression='SET #s = :s, error_message = :e',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':s': 'failed', ':e': str(e)[:500]},
            )
        except Exception:
            pass


def _process_competitor_sync(research_id: str, competitor_url: str, domain: str):
    """Run competitor analysis synchronously (called from async invoke or fallback)."""
    try:
        logger.info(f"Processing competitor analysis for {domain} (id={research_id})")

        research_table.update_item(
            Key={'id': research_id},
            UpdateExpression='SET #s = :s',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': 'processing'},
        )

        page_data = fetch_page_seo_elements(competitor_url)

        _, _, all_clients = get_ai_client()
        if not all_clients:
            raise Exception("No API keys configured")

        seo_context = ""
        if page_data.get('success'):
            seo_context = f"""
Page SEO Elements (from direct scrape):
- Title: {page_data.get('title', 'N/A')}
- Meta Description: {page_data.get('meta_description', 'N/A')}
- H1 Tags: {', '.join(page_data.get('h1_tags', [])[:3]) or 'N/A'}
- H2 Tags: {', '.join(page_data.get('h2_tags', [])[:5]) or 'N/A'}
"""

        prompt = f"""Search the web to find HIGH-TRAFFIC, NON-BRANDED, LONG-TAIL keywords that the website "{domain}" ranks for or should target.

{seo_context}

Find 20 keywords across these categories:
1. Primary Keywords (5): High-traffic product category searches
2. Secondary Keywords (5): Product comparison and "best of" searches
3. Long-tail Keywords (5): Specific product + feature + intent searches
4. Content Gaps (5): Keywords competitors rank for but this site might be missing

For each keyword provide: search intent, competition level, relevance score (1-10).

Return ONLY valid JSON:
{{
  "domain": "{domain}",
  "industry": "detected industry",
  "page_focus": "main business focus",
  "primary_keywords": [{{"keyword": "...", "intent": "commercial", "competition": "high", "relevance": 10, "source": "..."}}],
  "secondary_keywords": [{{"keyword": "...", "intent": "commercial", "competition": "medium", "relevance": 8, "source": "..."}}],
  "longtail_keywords": [{{"keyword": "...", "intent": "transactional", "competition": "low", "relevance": 9, "source": "..."}}],
  "content_gaps": [{{"keyword": "...", "intent": "commercial", "competition": "medium", "relevance": 7, "opportunity": "..."}}]
}}"""

        raw_response, provider = search_with_fallback(all_clients, prompt)
        response_text = extract_response_text(raw_response, provider)
        analysis = parse_competitor_json(response_text)

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
        try:
            research_table.update_item(
                Key={'id': research_id},
                UpdateExpression='SET #s = :s, error_message = :e',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':s': 'failed', ':e': str(e)[:500]},
            )
        except Exception:
            pass


@validate({
    'type': {'type': str, 'choices': ['expansion', 'competitor']},
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 20}
})
def _get_history(event: Dict[str, Any], context: Any, type: str = None, limit: int = 20) -> Dict[str, Any]:
    """GET /api/keyword-research/history - Get keyword research history."""
    try:
        scan_params = {'Limit': limit}
        
        if type:
            scan_params['FilterExpression'] = '#t = :type'
            scan_params['ExpressionAttributeNames'] = {'#t': 'type'}
            scan_params['ExpressionAttributeValues'] = {':type': type}
        
        response = research_table.scan(**scan_params)
        items = response.get('Items', [])
        
        # Sort by created_at descending
        items.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        
        # Remove raw_response from list view
        for item in items:
            item.pop('raw_response', None)
        
        return success_response({
            'items': items,
            'count': len(items)
        }, event)
        
    except Exception as e:
        logger.error(f"Failed to get history: {e}")
        return error_response(e, event)


def _delete_research(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """DELETE /api/keyword-research/{id} - Delete a research result."""
    path_params = event.get('pathParameters') or {}
    research_id = path_params.get('id')
    
    if not research_id:
        return validation_error('Research ID is required', event, 'id')
    
    try:
        research_table.delete_item(Key={'id': research_id})
        return success_response({'message': 'Research deleted successfully'}, event)
    except Exception as e:
        logger.error(f"Failed to delete research: {e}")
        return error_response(e, event)


@api_handler
@route_handler({
    ('POST', '/expand'): _expand_keywords,
    ('POST', '/competitor'): _analyze_competitor,
    ('GET', '/history'): _get_history,
    ('DELETE', None): _delete_research,
})
def _route_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Route handler for API Gateway requests."""
    pass  # Routes handle everything


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
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


def parse_keyword_json(text: str) -> List[Dict]:
    """Parse keyword JSON from AI response."""
    try:
        # Try to find JSON array in the response
        json_match = re.search(r'\[[\s\S]*\]', text)
        if json_match:
            return json.loads(json_match.group())
        return []
    except json.JSONDecodeError:
        logger.warning(f"Failed to parse keyword JSON: {text[:200]}")
        return []


def parse_competitor_json(text: str) -> Dict:
    """Parse competitor analysis JSON from AI response."""
    default_result = {
        'domain': '',
        'industry': 'unknown',
        'page_focus': '',
        'primary_keywords': [],
        'secondary_keywords': [],
        'longtail_keywords': [],
        'content_gaps': []
    }
    
    if not text or not text.strip():
        logger.warning("Empty response text from AI provider")
        return default_result
    
    logger.info(f"Parsing competitor JSON from response ({len(text)} chars): {text[:300]}...")
    
    try:
        # Step 1: Try to extract JSON from markdown code blocks (```json ... ```)
        code_block_match = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', text)
        if code_block_match:
            json_str = code_block_match.group(1)
            result = json.loads(json_str)
            logger.info(f"Parsed JSON from code block: {list(result.keys())}")
            return {**default_result, **result}
        
        # Step 2: Find first { and last } - most reliable for nested JSON
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1 and end > start:
            json_str = text[start:end + 1]
            result = json.loads(json_str)
            logger.info(f"Parsed JSON with bracket matching: {list(result.keys())}")
            return {**default_result, **result}
        
        logger.warning(f"No JSON object found in response: {text[:500]}")
        return default_result
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error: {e}. Response text: {text[:1000]}")
        return default_result
