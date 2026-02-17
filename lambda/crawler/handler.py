"""
Crawler Lambda Function
Crawls cited pages using Bedrock AgentCore browser tools (no Playwright) and generates summaries.
"""

import json
import os
import logging
import time
from typing import Dict, Any, List, Optional
from datetime import datetime

import boto3

# Import shared modules from Lambda Layer
from shared.config import LambdaConfig
from shared.browser_tools import SimpleBrowserTools
from shared.step_function_response import (
    step_function_error, step_function_success, log_error
)

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Initialize config and clients
config = LambdaConfig()
dynamodb = boto3.resource('dynamodb', region_name=config.region)
bedrock_runtime = boto3.client('bedrock-runtime', region_name=config.region)

# Environment variables
SCREENSHOTS_BUCKET = os.environ['SCREENSHOTS_BUCKET']


def invoke_converse_with_retry(prompt: str, model_id: str, max_tokens: int = 1200, temperature: float = 0.3, max_retries: int = 5) -> str:
    """
    Invoke Bedrock Converse API with exponential backoff retry logic.
    
    Args:
        prompt: The prompt to send
        model_id: Model ID to invoke
        max_tokens: Maximum tokens in response
        temperature: Temperature for generation
        max_retries: Maximum number of retry attempts
        
    Returns:
        Response text from the model
    """
    import random
    
    for attempt in range(max_retries):
        try:
            response = bedrock_runtime.converse(
                modelId=model_id,
                messages=[
                    {'role': 'user', 'content': [{'text': prompt}]}
                ],
                inferenceConfig={
                    'maxTokens': max_tokens,
                    'temperature': temperature
                }
            )
            
            output = response.get('output', {})
            message = output.get('message', {})
            content_blocks = message.get('content', [])
            return content_blocks[0].get('text', '') if content_blocks else ''
            
        except Exception as e:
            error_str = str(e)
            
            # Check if it's a throttling error
            if 'ThrottlingException' in error_str or 'Too many requests' in error_str:
                if attempt < max_retries - 1:
                    # Exponential backoff with jitter
                    base_delay = 2 ** attempt
                    jitter = random.uniform(0, 1)
                    delay = base_delay + jitter
                    
                    logger.warning(f"Bedrock throttled (attempt {attempt + 1}/{max_retries}), waiting {delay:.2f}s")
                    time.sleep(delay)
                    continue
                else:
                    logger.error(f"Bedrock throttled after {max_retries} attempts")
                    raise
            else:
                # Non-throttling error, don't retry
                raise
    
    raise Exception(f"Failed after {max_retries} attempts")


def analyze_content_combined(content: str, title: str, url: str, keyword: str) -> tuple[str, Dict[str, Any]]:
    """
    Generate summary AND SEO analysis in a single Bedrock call.
    This reduces API calls by 50% and helps avoid throttling.
    
    Args:
        content: Page content
        title: Page title
        url: URL of the page
        keyword: Search keyword that led to this citation
        
    Returns:
        Tuple of (summary, seo_analysis_dict)
    """
    try:
        logger.info(f"Analyzing content (summary + SEO) for {url}")
        
        # Truncate content if too long
        max_content_length = 8000
        truncated_content = content[:max_content_length] if len(content) > max_content_length else content
        
        # Combined prompt for both summary and SEO analysis
        prompt = f"""Analyze this web page and provide both a summary and SEO analysis.

URL: {url}
Title: {title}
Search Keyword: "{keyword}"

Content:
{truncated_content}

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
        
        # Use retry logic with Converse API
        response_text = invoke_converse_with_retry(prompt, config.llm_model_id, max_tokens=1200, temperature=0.3)
        
        # Parse summary
        summary = ""
        if "SUMMARY:" in response_text:
            summary_start = response_text.find("SUMMARY:") + len("SUMMARY:")
            summary_end = response_text.find("SEO_ANALYSIS:")
            if summary_end == -1:
                summary_end = response_text.find("{")
            summary = response_text[summary_start:summary_end].strip()
        
        # Parse SEO analysis JSON
        seo_analysis = {}
        try:
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1
            if start_idx != -1 and end_idx > start_idx:
                json_str = response_text[start_idx:end_idx]
                seo_analysis = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.warning(f"Could not parse SEO JSON for {url}: {e}")
        
        logger.info(f"Combined analysis completed for {url}")
        return summary, seo_analysis
        
    except Exception as e:
        logger.error(f"Error in combined analysis for {url}: {e}")
        return "", {}


def summarize_content(content: str, url: str) -> str:
    """
    DEPRECATED: Use analyze_content_combined() instead.
    Kept for backward compatibility.
    """
    try:
        summary, _ = analyze_content_combined(content, "", url, "")
        return summary
    except Exception as e:
        logger.error(f"Error generating summary for {url}: {e}")
        return ""


def analyze_seo(content: str, title: str, url: str, keyword: str) -> Dict[str, Any]:
    """
    Analyze page for SEO and competitive intelligence using Claude.
    
    Args:
        content: Page content
        title: Page title
        url: URL of the page
        keyword: Search keyword that led to this citation
        
    Returns:
        Dictionary with SEO analysis and recommendations
    """
    try:
        logger.info(f"Analyzing SEO for {url}")
        
        # Truncate content
        max_content_length = 8000
        truncated_content = content[:max_content_length] if len(content) > max_content_length else content
        
        prompt = f"""Analyze this web page for SEO and competitive intelligence.

URL: {url}
Title: {title}
Search Keyword: "{keyword}"

Content:
{truncated_content}

Provide analysis in JSON format:
{{
  "relevance_score": 1-10,
  "keyword_usage": "description of how keyword is used",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "recommendations": ["action 1", "action 2", "action 3"],
  "competitive_advantage": "what makes this page rank well"
}}

JSON:"""
        
        response_text = invoke_converse_with_retry(prompt, config.llm_model_id, max_tokens=1000, temperature=0.2)
        
        # Parse JSON from response
        try:
            # Extract JSON from response
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1
            if start_idx != -1 and end_idx > start_idx:
                json_str = response_text[start_idx:end_idx]
                analysis = json.loads(json_str)
                logger.info(f"SEO analysis completed for {url}")
                return analysis
            else:
                logger.warning(f"Could not parse JSON from SEO analysis for {url}")
                return {}
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error in SEO analysis: {e}")
            return {}
        
    except Exception as e:
        logger.error(f"Error analyzing SEO for {url}: {e}")
        return {}


def upload_screenshot_to_s3(screenshot_base64: str, url: str, timestamp: str) -> str:
    """
    Upload screenshot to S3 with organized path structure.
    
    Args:
        screenshot_base64: Base64 encoded screenshot
        url: URL of the page
        timestamp: Timestamp of the crawl
        
    Returns:
        S3 URI of the uploaded screenshot
    """
    try:
        import base64
        from urllib.parse import urlparse
        
        # Decode base64
        screenshot_bytes = base64.b64decode(screenshot_base64)
        
        # Parse URL to create organized path
        parsed_url = urlparse(url)
        domain = parsed_url.netloc.replace('www.', '')
        
        # Create S3 key with date-based organization
        date_prefix = timestamp[:10]  # YYYY-MM-DD
        s3_key = f"screenshots/{date_prefix}/{domain}/{timestamp}.png"
        
        # Upload to S3
        s3_client = boto3.client('s3', region_name=config.region)
        
        s3_client.put_object(
            Bucket=SCREENSHOTS_BUCKET,
            Key=s3_key,
            Body=screenshot_bytes,
            ContentType='image/png',
            Metadata={
                'url': url,
                'timestamp': timestamp
            }
        )
        
        s3_uri = f"s3://{SCREENSHOTS_BUCKET}/{s3_key}"
        logger.info(f"Screenshot uploaded to {s3_uri}")
        
        return s3_uri
        
    except Exception as e:
        logger.error(f"Error uploading screenshot: {e}")
        return ""


def detect_blocked_page(content: str, title: str) -> tuple[bool, Optional[str]]:
    """
    Detect if page is a bot detection/CAPTCHA page.
    
    Args:
        content: Page content text
        title: Page title
        
    Returns:
        Tuple of (is_blocked, block_reason)
        block_reason is one of: captcha, access_denied, rate_limited, geo_blocked, login_required, empty_content
    """
    # Check for empty or near-empty content (likely blocked or failed to load)
    content_stripped = content.strip() if content else ''
    if len(content_stripped) < 100:
        return True, 'empty_content'
    
    combined_text = (content + ' ' + title).lower()
    
    # CAPTCHA indicators (these should only match if slider handling failed)
    captcha_indicators = [
        'captcha',
        'verify you are human',
        'verification required',
        'prove you are not a robot',
        'security check',
        'challenge-platform',
        'recaptcha',
        'hcaptcha',
        'slider verification',
        'slide right to secure',
        'slide to verify',
        'unusual activity',
        'automated (bot) activity',
        'we detected unusual activity',
    ]
    
    # Access denied indicators
    access_denied_indicators = [
        'access denied',
        '403 forbidden',
        'you have been blocked',
        'request blocked',
        'access to this page has been denied',
        'your access has been blocked',
    ]
    
    # Rate limiting indicators
    rate_limit_indicators = [
        'too many requests',
        'rate limit',
        'slow down',
        'try again later',
        'request limit exceeded',
        '429',
    ]
    
    # Geo-blocking indicators
    geo_block_indicators = [
        'not available in your region',
        'not available in your country',
        'geo-restricted',
        'content not available',
        'this content is not available in your location',
    ]
    
    # Login required indicators
    login_indicators = [
        'please log in',
        'please sign in',
        'login required',
        'sign in to continue',
        'create an account',
        'members only',
        'subscription required',
    ]
    
    # Check each category
    for indicator in captcha_indicators:
        if indicator in combined_text:
            return True, 'captcha'
    
    for indicator in access_denied_indicators:
        if indicator in combined_text:
            return True, 'access_denied'
    
    for indicator in rate_limit_indicators:
        if indicator in combined_text:
            return True, 'rate_limited'
    
    for indicator in geo_block_indicators:
        if indicator in combined_text:
            return True, 'geo_blocked'
    
    for indicator in login_indicators:
        if indicator in combined_text:
            return True, 'login_required'
    
    return False, None


def store_crawled_content(
    normalized_url: str,
    keyword: str,
    title: str,
    content: str,
    summary: str,
    citation_count: int,
    citing_providers: List[str],
    status: str,
    error_message: Optional[str] = None,
    page_load_time_ms: Optional[int] = None,
    content_length: Optional[int] = None,
    screenshot_s3_uri: Optional[str] = None,
    seo_analysis: Optional[Dict[str, Any]] = None,
    block_reason: Optional[str] = None
) -> None:
    """
    Store crawled content in DynamoDB.
    
    Args:
        normalized_url: Normalized URL of the crawled page
        keyword: Search keyword that led to this citation
        title: Page title
        content: Full page content
        summary: LLM-generated summary
        citation_count: Number of providers that cited this URL
        citing_providers: List of provider names that cited this URL
        status: Crawl status (success/blocked/error)
        error_message: Error message if status is error or blocked
        page_load_time_ms: Time taken to load the page
        content_length: Length of extracted content
        screenshot_s3_uri: S3 URI of the screenshot
        seo_analysis: SEO analysis results
        block_reason: Reason for block (captcha/access_denied/rate_limited/geo_blocked/login_required)
    """
    try:
        logger.info(f"Storing crawled content for {normalized_url}")
        
        table = dynamodb.Table(config.crawled_content_table)
        
        # Ensure keyword is not empty (required for GSI)
        if not keyword or keyword.strip() == '':
            keyword = 'unknown'
        
        item = {
            'normalized_url': normalized_url,
            'crawled_at': datetime.utcnow().isoformat() + 'Z',
            'keyword': keyword,
            'title': title,
            'content': content,
            'summary': summary,
            'citation_count': citation_count,
            'citing_providers': citing_providers,
            'status': status
        }
        
        # Add metadata if available
        if page_load_time_ms is not None or content_length is not None:
            item['metadata'] = {}
            if page_load_time_ms is not None:
                item['metadata']['page_load_time_ms'] = page_load_time_ms
            if content_length is not None:
                item['metadata']['content_length'] = content_length
        
        # Add error message if present
        if error_message:
            item['error_message'] = error_message
        
        # Add block reason if present
        if block_reason:
            item['block_reason'] = block_reason
        
        # Add screenshot S3 URI if present
        if screenshot_s3_uri:
            item['screenshot_s3_uri'] = screenshot_s3_uri
        
        # Add SEO analysis if present
        if seo_analysis:
            item['seo_analysis'] = seo_analysis
        
        table.put_item(Item=item)
        logger.info(f"Successfully stored crawled content for {normalized_url}")
        
    except Exception as e:
        logger.error(f"Error storing crawled content for {normalized_url}: {e}")
        raise


def crawl_citation(citation: Dict[str, Any]) -> Dict[str, Any]:
    """
    Crawl a single citation using browser tools (synchronous - no Playwright).
    
    Args:
        citation: Citation details including URL and metadata
        
    Returns:
        Dictionary with crawl results
    """
    url = citation.get('normalized_url')
    keyword = citation.get('keyword', '')
    citation_count = citation.get('citation_count', 0)
    citing_providers = citation.get('citing_providers', [])
    
    logger.info(f"Starting crawl for {url}")
    
    browser_tools = SimpleBrowserTools(config)
    start_time = time.time()
    
    try:
        # Create and initialize browser
        browser_tools.create_browser()
        browser_tools.initialize_browser_session()
        
        # Navigate to URL
        nav_result = browser_tools.navigate_to_url(url)
        
        if nav_result["status"] != "success":
            # Navigation failed
            error_msg = nav_result.get('error', 'Navigation failed')
            logger.error(f"Navigation failed for {url}: {error_msg}")
            
            # Store error status
            store_crawled_content(
                normalized_url=url,
                keyword=keyword,
                title='',
                content='',
                summary='',
                citation_count=citation_count,
                citing_providers=citing_providers,
                status='error',
                error_message=error_msg
            )
            
            return {
                'url': url,
                'status': 'error',
                'error': error_msg
            }
        
        # Calculate page load time
        page_load_time_ms = int((time.time() - start_time) * 1000)
        
        # Extract content
        content_result = browser_tools.extract_page_content()
        
        if content_result["status"] != "success":
            # Content extraction failed
            error_msg = content_result.get('error', 'Content extraction failed')
            logger.error(f"Content extraction failed for {url}: {error_msg}")
            
            # Store error status
            store_crawled_content(
                normalized_url=url,
                keyword=keyword,
                title=nav_result.get('title', ''),
                content='',
                summary='',
                citation_count=citation_count,
                citing_providers=citing_providers,
                status='error',
                error_message=error_msg,
                page_load_time_ms=page_load_time_ms
            )
            
            return {
                'url': url,
                'status': 'error',
                'error': error_msg
            }
        
        # Extract data from results
        title = content_result.get('title', '')
        content = content_result.get('content', '')
        content_length = content_result.get('content_length', 0)
        
        logger.info(f"Successfully extracted content from {url} ({content_length} chars)")
        
        # Take screenshot
        screenshot_s3_uri = None
        screenshot_result = browser_tools.take_screenshot()
        if screenshot_result["status"] == "success":
            timestamp = datetime.utcnow().isoformat() + 'Z'
            screenshot_s3_uri = upload_screenshot_to_s3(
                screenshot_result["screenshot_base64"],
                url,
                timestamp
            )
        else:
            logger.warning(f"Screenshot failed for {url}: {screenshot_result.get('error')}")
        
        # Check if page is blocked by bot detection
        is_blocked, block_reason = detect_blocked_page(content, title)
        
        if is_blocked:
            logger.warning(f"Page blocked for {url}: {block_reason}")
            
            # Store blocked status with screenshot (evidence of block page)
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
                block_reason=block_reason
            )
            
            return {
                'url': url,
                'status': 'blocked',
                'block_reason': block_reason
            }
        
        # Generate summary AND SEO analysis in single Bedrock call (reduces API calls by 50%)
        summary, seo_analysis = analyze_content_combined(content, title, url, keyword)
        
        # Store crawled content
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
            seo_analysis=seo_analysis
        )
        
        # Return minimal data to avoid Step Functions 256KB limit
        # Full data is already stored in DynamoDB
        return {
            'url': url,
            'status': 'success'
        }
        
    except Exception as e:
        logger.error(f"Error crawling {url}: {e}")
        
        # Store error status
        try:
            store_crawled_content(
                normalized_url=url,
                keyword=keyword,
                title='',
                content='',
                summary='',
                citation_count=citation_count,
                citing_providers=citing_providers,
                status='error',
                error_message=str(e)
            )
        except Exception as store_error:
            logger.error(f"Failed to store error status: {store_error}")
        
        return {
            'url': url,
            'status': 'error',
            'error': str(e)
        }
        
    finally:
        # Clean up browser resources
        browser_tools.cleanup()


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for crawling individual citations.
    
    Args:
        event: Input event containing citation details
        context: Lambda context object
        
    Returns:
        Dictionary containing crawled content and metadata
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    citation = event.get('citation', {})
    url = citation.get('normalized_url')
    
    if not url:
        error = ValueError("Missing required parameter: normalized_url")
        log_error(error, "crawler handler", event)
        raise error
    
    try:
        # Run crawl function (synchronous - no async needed)
        result = crawl_citation(citation)
        
        logger.info(f"Crawl completed for {url}: {result.get('status')}")
        
        return result
        
    except Exception as e:
        log_error(e, f"crawling URL {url}", event)
        raise
