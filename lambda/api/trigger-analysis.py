"""
Trigger Analysis API Lambda

Starts a Step Functions execution over every active keyword, passed as the
scope ``{"mode": "all"}``. The active keywords are only counted here (to
refuse an empty run and report the size): a ``Select='COUNT'`` query of the
StatusIndex GSI transfers no items, and it stops at the request's deadline,
in which case ``keywords_count`` is a lower bound and
``keywords_count_approximate`` is true. ParseKeywords resolves the scope
when the run starts.
"""

import logging
import os
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from shared.analysis_runs import fetch_enabled_query_prompts, scope_run_input, start_analysis_run
from shared.api_response import success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.bounded_counts import count_pages
from shared.decorators import api_handler
from shared.env_vars import resolve_table_env
from shared.keyword_groups import ACTIVE_KEYWORD_STATUS
from shared.request_deadline import current_deadline

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

stepfunctions = boto3.client('stepfunctions')
dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS')
# Query prompts table is optional — the analysis flow has a no-prompt fallback
# for deployments that haven't enabled the feature yet. Default mirrors the
# CDK stack's resource name for bootstrap deploys.
QUERY_PROMPTS_TABLE = resolve_table_env(
    'DYNAMODB_TABLE_QUERY_PROMPTS', required=False, default='CitationAnalysis-QueryPrompts',
)

keywords_table = dynamodb.Table(KEYWORDS_TABLE)
query_prompts_table = dynamodb.Table(QUERY_PROMPTS_TABLE)


# A row without keyword text is not run (ParseKeywords skips it), so it is not counted.
_HAS_TEXT = 'attribute_exists(#kw)'


def _scan_active_count() -> tuple[int, bool]:
    """``(count, complete)`` of the active keywords by filtered COUNT Scan (pre-StatusIndex deployments)."""
    return count_pages(
        keywords_table.scan,
        current_deadline(),
        FilterExpression=f'#status = :status AND {_HAS_TEXT}',
        ExpressionAttributeNames={'#status': 'status', '#kw': 'keyword'},
        ExpressionAttributeValues={':status': ACTIVE_KEYWORD_STATUS},
    )


def _active_keyword_count() -> tuple[int, bool]:
    """``(count, complete)`` of the active keywords from the StatusIndex GSI, or a Scan where the index is missing.

    ``complete`` is false when the request's deadline stopped the count; the
    count is then the keywords counted so far.
    """
    try:
        return count_pages(
            keywords_table.query,
            current_deadline(),
            IndexName='StatusIndex',
            KeyConditionExpression=Key('status').eq(ACTIVE_KEYWORD_STATUS),
            FilterExpression=_HAS_TEXT,
            ExpressionAttributeNames={'#kw': 'keyword'},
        )
    except (BotoCoreError, ClientError) as gsi_error:
        # Fallback to scan if GSI doesn't exist (for backwards compatibility)
        logger.warning('StatusIndex GSI not available, falling back to scan: %s', gsi_error)
        return _scan_active_count()


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

    There is no per-execution keyword cap. The active keywords are counted here
    only to refuse an empty run and to report the count: the execution input is
    the scope ``{"mode": "all"}``, which ParseKeywords resolves when the run
    starts and writes to S3 for the ProcessKeywords Distributed Map, so the
    input's size does not grow with the keyword count.
    """
    keyword_count, complete = _active_keyword_count()
    if not keyword_count and complete:
        return validation_error('No active keywords found. Please add keywords first.', event)

    query_prompts = fetch_enabled_query_prompts(query_prompts_table)
    started = start_analysis_run(
        stepfunctions, STATE_MACHINE_ARN, 'analysis', scope_run_input({'mode': 'all'}, query_prompts), keyword_count
    )

    counted = str(keyword_count) if complete else f'at least {keyword_count}'
    result = {
        **started,
        'keywords_count_approximate': not complete,
        'message': f'Analysis started with {counted} keywords and {len(query_prompts)} query prompts',
    }
    return success_response(result, event)
