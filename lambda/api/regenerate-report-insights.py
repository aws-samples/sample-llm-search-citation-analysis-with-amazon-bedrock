"""
Regenerate a group's narrative — POST /api/reports/insights/regenerate

Body: ``{"group_id": "<id>"}``. Admin only (``@require_group(ADMIN_GROUP)``):
writing a narrative spends one Bedrock call. The group must have an active
keyword. The ReportInsights worker (``lambda/report-insights``) is invoked
asynchronously for the group's latest runs and the request answers 202 at
once; the report polls ``GET /api/reports/insights`` until the narrative's
``generated_at`` changes.
"""

import json
import os
from typing import Any

import boto3

from shared.api_response import api_response, success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.decorators import api_handler, parse_json_body, validate
from shared.keyword_groups import MAX_GROUP_ID_LENGTH, resolve_scope
from shared.scope_params import keywords_table_name
from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async

REPORT_INSIGHTS_FUNCTION = os.environ['REPORT_INSIGHTS_FUNCTION_NAME']
KEYWORDS_TABLE = keywords_table_name()

dynamodb = boto3.resource('dynamodb')
lambda_client = boto3.client('lambda')


@api_handler
@require_group(ADMIN_GROUP)
@parse_json_body
@validate({'group_id': {'required': True, 'type': str, 'min_length': 1, 'max_length': MAX_GROUP_ID_LENGTH}})
def handler(event: dict[str, Any], context: Any, body: dict[str, Any], group_id: str) -> dict[str, Any]:
    """Start writing the group's narrative again; 202 once the worker has the request."""
    if not resolve_scope({'mode': 'groups', 'group_ids': [group_id]}, dynamodb.Table(KEYWORDS_TABLE)):
        return validation_error('The group has no active keyword to write a narrative for.', event, 'group_id')
    try:
        invoke_self_async(
            REPORT_INSIGHTS_FUNCTION,
            json.dumps({'group_id': group_id}).encode(),
            description='narrative generation',
            lambda_client=lambda_client,
        )
    except SelfInvokeDispatchError:
        return api_response(503, {'error': 'Could not start the narrative generation'}, event)
    return success_response({'status': 'accepted', 'group_id': group_id}, event, status_code=202)
