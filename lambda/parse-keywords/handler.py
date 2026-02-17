"""
ParseKeywords Lambda Function

Reads keywords from S3 or direct input, validates them, and returns
an array of keywords with timestamps for processing.

Requirements: 2.1, 2.2, 2.3, 2.4
"""

import json
import logging
import boto3
from datetime import datetime
from typing import Dict, List, Any
from urllib.parse import urlparse

from shared.step_function_response import (
    step_function_error, step_function_success, log_error
)

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')


def parse_s3_uri(s3_uri: str) -> tuple:
    """Parse S3 URI into bucket and key."""
    parsed = urlparse(s3_uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip('/')
    return bucket, key


def read_keywords_from_s3(s3_uri: str) -> List[str]:
    """Read keywords from S3 file (one per line)."""
    bucket, key = parse_s3_uri(s3_uri)
    
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read().decode('utf-8')
        
        # Parse keywords (one per line)
        keywords = [line.strip() for line in content.split('\n')]
        
        return keywords
    except Exception as e:
        raise Exception(f"Failed to read keywords from S3: {s3_uri}. Error: {str(e)}")


def validate_keywords(keywords: List) -> List[str]:
    """Validate keywords are non-empty strings or dicts with 'keyword' field."""
    valid_keywords = []
    
    for keyword in keywords:
        # Handle dict format (from DynamoDB/API with timestamp)
        if isinstance(keyword, dict):
            keyword_text = keyword.get('keyword', '')
        else:
            keyword_text = keyword
        
        # Skip empty lines and whitespace-only lines
        if not keyword_text or not keyword_text.strip():
            continue
        
        # Skip comment lines (starting with #)
        stripped = keyword_text.strip()
        if stripped.startswith('#'):
            continue
        
        valid_keywords.append(stripped)
    
    return valid_keywords


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for parsing keywords.
    
    Input formats:
    1. S3 URI: {"keywords_file": "s3://bucket/path/keywords.txt"}
    2. Direct array: {"keywords": ["keyword1", "keyword2"]}
    3. Direct string: {"keywords": "keyword1\nkeyword2"}
    
    Output:
    {
        "keywords": [
            {"keyword": "best hotels in malaga", "timestamp": "2025-01-15T10:30:00Z"},
            {"keyword": "top restaurants paris", "timestamp": "2025-01-15T10:30:00Z"}
        ]
    }
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        keywords = []
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Case 1: Keywords from S3 file
        if 'keywords_file' in event:
            s3_uri = event['keywords_file']
            logger.info(f"Reading keywords from S3: {s3_uri}")
            keywords = read_keywords_from_s3(s3_uri)
        
        # Case 2: Direct keywords array
        elif 'keywords' in event and isinstance(event['keywords'], list):
            logger.info("Using keywords from direct array input")
            keywords = event['keywords']
        
        # Case 3: Direct keywords string (newline-separated)
        elif 'keywords' in event and isinstance(event['keywords'], str):
            logger.info("Parsing keywords from string input")
            keywords = event['keywords'].split('\n')
        
        else:
            error = ValueError("Invalid input: must provide 'keywords_file' (S3 URI) or 'keywords' (array/string)")
            log_error(error, "parse keywords handler", event)
            raise error
        
        # Validate keywords
        valid_keywords = validate_keywords(keywords)
        
        if not valid_keywords:
            error = ValueError("No valid keywords found. Keywords must be non-empty strings.")
            log_error(error, "parse keywords validation", event)
            raise error
        
        # Limit to 100 keywords per execution (Requirement 2.4)
        if len(valid_keywords) > 100:
            logger.warning(f"{len(valid_keywords)} keywords provided, limiting to 100")
            valid_keywords = valid_keywords[:100]
        
        # Format output with timestamps
        result = {
            "keywords": [
                {
                    "keyword": keyword,
                    "timestamp": timestamp
                }
                for keyword in valid_keywords
            ]
        }
        
        logger.info(f"Successfully parsed {len(valid_keywords)} keywords")
        
        return result
        
    except Exception as e:
        log_error(e, "parse keywords handler", event)
        raise
