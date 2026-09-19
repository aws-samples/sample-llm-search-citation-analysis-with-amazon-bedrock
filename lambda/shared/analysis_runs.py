"""
Starting an analysis run from the trigger endpoints.

``trigger-analysis`` (every active keyword) and ``trigger-keyword-analysis``
(a scope or an explicit list) end the same way: read the enabled personas,
stamp every keyword with one run timestamp, start the analysis state machine
and describe the execution to the caller. Both handlers used to carry their
own copy of each step; this module holds the one implementation.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from shared.utils import get_timestamp, get_timestamp_compact

logger = logging.getLogger(__name__)

# EnabledIndex is a sparse GSI over `enabled == 'true'`; ten personas per run is
# the product ceiling.
MAX_QUERY_PROMPTS_PER_RUN = 10


def fetch_enabled_query_prompts(query_prompts_table: Any) -> list[dict[str, str]]:
    """The enabled personas as the state-machine input carries them: ``id``, ``name``, ``template``.

    A deployment without the persona feature has no table or ``EnabledIndex``,
    so a DynamoDB failure is logged and the run proceeds without prompts.
    """
    try:
        response = query_prompts_table.query(
            IndexName='EnabledIndex',
            KeyConditionExpression=Key('enabled').eq('true'),
            Limit=MAX_QUERY_PROMPTS_PER_RUN,
        )
    except (BotoCoreError, ClientError) as error:
        logger.warning(f"Could not fetch query prompts, proceeding without them: {error}")
        return []
    items: list[dict[str, Any]] = response.get('Items', [])
    prompts = [{'id': item['id'], 'name': item.get('name', ''), 'template': item.get('template', '')} for item in items]
    logger.info(f"Found {len(prompts)} enabled query prompts")
    return prompts


def start_analysis_run(
    stepfunctions: Any,
    state_machine_arn: str,
    name_prefix: str,
    keyword_texts: list[str],
    query_prompts: list[dict[str, str]],
    extra_input: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Start one execution of the analysis state machine and describe it for the API response.

    Every keyword is stamped with the same run timestamp so ParseKeywords treats
    the batch as one run. ``extra_input`` is merged into the execution input for
    traceability fields such as ``requested_scope``. The result carries
    ``execution_arn``, ``execution_name``, ``start_date``, ``keywords_count`` and
    ``query_prompts_count``; each trigger endpoint adds its own ``message``.
    """
    timestamp = get_timestamp()
    execution_name = f"{name_prefix}-{get_timestamp_compact()}"
    execution_input: dict[str, Any] = {
        'keywords': [{'keyword': text, 'timestamp': timestamp} for text in keyword_texts],
        'query_prompts': query_prompts,
        **(extra_input or {}),
    }
    response = stepfunctions.start_execution(
        stateMachineArn=state_machine_arn,
        name=execution_name,
        input=json.dumps(execution_input),
    )
    return {
        'execution_arn': response['executionArn'],
        'execution_name': execution_name,
        'start_date': response['startDate'].isoformat(),
        'keywords_count': len(keyword_texts),
        'query_prompts_count': len(query_prompts),
    }
