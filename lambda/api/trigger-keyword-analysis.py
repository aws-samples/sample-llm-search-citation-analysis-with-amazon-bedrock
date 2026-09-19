"""
Trigger Keyword Analysis API Lambda

Starts a Step Functions execution for a subset of keywords: either an explicit
list of keyword texts (legacy clients) or a *scope* — one or more keyword
groups, or a list of keyword ids — that is resolved against the Keywords table
so only real, active keywords are run.
"""

import logging
import os
import sys
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.analysis_runs import fetch_enabled_query_prompts, start_analysis_run
from shared.api_response import success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.constants import MAX_KEYWORD_LENGTH
from shared.decorators import api_handler, parse_json_body
from shared.env_vars import resolve_table_env
from shared.keyword_groups import describe_scope, resolve_scope, validate_scope

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

stepfunctions = boto3.client('stepfunctions')
dynamodb = boto3.resource('dynamodb')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
QUERY_PROMPTS_TABLE = os.environ.get('QUERY_PROMPTS_TABLE', 'CitationAnalysis-QueryPrompts')
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')

query_prompts_table = dynamodb.Table(QUERY_PROMPTS_TABLE)
keywords_table = dynamodb.Table(KEYWORDS_TABLE)


def _keywords_from_texts(keywords_input: Any) -> list[str] | None:
    """Normalise the legacy ``keywords`` body field to a list of texts."""
    if isinstance(keywords_input, str):
        keywords_input = [keywords_input]
    if not isinstance(keywords_input, list):
        return None
    texts: list[str] = []
    for kw in keywords_input:
        keyword_text = kw if isinstance(kw, str) else (kw.get('keyword', '') if isinstance(kw, dict) else '')
        if keyword_text and len(keyword_text) <= MAX_KEYWORD_LENGTH:
            texts.append(keyword_text)
    return texts


@api_handler
@require_group(ADMIN_GROUP)
@parse_json_body
def handler(event: dict[str, Any], context: Any, body: dict) -> dict[str, Any]:
    """
    POST /api/trigger-keyword-analysis

    Admin-only, and gated above `@parse_json_body` so an unauthorized request
    is refused before its body is parsed. Same spend profile as
    `trigger-analysis` (AUDIT-2026-08-19 §2.3).

    Body, one of:
        {"keywords": ["keyword1", "keyword2"]}                     // legacy: explicit texts
        {"scope": {"mode": "groups", "group_ids": ["..."]}}         // every active keyword in these groups
        {"scope": {"mode": "keywords", "keyword_ids": ["..."]}}    // these keywords, if active
        {"scope": {"mode": "all"}}                                  // every active keyword

    There is no per-execution keyword cap: the ProcessKeywords Map bounds
    concurrency and the state-machine timeout bounds duration.
    """
    if not isinstance(body, dict):
        return validation_error('Request body must be a JSON object', event, 'body')

    scope = None
    if 'scope' in body:
        scope, scope_error = validate_scope(body.get('scope'))
        if scope is None:
            # validate_scope returns exactly one of (descriptor, None) / (None, error).
            return validation_error(str(scope_error), event, 'scope')
        resolved = resolve_scope(scope, keywords_table)
        keyword_texts = [item['keyword'] for item in resolved]
        if not keyword_texts:
            return validation_error(
                f'No active keywords match the selected scope ({describe_scope(scope)}).', event, 'scope'
            )
    else:
        keyword_texts = _keywords_from_texts(body.get('keywords'))
        if keyword_texts is None:
            return validation_error(
                'Provide a "keywords" array or a "scope" object in the request body.', event, 'keywords'
            )
        if not keyword_texts:
            return validation_error('No valid keywords provided.', event, 'keywords')

    query_prompts = fetch_enabled_query_prompts(query_prompts_table)
    # `requested_scope` is recorded for traceability; ParseKeywords uses the explicit list.
    extra_input = {'requested_scope': scope} if scope is not None else None
    started = start_analysis_run(
        stepfunctions, STATE_MACHINE_ARN, 'keyword-analysis', keyword_texts, query_prompts, extra_input
    )

    return success_response({
        **started,
        'keywords': keyword_texts,
        'scope': scope,
        'message': f'Analysis started for {len(keyword_texts)} keyword(s) with {len(query_prompts)} query prompts'
    }, event)
