"""
Starting an analysis run from the trigger endpoints.

``trigger-analysis`` (every active keyword) and ``trigger-keyword-analysis``
(a scope or an explicit list) end the same way: read the enabled personas,
build the execution input, start the analysis state machine and describe the
execution to the caller. Both handlers used to carry their own copy of each
step; this module holds the one implementation.

The execution input names a *scope* wherever it can (``scope_run_input``), not
the keyword texts: ParseKeywords resolves the scope at run time and writes the
keyword list to S3, so the input stays a few hundred bytes however many
keywords the run covers. Only legacy callers that send explicit texts get them
inline (``keyword_list_run_input``), and those are refused before they can hit
the Step Functions input cap.
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

# Step Functions refuses an execution input over 256 KiB (262,144 bytes). The
# budget leaves headroom so the refusal is this module's 400, naming the fix,
# instead of a StartExecution error after the caller's keywords were resolved.
MAX_RUN_INPUT_BYTES = 200_000


class RunInputTooLargeError(ValueError):
    """Raised when a run's execution input would not fit the safe inline budget."""

    def __init__(self, size_bytes: int) -> None:
        super().__init__(
            f'This run is too large to start with an explicit keyword list ({size_bytes} bytes; '
            f'the limit is {MAX_RUN_INPUT_BYTES}). Run a keyword group or all keywords with a "scope" instead.'
        )
        self.size_bytes = size_bytes


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


def scope_run_input(scope: dict[str, Any], query_prompts: list[dict[str, str]]) -> dict[str, Any]:
    """Execution input for a validated scope; ParseKeywords resolves it to keywords at run time."""
    return {'scope': scope, 'query_prompts': query_prompts}


def keyword_list_run_input(keyword_texts: list[str], query_prompts: list[dict[str, str]]) -> dict[str, Any]:
    """Execution input carrying explicit keyword texts (legacy callers), each stamped with one run timestamp."""
    timestamp = get_timestamp()
    return {
        'keywords': [{'keyword': text, 'timestamp': timestamp} for text in keyword_texts],
        'query_prompts': query_prompts,
    }


def start_analysis_run(
    stepfunctions: Any,
    state_machine_arn: str,
    name_prefix: str,
    run_input: dict[str, Any],
    keywords_count: int,
) -> dict[str, Any]:
    """Start one execution of the analysis state machine with ``run_input`` and describe it for the API response.

    ``keywords_count`` is what the caller resolved for its response; a scope
    input is resolved again by ParseKeywords when the run starts.

    Raises:
        RunInputTooLargeError: When the serialized input exceeds ``MAX_RUN_INPUT_BYTES``;
            nothing is started.

    The result carries ``execution_arn``, ``execution_name``, ``start_date``,
    ``keywords_count`` and ``query_prompts_count``; each trigger endpoint adds
    its own ``message``.
    """
    serialized = json.dumps(run_input)
    size_bytes = len(serialized.encode('utf-8'))
    if size_bytes > MAX_RUN_INPUT_BYTES:
        raise RunInputTooLargeError(size_bytes)

    execution_name = f"{name_prefix}-{get_timestamp_compact()}"
    response = stepfunctions.start_execution(
        stateMachineArn=state_machine_arn,
        name=execution_name,
        input=serialized,
    )
    return {
        'execution_arn': response['executionArn'],
        'execution_name': execution_name,
        'start_date': response['startDate'].isoformat(),
        'keywords_count': keywords_count,
        'query_prompts_count': len(run_input.get('query_prompts') or []),
    }
