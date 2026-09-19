"""
Trigger Analysis API Lambda

Starts a Step Functions execution with keywords from DynamoDB.
Uses efficient query with StatusIndex GSI instead of scan with filter.
"""

import logging
import os
import sys
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.analysis_runs import fetch_enabled_query_prompts, start_analysis_run
from shared.api_response import success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.decorators import api_handler
from shared.env_vars import resolve_table_env
from shared.keyword_groups import query_active_keywords

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

stepfunctions = boto3.client('stepfunctions')
dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
# Query prompts table is optional — the analysis flow has a no-prompt fallback
# for deployments that haven't enabled the feature yet. Default mirrors the
# CDK stack's resource name for bootstrap deploys.
QUERY_PROMPTS_TABLE = resolve_table_env(
    'DYNAMODB_TABLE_QUERY_PROMPTS', 'QUERY_PROMPTS_TABLE',
    required=False, default='CitationAnalysis-QueryPrompts',
)

keywords_table = dynamodb.Table(KEYWORDS_TABLE)
query_prompts_table = dynamodb.Table(QUERY_PROMPTS_TABLE)


def _scan_active_keywords() -> list[dict[str, Any]]:
    """Every active keyword item by filtered Scan, following pagination (pre-StatusIndex deployments)."""
    keywords: list[dict[str, Any]] = []
    scan_params: dict[str, Any] = {
        'FilterExpression': '#status = :status',
        'ExpressionAttributeNames': {'#status': 'status'},
        'ExpressionAttributeValues': {':status': 'active'},
    }
    while True:
        response = keywords_table.scan(**scan_params)
        keywords.extend(response.get('Items', []))
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return keywords
        scan_params['ExclusiveStartKey'] = last_key


def _active_keywords() -> list[dict[str, Any]]:
    """Active keyword items from the StatusIndex GSI, falling back to a Scan where the index is missing."""
    try:
        return query_active_keywords(keywords_table)
    except (BotoCoreError, ClientError) as gsi_error:
        # Fallback to scan if GSI doesn't exist (for backwards compatibility)
        logger.warning(f"StatusIndex GSI not available, falling back to scan: {gsi_error}")
        return _scan_active_keywords()


@api_handler
@require_group(ADMIN_GROUP)
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    POST /api/trigger-analysis

    Starts a Step Functions execution with active keywords from DynamoDB.
    Uses StatusIndex GSI for efficient querying of active keywords.

    Admin-only. One request fans out every active keyword x 10 personas x 4 paid
    providers, plus a Bedrock call per crawled page, so an ungated caller in a
    loop is unbounded spend (AUDIT-2026-08-19 §2.3). The gate is the authz half
    of that finding; throttling and idempotency are tracked separately.

    There is no per-execution keyword cap: every active keyword is included
    (StatusIndex is read to the last page) and the ProcessKeywords Map bounds
    concurrency.
    """
    keywords = _active_keywords()
    if not keywords:
        return validation_error('No active keywords found. Please add keywords first.', event)

    keyword_texts = [kw['keyword'] for kw in keywords if kw.get('keyword')]
    query_prompts = fetch_enabled_query_prompts(query_prompts_table)
    started = start_analysis_run(stepfunctions, STATE_MACHINE_ARN, 'analysis', keyword_texts, query_prompts)

    result = {
        **started,
        'message': f'Analysis started with {len(keyword_texts)} keywords and {len(query_prompts)} query prompts',
    }
    return success_response(result, event)
