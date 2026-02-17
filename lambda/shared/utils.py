"""Utility functions for Lambda functions."""

import json
import logging
import os
from typing import Dict, Any, Optional
from datetime import datetime
from urllib.parse import urlparse, parse_qs, urlencode

import boto3

# Set up logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# DynamoDB resource (lazy initialization)
_dynamodb = None


def _get_dynamodb():
    """Get DynamoDB resource (lazy initialization)."""
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource('dynamodb')
    return _dynamodb


def get_brand_config(table_name: str = None) -> Dict[str, Any]:
    """
    Get brand tracking configuration from DynamoDB.
    
    Args:
        table_name: Optional table name override. If not provided,
                   uses DYNAMODB_TABLE_BRAND_CONFIG environment variable.
    
    Returns:
        Brand configuration dictionary or empty dict if not found/error.
    """
    brand_config_table = table_name or os.environ.get('DYNAMODB_TABLE_BRAND_CONFIG')
    if not brand_config_table:
        return {}
    try:
        dynamodb = _get_dynamodb()
        table = dynamodb.Table(brand_config_table)
        response = table.get_item(Key={'config_id': 'default'})
        return response.get('Item', {})
    except Exception as e:
        logger.error(f"Error getting brand config: {e}")
        return {}


def normalize_url(url: str) -> str:
    """
    Normalize URL by removing tracking parameters.
    
    Args:
        url: Original URL with potential tracking parameters
        
    Returns:
        Normalized URL with tracking parameters removed
    """
    try:
        parsed = urlparse(url)
        
        # Remove tracking parameters
        query_params = parse_qs(parsed.query)
        tracking_params = [
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'msclkid', 'ref', 'source', '_ga', 'mc_cid', 'mc_eid'
        ]
        clean_params = {k: v for k, v in query_params.items() 
                       if k not in tracking_params}
        
        # Rebuild URL with domain + path + clean params
        clean_query = urlencode(clean_params, doseq=True)
        normalized = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        if clean_query:
            normalized += f"?{clean_query}"
        
        return normalized
    except Exception as e:
        logger.warning(f"Error normalizing URL {url}: {e}")
        return url


def get_timestamp() -> str:
    """Get current timestamp in ISO 8601 format."""
    return datetime.utcnow().isoformat() + 'Z'


def safe_json_dumps(obj: Any) -> str:
    """
    Safely serialize object to JSON string.
    
    Args:
        obj: Object to serialize
        
    Returns:
        JSON string
    """
    try:
        return json.dumps(obj, default=str)
    except Exception as e:
        logger.error(f"Error serializing to JSON: {e}")
        return json.dumps({"error": "serialization_failed"})


def safe_json_loads(json_str: str) -> Optional[Dict]:
    """
    Safely deserialize JSON string to object.
    
    Args:
        json_str: JSON string to deserialize
        
    Returns:
        Deserialized object or None if error
    """
    try:
        return json.loads(json_str)
    except Exception as e:
        logger.error(f"Error deserializing JSON: {e}")
        return None


def truncate_text(text: str, max_length: int = 10000) -> str:
    """
    Truncate text to maximum length.
    
    Args:
        text: Text to truncate
        max_length: Maximum length
        
    Returns:
        Truncated text
    """
    if len(text) <= max_length:
        return text
    return text[:max_length] + "... [truncated]"


def extract_domain(url: str) -> str:
    """
    Extract domain from URL.
    
    Args:
        url: URL to extract domain from
        
    Returns:
        Domain name
    """
    try:
        parsed = urlparse(url)
        return parsed.netloc
    except Exception:
        return "unknown"


def create_error_response(error_message: str, status_code: int = 500) -> Dict:
    """
    Create standardized error response.
    
    Args:
        error_message: Error message
        status_code: HTTP status code
        
    Returns:
        Error response dictionary
    """
    return {
        "statusCode": status_code,
        "body": json.dumps({
            "error": error_message,
            "timestamp": get_timestamp()
        })
    }


def create_success_response(data: Any, status_code: int = 200) -> Dict:
    """
    Create standardized success response.
    
    Args:
        data: Response data
        status_code: HTTP status code
        
    Returns:
        Success response dictionary
    """
    return {
        "statusCode": status_code,
        "body": json.dumps({
            "data": data,
            "timestamp": get_timestamp()
        }, default=str)
    }
