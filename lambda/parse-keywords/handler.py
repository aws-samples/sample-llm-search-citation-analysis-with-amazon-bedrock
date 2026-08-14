"""
ParseKeywords Lambda Function

Reads keywords from S3 or direct input, validates them, and returns
an array of keywords with timestamps for processing.

Requirements: 2.1, 2.2, 2.3, 2.4
"""

import json
import logging
import os
from typing import Any
from urllib.parse import urlparse

import boto3
from boto3.dynamodb.conditions import Key

from shared.step_function_response import log_error

# Configure logging
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

KEYWORDS_TABLE = (
    os.environ.get('DYNAMODB_TABLE_KEYWORDS')
    or os.environ.get('KEYWORDS_TABLE')
    or 'CitationAnalysis-Keywords'
)

QUERY_PROMPTS_TABLE = (
    os.environ.get('DYNAMODB_TABLE_QUERY_PROMPTS')
    or os.environ.get('QUERY_PROMPTS_TABLE')
    or 'CitationAnalysis-QueryPrompts'
)


def read_enabled_query_prompts() -> list[dict[str, str]]:
    """
    Read enabled query prompts from DynamoDB.

    Used for executions whose input does not carry query prompts (e.g.
    EventBridge schedules, which bake their input at creation time). Resolving
    prompts here keeps scheduled runs in sync with the current configuration.
    """
    try:
        table = dynamodb.Table(QUERY_PROMPTS_TABLE)
        response = table.query(
            IndexName='EnabledIndex',
            KeyConditionExpression=Key('enabled').eq('true'),
            Limit=10
        )
        prompts = [
            {
                'id': item['id'],
                'name': item.get('name', ''),
                'template': item.get('template', ''),
            }
            for item in response.get('Items', [])
        ]
        logger.info(f"Read {len(prompts)} enabled query prompts from DynamoDB")
        return prompts
    except Exception as e:
        logger.warning(f"Could not fetch query prompts, proceeding without them: {e}")
        return []


def resolve_query_prompts(event: dict[str, Any]) -> list:
    """Pass through query prompts from the execution input, or load enabled ones."""
    prompts = event.get('query_prompts')
    if isinstance(prompts, list):
        return prompts
    return read_enabled_query_prompts()


def read_keywords_from_dynamodb() -> list[str]:
    """Read active keywords from DynamoDB Keywords table."""
    try:
        table = dynamodb.Table(KEYWORDS_TABLE)
        response = table.query(
            IndexName='StatusIndex',
            KeyConditionExpression=Key('status').eq('active')
        )
        keywords = [item['keyword'] for item in response.get('Items', []) if item.get('keyword')]
        logger.info(f"Read {len(keywords)} active keywords from DynamoDB")
        return keywords
    except Exception as e:
        raise Exception(f"Failed to read keywords from DynamoDB: {e!s}") from e


def parse_s3_uri(s3_uri: str) -> tuple:
    """Parse S3 URI into bucket and key."""
    parsed = urlparse(s3_uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip('/')
    return bucket, key


def read_keywords_from_s3(s3_uri: str) -> list[str]:
    """Read keywords from S3 file (one per line)."""
    bucket, key = parse_s3_uri(s3_uri)

    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read().decode('utf-8')

        # Parse keywords (one per line)
        keywords = [line.strip() for line in content.split('\n')]

        return keywords
    except Exception as e:
        raise Exception(f"Failed to read keywords from S3: {s3_uri}. Error: {e!s}") from e


def validate_keywords(keywords: list) -> list[str]:
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


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for parsing keywords.

    Input formats:
    1. S3 URI: {"keywords_file": "s3://bucket/path/keywords.txt"}
    2. Direct array: {"keywords": ["keyword1", "keyword2"]}
    3. Direct string: {"keywords": "keyword1\nkeyword2"}

    An optional "query_prompts" list in the input is passed through to the
    output. When absent (scheduled runs), enabled prompts are loaded from
    DynamoDB instead.

    Output:
    {
        "keywords": [
            {"keyword": "best hotels in malaga", "timestamp": "2025-01-15T10:30:00Z"},
            {"keyword": "top restaurants paris", "timestamp": "2025-01-15T10:30:00Z"}
        ],
        "query_prompts": [
            {"id": "prompt-1", "name": "Family Traveler", "template": "As a family traveler, find {keyword}"}
        ]
    }
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        keywords = []
        timestamp = get_timestamp()

        # Case 1: Keywords from DynamoDB (scheduled runs)
        if event.get('source') == 'dynamodb':
            logger.info("Reading active keywords from DynamoDB (scheduled run)")
            keywords = read_keywords_from_dynamodb()

        # Case 2: Keywords from S3 file
        elif 'keywords_file' in event:
            s3_uri = event['keywords_file']
            logger.info(f"Reading keywords from S3: {s3_uri}")
            keywords = read_keywords_from_s3(s3_uri)

        # Case 3: Direct keywords array
        elif 'keywords' in event and isinstance(event['keywords'], list):
            logger.info("Using keywords from direct array input")
            keywords = event['keywords']

        # Case 4: Direct keywords string (newline-separated)
        elif 'keywords' in event and isinstance(event['keywords'], str):
            logger.info("Parsing keywords from string input")
            keywords = event['keywords'].split('\n')

        else:
            error = ValueError("Invalid input: must provide 'source': 'dynamodb', 'keywords_file' (S3 URI), or 'keywords' (array/string)")
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

        # Format output with timestamps. query_prompts is always emitted so the
        # ProcessKeywords Map state can select it from this state's output,
        # regardless of whether the execution input carried prompts (API
        # triggers do, EventBridge schedules do not).
        result = {
            "keywords": [
                {
                    "keyword": keyword,
                    "timestamp": timestamp
                }
                for keyword in valid_keywords
            ],
            "query_prompts": resolve_query_prompts(event)
        }

        logger.info(f"Successfully parsed {len(valid_keywords)} keywords")

        return result

    except Exception as e:
        log_error(e, "parse keywords handler", event)
        raise
