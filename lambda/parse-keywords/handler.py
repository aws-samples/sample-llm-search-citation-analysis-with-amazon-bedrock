"""
ParseKeywords Lambda Function

Reads keywords from a scope, S3 or direct input, validates them, writes the
run's keyword list (with one run timestamp) to S3 and returns a pointer to it
for the ProcessKeywords Distributed Map. There is no per-execution cap: the
former silent truncation to 100 dropped keywords for multi-group installations.

Requirements: 2.1, 2.2, 2.3, 2.4
"""

import json
import logging
import os
from typing import Any
from urllib.parse import urlparse

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from shared.analysis_runs import query_prompt_from_item
from shared.keyword_groups import describe_scope, resolve_scope, validate_scope
from shared.step_function_response import log_error

# Configure logging
from shared.utils import get_timestamp, get_timestamp_compact

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Fail-fast: every run writes its keyword manifest here (see write_keywords_manifest).
KEYWORDS_BUCKET = os.environ['KEYWORDS_BUCKET']
# Per-run scratch prefix, shared with the ProcessKeywords ResultWriter output
# and expired by the keywords bucket's lifecycle rule.
RUNS_PREFIX = 'runs/'

KEYWORDS_TABLE = (
    os.environ.get('DYNAMODB_TABLE_KEYWORDS')
    or 'CitationAnalysis-Keywords'
)

QUERY_PROMPTS_TABLE = (
    os.environ.get('DYNAMODB_TABLE_QUERY_PROMPTS')
    or 'CitationAnalysis-QueryPrompts'
)


class QueryPromptReadError(Exception):
    """Raised when enabled query prompts cannot be read from DynamoDB."""


def read_enabled_query_prompts() -> list[dict[str, Any]]:
    """
    Read enabled query prompts from DynamoDB.

    Used for executions whose input does not carry query prompts (e.g.
    EventBridge schedules, which bake their input at creation time). Resolving
    prompts here keeps scheduled runs in sync with the current configuration.

    Fails CLOSED on read errors. This function is the sole prompt source for
    schedule-triggered executions, and it used to return `[]` on any exception:
    a transient DynamoDB throttle made the whole nightly run execute with
    **zero personas**, complete, write rows, and report success — leaving a
    hole in the time series indistinguishable from "no personas were configured
    then" (AUDIT-2026-08-19 §2.12). A failed run is recoverable; silently wrong
    data is not. `is_provider_enabled` was changed to fail closed for exactly
    this class of failure, so this matches that precedent.

    The one exception is a missing table or index, which means the persona
    feature is not provisioned in this deployment — a configuration state
    rather than a failure, so an empty list is the honest answer there.

    Returns:
        The enabled prompts, or `[]` when the feature is not provisioned.

    Raises:
        QueryPromptReadError: When the prompts exist but could not be read.
    """
    try:
        table = dynamodb.Table(QUERY_PROMPTS_TABLE)
        response = table.query(
            IndexName='EnabledIndex',
            KeyConditionExpression=Key('enabled').eq('true'),
            Limit=10
        )
    except ClientError as e:
        if e.response.get('Error', {}).get('Code') == 'ResourceNotFoundException':
            logger.warning(
                "Query prompts table or EnabledIndex not present (%s); "
                "treating the persona feature as unprovisioned.",
                QUERY_PROMPTS_TABLE,
            )
            return []
        raise QueryPromptReadError(
            f"Could not read enabled query prompts from {QUERY_PROMPTS_TABLE}"
        ) from e
    except Exception as e:
        raise QueryPromptReadError(
            f"Could not read enabled query prompts from {QUERY_PROMPTS_TABLE}"
        ) from e

    prompts = [query_prompt_from_item(item) for item in response.get('Items', [])]
    logger.info(f"Read {len(prompts)} enabled query prompts from DynamoDB")
    return prompts


def resolve_query_prompts(event: dict[str, Any]) -> list:
    """Pass through query prompts from the execution input, or load enabled ones."""
    prompts = event.get('query_prompts')
    if isinstance(prompts, list):
        return prompts
    return read_enabled_query_prompts()


def read_keywords_from_dynamodb() -> list[str]:
    """Read active keywords from DynamoDB Keywords table (every page)."""
    return read_keywords_for_scope({'mode': 'all'})


def read_keywords_for_scope(scope: dict[str, Any]) -> list[str]:
    """Resolve a scope descriptor (all / groups / keyword ids) to active keyword texts.

    Resolution happens at run time, so a schedule that targets a keyword group
    picks up keywords added to the group after the schedule was created.
    """
    try:
        table = dynamodb.Table(KEYWORDS_TABLE)
        items = resolve_scope(scope, table)
    except Exception as e:
        raise RuntimeError(f"Failed to read keywords from DynamoDB: {e!s}") from e

    keywords = [item['keyword'] for item in items]
    logger.info(f"Resolved {len(keywords)} active keywords for {describe_scope(scope)}")
    return keywords


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
        return [line.strip() for line in content.split('\n')]
    except Exception as e:
        raise RuntimeError(f"Failed to read keywords from S3: {s3_uri}. Error: {e!s}") from e


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


def _keywords_for_scope_event(event: dict[str, Any]) -> list[str]:
    """Case 0: a scope descriptor (group-aware schedules), resolved at run time."""
    scope, scope_error = validate_scope(event.get('scope'))
    if scope is None:
        error = ValueError(f"Invalid scope: {scope_error}")
        log_error(error, "parse keywords handler", event)
        raise error
    logger.info(f"Resolving keywords for scope {describe_scope(scope)}")
    return read_keywords_for_scope(scope)


def _keywords_from_event(event: dict[str, Any]) -> list:
    """Load the raw keywords from whichever source the event names.

    Raises ``ValueError`` when the event names none of the supported sources,
    or carries an invalid scope.
    """
    if 'scope' in event:
        return _keywords_for_scope_event(event)

    # Case 1: Keywords from DynamoDB (scheduled runs)
    if event.get('source') == 'dynamodb':
        logger.info("Reading active keywords from DynamoDB (scheduled run)")
        return read_keywords_from_dynamodb()

    # Case 2: Keywords from S3 file
    if 'keywords_file' in event:
        s3_uri = event['keywords_file']
        logger.info(f"Reading keywords from S3: {s3_uri}")
        return read_keywords_from_s3(s3_uri)

    # Case 3: Direct keywords array
    if 'keywords' in event and isinstance(event['keywords'], list):
        logger.info("Using keywords from direct array input")
        return event['keywords']

    # Case 4: Direct keywords string (newline-separated)
    if 'keywords' in event and isinstance(event['keywords'], str):
        logger.info("Parsing keywords from string input")
        return event['keywords'].split('\n')

    error = ValueError("Invalid input: must provide 'scope', 'source': 'dynamodb', 'keywords_file' (S3 URI), or 'keywords' (array/string)")
    log_error(error, "parse keywords handler", event)
    raise error


def _valid_keywords_from_event(event: dict[str, Any]) -> list[str]:
    """The event's keywords, validated; raises ``ValueError`` when none survive validation."""
    valid_keywords = validate_keywords(_keywords_from_event(event))
    if not valid_keywords:
        error = ValueError("No valid keywords found. Keywords must be non-empty strings.")
        log_error(error, "parse keywords validation", event)
        raise error
    return valid_keywords


def _unwrap_event(event: dict[str, Any], context: Any) -> tuple[dict[str, Any], str]:
    """Split the task payload into ``(execution input, execution name)``.

    The state machine sends ``{"execution_input": $, "execution_name": $$.Execution.Name}``.
    A direct invocation (console, tests) sends the bare execution input, and
    its manifest is filed under the invocation's request id instead.
    """
    execution_input = event.get('execution_input')
    if isinstance(execution_input, dict):
        return execution_input, str(event.get('execution_name') or _direct_invocation_name(context))
    return event, _direct_invocation_name(context)


def _direct_invocation_name(context: Any) -> str:
    request_id = getattr(context, 'aws_request_id', None)
    return str(request_id) if request_id else f"direct-{get_timestamp_compact()}"


def write_keywords_manifest(execution_name: str, keywords: list[str], timestamp: str) -> dict[str, str]:
    """Write the run's keyword list to S3 for the ProcessKeywords Distributed Map to read.

    The list lives in S3 rather than in the state because state is capped at
    256 KiB: at ~100 bytes a keyword (560 at the 500-character maximum) the
    inline list alone put a ceiling of a few thousand keywords on a run.
    ``runs/`` objects are scratch and expire through the bucket's lifecycle rule.
    """
    key = f"{RUNS_PREFIX}{execution_name}/keywords.json"
    body = json.dumps([{'keyword': keyword, 'timestamp': timestamp} for keyword in keywords])
    s3_client.put_object(Bucket=KEYWORDS_BUCKET, Key=key, Body=body, ContentType='application/json')
    logger.info(f"Wrote {len(keywords)} keywords to s3://{KEYWORDS_BUCKET}/{key}")
    return {'bucket': KEYWORDS_BUCKET, 'key': key}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda handler for parsing keywords.

    Payload from the state machine:
        {"execution_input": <the execution input>, "execution_name": "<execution name>"}
    A direct invocation may send the execution input itself.

    Execution input formats:
    1. Scope descriptor (trigger APIs, schedules; run-time resolution):
       {"scope": {"mode": "all" | "groups" | "keywords", ...}}
    2. Legacy scheduled runs: {"source": "dynamodb"} (all active keywords)
    3. S3 URI: {"keywords_file": "s3://bucket/path/keywords.txt"}
    4. Direct array: {"keywords": ["keyword1", "keyword2"]}
    5. Direct string: {"keywords": "keyword1\nkeyword2"}

    An optional "query_prompts" list in the input is passed through to the
    output. When absent (scheduled runs), enabled prompts are loaded from
    DynamoDB instead.

    The keywords are written to ``runs/<execution name>/keywords.json`` in the
    keywords bucket as ``[{"keyword", "timestamp"}, ...]``; the output names
    that object instead of carrying the list, so the state stays the same size
    however many keywords the run covers.

    Output:
    {
        "keywords_manifest": {"bucket": "citation-analysis-keywords-123", "key": "runs/analysis-20250115103000/keywords.json"},
        "keyword_count": 2,
        "timestamp": "2025-01-15T10:30:00Z",
        "query_prompts": [
            {"id": "prompt-1", "name": "Family Traveler", "template": "As a family traveler, find {keyword}"}
        ]
    }
    """
    logger.info(f"Received event: {json.dumps(event)}")
    execution_input, execution_name = _unwrap_event(event, context)

    try:
        timestamp = get_timestamp()
        valid_keywords = _valid_keywords_from_event(execution_input)

        # query_prompts is always emitted so the ProcessKeywords Map state can
        # select it from this state's output, regardless of whether the
        # execution input carried prompts (API triggers do, EventBridge
        # schedules do not).
        result = {
            "keywords_manifest": write_keywords_manifest(execution_name, valid_keywords, timestamp),
            "keyword_count": len(valid_keywords),
            "timestamp": timestamp,
            "query_prompts": resolve_query_prompts(execution_input),
        }

        logger.info(f"Successfully parsed {len(valid_keywords)} keywords")
    except Exception as e:
        log_error(e, "parse keywords handler", execution_input)
        raise

    return result
