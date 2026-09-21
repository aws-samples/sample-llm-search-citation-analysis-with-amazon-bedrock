"""
Research worker for the keyword-research Step Functions workflow.

Every mutation is owned by one immutable job attempt, one execution ARN and
one active round. Plans, evaluations and final results are replayable
checkpoints. Provider calls are intentionally at-least-once: concurrent Lambda
retries can repeat an external request, but conditional writes preserve the
first terminal provider checkpoint and reject stale attempts.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError
from bs4 import BeautifulSoup, Tag

from shared.ai_clients import WebSearchProvider, get_web_search_clients, get_web_search_provider, run_web_search
from shared.dynamo_decimal import convert_floats_to_decimal
from shared.keyword_signals import fetch_google_signals
from shared.llm_json import parse_llm_json
from shared.models import ModelRole, invoke_bedrock
from shared.prompt_safety import wrap_user_input
from shared.research_agent import (
    AGENT_DEFAULT_ROUNDS,
    AGENT_MAX_ROUNDS,
    DEFAULT_SYSTEM_PROMPT,
    OTHER_DIMENSION,
    SIGNALS_PROVIDER_ID,
    SIGNALS_SECRET_NAME,
    assign_steps,
    build_evaluate_prompt,
    build_plan_prompt,
    build_search_prompt,
    build_selection_prompt,
    fallback_selection,
    mark_tracking_subset,
    parse_evaluation,
    parse_plan,
    parse_selection,
    planned_query_texts,
    selected_dimensions,
    step_plan_fields,
)
from shared.research_jobs import (
    ACTIVE_STATUSES,
    COMPETITOR_CATEGORIES,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    STEP_COMPLETED,
    STEP_FAILED,
    STEP_PENDING,
    STEP_RUNNING,
    STEP_TERMINAL_STATUSES,
    TERMINAL_STATUSES,
    TYPE_AGENT,
    TYPE_COMPETITOR,
    bound_final_proposal,
    bound_round_evaluation,
    bound_round_plan,
    bound_step_result,
    checkpoint_terminal_result,
    completed_steps,
    final_status,
    job_attempt,
    merge_expansion_keywords,
    step_id_for,
    summarize_job,
)
from shared.safe_fetch import fetch_following_validated_redirects
from shared.secrets import get_api_key
from shared.url_validator import validate_url_safe
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
KEYWORD_RESEARCH_TABLE = (
    os.environ.get('DYNAMODB_TABLE_KEYWORD_RESEARCH')
    or os.environ.get('KEYWORD_RESEARCH_TABLE')
    or 'CitationAnalysis-KeywordResearch'
)
research_table = dynamodb.Table(KEYWORD_RESEARCH_TABLE)

STEP_MAX_RETRIES = 2
ERROR_MESSAGE_LIMIT = 500
PLAN_MAX_TOKENS = 1500
EVALUATE_MAX_TOKENS = 1500
SELECTION_MAX_TOKENS = 6000
SIGNALS_TIME_BUDGET_SECONDS = 200
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


class ResearchJobNotFoundError(LookupError):
    """The job row an action was asked to work on does not exist."""


class NoProviderConfiguredError(RuntimeError):
    """No web-search provider has an API key, so nothing can be planned."""


class StepFailedError(RuntimeError):
    """A provider step failed for a reason worth showing the user."""


class AgentPlanningError(RuntimeError):
    """The planning model returned no usable queries."""


class CheckpointConflictError(RuntimeError):
    """A checkpoint write kept racing another active invocation."""


# =============================================================================
# Prompts and page context
# =============================================================================

def build_expansion_prompt(seed_keyword: str, industry: str, count: int) -> str:
    return f"""Search the web for keyword research data about {wrap_user_input(seed_keyword, "seed_keyword")} in the {wrap_user_input(industry, "industry")} industry.

Find {count} related keywords that people actually search for. Use your web search to find:
- Popular search queries related to this topic
- Long-tail keyword variations
- Question-based searches (how, what, why, best, top)
- Comparison searches (vs, alternative, compared to)
- Commercial/transactional keywords

For each keyword, analyze:
1. Search intent (informational, commercial, transactional, navigational)
2. Competition level based on search results (low, medium, high)
3. Relevance to the seed keyword (1-10)

Return ONLY a JSON array with this exact structure, no other text or explanation:
[
  {{"keyword": "example keyword", "intent": "informational", "competition": "medium", "relevance": 8, "source": "where you found this"}},
  ...
]"""


def _seo_context(page_data: dict[str, Any]) -> str:
    if not page_data.get('success'):
        return ''
    title_tag = wrap_user_input(page_data.get('title') or 'N/A', 'page_title')
    meta_tag = wrap_user_input(page_data.get('meta_description') or 'N/A', 'page_meta', max_length=2000)
    h1_wrapped = ', '.join(wrap_user_input(heading, 'h1') for heading in page_data.get('h1_tags', [])[:3]) or 'N/A'
    h2_wrapped = ', '.join(wrap_user_input(heading, 'h2') for heading in page_data.get('h2_tags', [])[:5]) or 'N/A'
    return f"""
Page SEO Elements (from direct scrape):
- Title: {title_tag}
- Meta Description: {meta_tag}
- H1 Tags: {h1_wrapped}
- H2 Tags: {h2_wrapped}
"""


def build_competitor_prompt(domain: str, page_data: dict[str, Any]) -> str:
    domain_tag = wrap_user_input(domain, 'domain')
    return f"""Search the web to find HIGH-TRAFFIC, NON-BRANDED, LONG-TAIL keywords that the website {domain_tag} ranks for or should target.

{_seo_context(page_data)}

Find 20 keywords across these categories:
1. Primary Keywords (5): High-traffic product category searches
2. Secondary Keywords (5): Product comparison and "best of" searches
3. Long-tail Keywords (5): Specific product + feature + intent searches
4. Content Gaps (5): Keywords competitors rank for but this site might be missing

For each keyword provide: search intent, competition level, relevance score (1-10).

Return ONLY valid JSON:
{{
  "domain": {json.dumps(domain)},
  "industry": "detected industry",
  "page_focus": "main business focus",
  "primary_keywords": [{{"keyword": "...", "intent": "commercial", "competition": "high", "relevance": 10, "source": "..."}}],
  "secondary_keywords": [{{"keyword": "...", "intent": "commercial", "competition": "medium", "relevance": 8, "source": "..."}}],
  "longtail_keywords": [{{"keyword": "...", "intent": "transactional", "competition": "low", "relevance": 9, "source": "..."}}],
  "content_gaps": [{{"keyword": "...", "intent": "commercial", "competition": "medium", "relevance": 7, "opportunity": "..."}}]
}}"""


def _attribute_text(tag: object, name: str) -> str:
    """``tag``'s ``name`` attribute when it is a plain string, else ``''``.

    Covers both a missing tag (``soup.find`` returned ``None``) and the
    list-valued attributes BeautifulSoup builds for ``class``-like names.
    """
    value = tag.get(name) if isinstance(tag, Tag) else None
    return value if isinstance(value, str) else ''


def _heading_texts(soup: BeautifulSoup, level: str, limit: int) -> list[str]:
    """Non-empty text of the first ``limit`` ``level`` headings, each bounded to 300 characters."""
    texts = (heading.get_text(strip=True) for heading in soup.find_all(level))
    return [text[:300] for text in texts if text][:limit]


def fetch_page_seo_elements(url: str) -> dict[str, Any]:
    """Fetch bounded SEO context while validating every redirect hop."""
    domain = urlparse(url).netloc.replace('www.', '')
    is_safe, ssrf_error = validate_url_safe(url)
    if not is_safe:
        logger.warning('fetch_page_seo_elements rejected URL: %s', ssrf_error)
        return {'success': False, 'error': f'URL rejected: {ssrf_error}', 'domain': domain}

    try:
        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        }
        response, _final_url, fetch_error = fetch_following_validated_redirects(url, headers=headers, timeout=5)
        if fetch_error or response is None:
            logger.warning('fetch_page_seo_elements rejected URL: %s', fetch_error)
            return {'success': False, 'error': f'URL rejected: {fetch_error}', 'domain': domain}

        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        title_tag = soup.find('title')

        return {
            'success': True,
            'domain': domain,
            'title': (title_tag.get_text(strip=True) if title_tag else '')[:300],
            'meta_description': _attribute_text(soup.find('meta', attrs={'name': 'description'}), 'content')[:1000],
            'meta_keywords': _attribute_text(soup.find('meta', attrs={'name': 'keywords'}), 'content')[:500],
            'h1_tags': _heading_texts(soup, 'h1', 5),
            'h2_tags': _heading_texts(soup, 'h2', 10),
            'h3_tags': _heading_texts(soup, 'h3', 10),
            'og_title': _attribute_text(soup.find('meta', attrs={'property': 'og:title'}), 'content')[:300],
            'og_description': _attribute_text(soup.find('meta', attrs={'property': 'og:description'}), 'content')[:1000],
            'canonical': _attribute_text(soup.find('link', attrs={'rel': 'canonical'}), 'href')[:2048],
        }
    except Exception as exc:
        logger.exception('Error fetching %s', url)
        return {'success': False, 'error': str(exc)[:ERROR_MESSAGE_LIMIT], 'domain': domain}


# =============================================================================
# Ownership and DynamoDB helpers
# =============================================================================

def _load_job(job_id: str) -> dict[str, Any]:
    job = research_table.get_item(Key={'id': job_id}, ConsistentRead=True).get('Item')
    if not job:
        raise ResearchJobNotFoundError(f'Research job {job_id} not found')
    return job


def _is_conditional_failure(error: ClientError) -> bool:
    return error.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException'


def _event_attempt(event: dict[str, Any]) -> int | None:
    value = event.get('attempt')
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 1 else None


def _event_round(event: dict[str, Any]) -> int | None:
    value = event.get('expected_round')
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 1 else None


def _event_owner(event: dict[str, Any]) -> str | None:
    value = event.get('execution_arn')
    return value if isinstance(value, str) and value else None


def _base_result(event: dict[str, Any], round_number: int) -> dict[str, Any]:
    result = {
        'job_id': event['job_id'],
        'attempt': event.get('attempt'),
        'round': round_number,
        'expected_round': round_number,
        'retry': False,
    }
    for key in ('execution_arn', 'execution_id'):
        if event.get(key):
            result[key] = event[key]
    return result


def _owned_for_round(job: dict[str, Any], event: dict[str, Any]) -> bool:
    attempt = _event_attempt(event)
    expected_round = _event_round(event)
    owner = _event_owner(event)
    return (
        attempt is not None
        and expected_round is not None
        and owner is not None
        and job.get('status') in ACTIVE_STATUSES
        and job_attempt(job) == attempt
        and job.get('execution_arn') == owner
        and int(job.get('active_round') or 0) == expected_round
    )


def _active_condition(
    job: dict[str, Any],
    event: dict[str, Any],
    names: dict[str, str],
    values: dict[str, Any],
) -> str:
    names['#s'] = 'status'
    values.update({
        ':observed_status': job.get('status'),
        ':attempt': _event_attempt(event),
        ':execution_arn': _event_owner(event),
        ':expected_round': _event_round(event),
    })
    return (
        '#s = :observed_status AND attempt = :attempt '
        'AND execution_arn = :execution_arn AND active_round = :expected_round'
    )


def _revision_condition(job: dict[str, Any], values: dict[str, Any]) -> str:
    revision = int(job.get('checkpoint_revision') or 0)
    values[':observed_revision'] = revision
    if 'checkpoint_revision' in job:
        return 'checkpoint_revision = :observed_revision'
    return 'attribute_not_exists(checkpoint_revision)'


def _claim_plan(job: dict[str, Any], event: dict[str, Any]) -> bool:
    """Bind Plan before any external work and select its active round."""
    attempt = _event_attempt(event)
    expected_round = _event_round(event)
    owner = _event_owner(event)
    if attempt is None or expected_round is None or owner is None:
        return False
    if job.get('status') not in ACTIVE_STATUSES or job_attempt(job) != attempt:
        return False
    existing_owner = job.get('execution_arn')
    if existing_owner and existing_owner != owner:
        return False
    active_round = int(job.get('active_round') or 0)
    if active_round not in (0, expected_round - 1, expected_round):
        return False

    names = {'#s': 'status'}
    values: dict[str, Any] = {
        ':observed_status': job.get('status'),
        ':attempt': attempt,
        ':running': STATUS_RUNNING,
        ':owner': owner,
        ':execution_id': event.get('execution_id', ''),
        ':expected_round': expected_round,
        ':ts': get_timestamp(),
    }
    condition = (
        '#s = :observed_status AND (attempt = :attempt OR attribute_not_exists(attempt)) '
        'AND (attribute_not_exists(execution_arn) OR execution_arn = :owner)'
    )
    if 'active_round' in job:
        values[':observed_active_round'] = job.get('active_round')
        condition += ' AND active_round = :observed_active_round'
    else:
        condition += ' AND attribute_not_exists(active_round)'

    try:
        research_table.update_item(
            Key={'id': job['id']},
            UpdateExpression=(
                'SET #s = :running, attempt = if_not_exists(attempt, :attempt), '
                'execution_arn = :owner, execution_id = :execution_id, '
                'active_round = :expected_round, updated_at = :ts'
            ),
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if _is_conditional_failure(exc):
            return False
        raise

    job.update({
        'status': STATUS_RUNNING,
        'attempt': attempt,
        'execution_arn': owner,
        'execution_id': event.get('execution_id', ''),
        'active_round': expected_round,
    })
    return True


def _write_step(
    job: dict[str, Any],
    event: dict[str, Any],
    step_id: str,
    step: dict[str, Any],
    *,
    allowed_statuses: tuple[str, ...],
) -> bool:
    """Write one bounded checkpoint if its attempt, owner, round and state still match."""
    names = {'#sid': step_id, '#step_status': 'status', '#step_round': 'round'}
    values: dict[str, Any] = {
        ':step': convert_floats_to_decimal(bound_step_result(step)),
        ':ts': get_timestamp(),
        ':revision_increment': 1,
    }
    condition = _active_condition(job, event, names, values)
    condition += ' AND steps.#sid.#step_round = :expected_round'
    status_tokens = []
    for index, status in enumerate(allowed_statuses):
        token = f':allowed_status{index}'
        values[token] = status
        status_tokens.append(token)
    condition += f" AND steps.#sid.#step_status IN ({', '.join(status_tokens)})"
    try:
        research_table.update_item(
            Key={'id': job['id']},
            UpdateExpression=(
                'SET steps.#sid = :step, updated_at = :ts '
                'ADD checkpoint_revision :revision_increment'
            ),
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if _is_conditional_failure(exc):
            return False
        raise
    return True


def _error_text(error: Any) -> str:
    if isinstance(error, dict):
        cause = error.get('Cause') or ''
        try:
            parsed = json.loads(cause)
            message = parsed.get('errorMessage') if isinstance(parsed, dict) else None
        except (TypeError, ValueError):
            message = None
        text = message or cause or error.get('Error') or 'Unknown error'
    else:
        text = str(error) or type(error).__name__
    return text[:ERROR_MESSAGE_LIMIT]


def _step_result(
    job: dict[str, Any],
    event: dict[str, Any],
    step_id: str,
    default: str | None,
) -> dict[str, Any]:
    step = (job.get('steps') or {}).get(step_id) or {}
    status = step.get('status') if isinstance(step, dict) else None
    if status not in STEP_TERMINAL_STATUSES:
        if default is None:
            raise CheckpointConflictError(
                f"Research job {event['job_id']} step {step_id} terminal checkpoint "
                f'conflicted with persisted status {status!r}',
            )
        status = default
    return {
        **_base_result(event, _event_round(event) or 1),
        'step_id': step_id,
        'status': status,
    }


def _round_entry(job: dict[str, Any], round_number: int) -> tuple[int, dict[str, Any] | None]:
    for index, round_info in enumerate(job.get('rounds') or []):
        if isinstance(round_info, dict) and int(round_info.get('round') or 0) == round_number:
            return index, round_info
    return -1, None


def _steps_for_round(job: dict[str, Any], round_number: int) -> list[tuple[str, dict[str, Any]]]:
    return [
        (step_id, step)
        for step_id, step in (job.get('steps') or {}).items()
        if isinstance(step, dict) and int(step.get('round') or 1) == round_number
    ]


# =============================================================================
# Plan
# =============================================================================

def _plan_result(event: dict[str, Any], steps: list[dict[str, str]]) -> dict[str, Any]:
    round_number = _event_round(event) or 1
    return {**_base_result(event, round_number), 'steps': steps}


def _reset_step(step: dict[str, Any], attempt: int) -> dict[str, Any]:
    return {
        **step_plan_fields(step),
        'provider': step.get('provider', ''),
        'status': STEP_PENDING,
        'attempt': attempt,
        'round': int(step.get('round') or 1),
    }


@dataclass
class _PlanWrite:
    """The DynamoDB update a plan stages before it commits.

    ``sets`` and ``removes`` are the SET / REMOVE clauses, ``names`` and
    ``values`` their expression placeholders, and ``reset_ids`` the steps this
    attempt takes over from an unfinished earlier one (the commit condition
    checks none of them completed in the meantime).
    """

    sets: list[str]
    removes: list[str] = field(default_factory=lambda: ['error_message'])
    names: dict[str, str] = field(default_factory=dict)
    values: dict[str, Any] = field(default_factory=dict)
    reset_ids: list[str] = field(default_factory=list)

    def stage_step(self, index: int, step_id: str, step: dict[str, Any]) -> None:
        """Stage ``steps.<step_id> = <step>`` behind the ``#step{index}`` / ``:step{index}`` placeholders."""
        name = f'#step{index}'
        token = f':step{index}'
        self.names[name] = step_id
        self.values[token] = step
        self.sets.append(f'steps.{name} = {token}')


def _runnable_steps(steps: Iterable[tuple[str, dict[str, Any]]], attempt: int, write: _PlanWrite) -> list[dict[str, str]]:
    """List the steps this attempt must run, staging a reset for those an earlier attempt left unfinished."""
    to_run: list[dict[str, str]] = []
    for index, (step_id, step) in enumerate(steps):
        if step.get('status') == STEP_COMPLETED:
            continue
        if int(step.get('attempt') or 0) != attempt:
            reset = _reset_step(step, attempt)
            write.stage_step(index, step_id, reset)
            write.reset_ids.append(step_id)
            to_run.append({'step_id': step_id, 'provider': reset['provider']})
        elif step.get('status') in (STEP_PENDING, STEP_RUNNING):
            to_run.append({'step_id': step_id, 'provider': step.get('provider', '')})
    return to_run


def _persist_plan(job: dict[str, Any], event: dict[str, Any], write: _PlanWrite) -> bool:
    names, values = write.names, write.values
    condition = _active_condition(job, event, names, values)
    values.update({
        ':running': STATUS_RUNNING,
        ':arn': _event_owner(event),
        ':revision_increment': 1,
    })
    sets = ['#s = :running', 'execution_arn = :arn', *write.sets]
    names['#round'] = 'round'
    values[':observed_round'] = int(job.get('round') or 0)
    condition += ' AND #round = :observed_round'
    if write.reset_ids:
        names['#step_status'] = 'status'
        values[':completed'] = STEP_COMPLETED
        for index, step_id in enumerate(write.reset_ids):
            name = f'#reset{index}'
            names[name] = step_id
            condition += f' AND steps.{name}.#step_status <> :completed'

    expression = f"SET {', '.join(sets)}"
    if write.removes:
        expression += f" REMOVE {', '.join(write.removes)}"
    expression += ' ADD checkpoint_revision :revision_increment'
    try:
        research_table.update_item(
            Key={'id': job['id']},
            UpdateExpression=expression,
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if _is_conditional_failure(exc):
            return False
        raise
    return True


def _replay_steps(job: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    attempt = _event_attempt(event)
    round_number = _event_round(event) or 1
    steps = [
        {'step_id': step_id, 'provider': step.get('provider', '')}
        for step_id, step in _steps_for_round(job, round_number)
        if step.get('status') in (STEP_PENDING, STEP_RUNNING) and int(step.get('attempt') or attempt or 0) == attempt
    ]
    return _plan_result(event, steps)


def _commit_plan(job: dict[str, Any], event: dict[str, Any], to_run: list[dict[str, str]], write: _PlanWrite) -> dict[str, Any]:
    """Persist the staged plan and answer with ``to_run``.

    A lost write race means another attempt or execution moved the row, so
    the answer is whatever that writer left runnable rather than this plan.
    """
    if not _persist_plan(job, event, write):
        return _replay_steps(_load_job(job['id']), event)
    round_number = _event_round(event) or 1
    logger.info('Planned research job %s attempt %s round %s with %s runnable steps', job['id'], _event_attempt(event), round_number, len(to_run))
    return _plan_result(event, to_run)


def _plan_standard(job: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    round_number = _event_round(event) or 1
    attempt = _event_attempt(event) or 1
    existing = _steps_for_round(job, round_number)
    write = _PlanWrite(
        sets=['steps_total = :total', 'updated_at = :ts'],
        values={':total': len(job.get('steps') or {}), ':ts': get_timestamp()},
    )

    if existing:
        to_run = _runnable_steps(existing, attempt, write)
    else:
        provider_ids = [provider.provider_id for provider, _client in get_web_search_clients()]
        if not provider_ids:
            raise NoProviderConfiguredError('No API keys configured')
        steps = {
            step_id_for(provider_id, round_number): {
                'provider': provider_id,
                'status': STEP_PENDING,
                'round': round_number,
                'attempt': attempt,
            }
            for provider_id in provider_ids
        }
        write.values.update({':steps': steps, ':total': len(steps), ':round': round_number})
        write.sets.extend(['steps = :steps', '#round = :round'])
        write.names['#round'] = 'round'
        to_run = [{'step_id': step_id, 'provider': step['provider']} for step_id, step in steps.items()]

    if job.get('type') == TYPE_COMPETITOR and not job.get('page_data'):
        write.values[':page'] = fetch_page_seo_elements(job.get('url', ''))
        write.sets.append('page_data = :page')

    return _commit_plan(job, event, to_run, write)


def _agent_max_rounds(job: dict[str, Any]) -> int:
    config = job.get('config') or {}
    return max(1, min(int(config.get('max_rounds') or AGENT_DEFAULT_ROUNDS), AGENT_MAX_ROUNDS))


def _agent_system_prompt(job: dict[str, Any]) -> str:
    return job.get('system_prompt') or DEFAULT_SYSTEM_PROMPT


def _agent_candidates(job: dict[str, Any], through_round: int) -> list[dict[str, Any]]:
    return merge_expansion_keywords(completed_steps(job, through_round=through_round))


def _plan_first_round(job: dict[str, Any]) -> dict[str, Any]:
    config = job.get('config') or {}
    text = invoke_bedrock(
        build_plan_prompt(config),
        ModelRole.RESEARCH_PLANNING,
        max_tokens=PLAN_MAX_TOKENS,
        system=_agent_system_prompt(job),
    )
    planned = parse_plan(text, config)
    if planned is None:
        raise AgentPlanningError('The planning model returned no usable search queries')
    return planned


def _replan_round(
    job: dict[str, Any],
    event: dict[str, Any],
    round_index: int,
    persisted_round: dict[str, Any],
) -> dict[str, Any]:
    """Re-run the steps of an already-planned round that an earlier attempt left unfinished."""
    attempt = _event_attempt(event) or 1
    write = _PlanWrite(sets=['updated_at = :ts'], values={':ts': get_timestamp()})

    persisted_steps = job.get('steps') or {}
    round_steps = [
        (step_id, step)
        for step_id in persisted_round.get('step_ids') or []
        if isinstance(step := persisted_steps.get(step_id), dict)
    ]
    to_run = _runnable_steps(round_steps, attempt, write)
    write.values[':total'] = len(persisted_steps)
    write.sets.append('steps_total = :total')
    if write.reset_ids and round_index >= 0 and persisted_round.get('evaluation') is not None:
        write.removes.append(f'rounds[{round_index}].evaluation')
    return _commit_plan(job, event, to_run, write)


def _round_queries(job: dict[str, Any], round_number: int) -> tuple[list[dict[str, Any]], str]:
    """``(queries, strategy)`` for a new round.

    The model plans round one; every later round runs the ``next_queries``
    the previous round's evaluation asked for, with no strategy of its own.
    """
    if round_number == 1:
        planned = _plan_first_round(job)
        return planned['queries'], planned['strategy']
    _previous_index, previous = _round_entry(job, round_number - 1)
    evaluation = previous.get('evaluation') if isinstance(previous, dict) else None
    queries = list(evaluation.get('next_queries') or []) if isinstance(evaluation, dict) else []
    return queries, ''


def _plan_agent(job: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    round_number = _event_round(event) or 1
    attempt = _event_attempt(event) or 1
    round_index, persisted_round = _round_entry(job, round_number)
    if persisted_round is not None:
        return _replan_round(job, event, round_index, persisted_round)
    if round_number > _agent_max_rounds(job) or round_number != int(job.get('round') or 0) + 1:
        return _plan_result(event, [])

    timestamp = get_timestamp()
    queries, strategy = _round_queries(job, round_number)
    if not queries:
        return _plan_result(event, [])

    provider_ids = [provider.provider_id for provider, _client in get_web_search_clients()]
    if not provider_ids:
        raise NoProviderConfiguredError('No API keys configured')
    new_steps = assign_steps(
        queries,
        provider_ids,
        round_number,
        with_signals=bool(get_api_key(SIGNALS_SECRET_NAME)),
    )
    for step in new_steps.values():
        step['attempt'] = attempt
    round_info = bound_round_plan({
        'round': round_number,
        'planned_at': timestamp,
        'planned_attempt': attempt,
        'strategy': strategy,
        'queries': queries,
        'step_ids': list(new_steps),
    })
    existing_steps = job.get('steps') or {}
    write = _PlanWrite(
        sets=[
            'updated_at = :ts',
            '#round = :round',
            'rounds = list_append(if_not_exists(rounds, :empty), :round_info)',
            'steps_total = :total',
        ],
        names={'#round': 'round'},
        values={
            ':ts': timestamp,
            ':round': round_number,
            ':round_info': [round_info],
            ':empty': [],
            ':total': len(existing_steps) + len(new_steps),
        },
    )
    if not existing_steps:
        write.values[':steps'] = new_steps
        write.sets.append('steps = :steps')
    else:
        for index, (step_id, step) in enumerate(new_steps.items()):
            write.stage_step(index, step_id, step)

    to_run = [{'step_id': step_id, 'provider': step['provider']} for step_id, step in new_steps.items()]
    return _commit_plan(job, event, to_run, write)


def plan(event: dict[str, Any]) -> dict[str, Any]:
    job = _load_job(event['job_id'])
    if not _claim_plan(job, event):
        current = _load_job(event['job_id'])
        if not _owned_for_round(current, event):
            return _plan_result(event, [])
        job = current
    if job.get('type') == TYPE_AGENT:
        return _plan_agent(job, event)
    return _plan_standard(job, event)


# =============================================================================
# Provider execution
# =============================================================================

def _run_signals_step(config: dict[str, Any], planned: dict[str, Any]) -> dict[str, Any]:
    api_key = get_api_key(SIGNALS_SECRET_NAME)
    if not api_key:
        raise StepFailedError(f'{SIGNALS_PROVIDER_ID} is not configured')
    keywords: list[dict[str, Any]] = []
    errors: list[str] = []
    started = time.monotonic()
    for item in planned.get('queries') or []:
        if time.monotonic() - started > SIGNALS_TIME_BUDGET_SECONDS:
            errors.append('time budget exhausted before every query was checked')
            break
        query = item.get('query', '') if isinstance(item, dict) else ''
        dimension = item.get('dimension', OTHER_DIMENSION) if isinstance(item, dict) else OTHER_DIMENSION
        try:
            for candidate in fetch_google_signals(
                api_key,
                query,
                country=config.get('country', 'us'),
                language=config.get('language', 'en'),
            ):
                keywords.append({**candidate, 'dimension': dimension})
        except Exception as exc:
            logger.exception('Google signals query %r failed', query)
            errors.append(f'{query}: {_error_text(exc)}')
    if not keywords and errors:
        raise StepFailedError('; '.join(errors)[:ERROR_MESSAGE_LIMIT])
    result: dict[str, Any] = {'keywords': keywords, 'keyword_count': len(keywords)}
    if errors:
        result['warnings'] = errors
    return result


def _provider_client(provider_id: str) -> tuple[WebSearchProvider, Any]:
    """The web-search provider behind ``provider_id`` and a client authenticated with its key.

    Raises ``StepFailedError`` (the message the user sees on the step) for an
    unknown provider or one without an API key.
    """
    provider = get_web_search_provider(provider_id)
    if provider is None:
        raise StepFailedError(f'Unknown provider {provider_id!r}')
    api_key = get_api_key(provider.secret_name)
    if not api_key:
        raise StepFailedError(f'{provider_id} is not configured')
    return provider, provider.client_class(api_key)


def _run_agent_step(job: dict[str, Any], planned: dict[str, Any], provider_id: str) -> dict[str, Any]:
    config = job.get('config') or {}
    if provider_id == SIGNALS_PROVIDER_ID:
        return _run_signals_step(config, planned)

    provider, client = _provider_client(provider_id)
    allowed_dimensions = selected_dimensions(config, include_other=True)
    planned_dimension = planned.get('dimension', OTHER_DIMENSION)
    dimension = planned_dimension if planned_dimension in allowed_dimensions else OTHER_DIMENSION
    prompt = build_search_prompt(config, planned.get('query', ''), dimension)
    text = run_web_search(provider, client, prompt, max_retries=STEP_MAX_RETRIES)
    result = _parse_expansion(text)
    for keyword in result['keywords']:
        keyword['dimension'] = dimension
    result['raw_response'] = text
    return result


def _parse_expansion(text: str) -> dict[str, Any]:
    parsed = parse_llm_json(text, expect='array')
    if parsed is None:
        raise StepFailedError('Provider returned no parseable keyword list')
    keywords = [entry for entry in parsed if isinstance(entry, dict) and isinstance(entry.get('keyword'), str)]
    return {'keywords': keywords, 'keyword_count': len(keywords)}


def _parse_competitor(text: str, page_data: dict[str, Any]) -> dict[str, Any]:
    parsed = parse_llm_json(text, expect='object')
    if not isinstance(parsed, dict):
        raise StepFailedError('Provider returned no parseable analysis')
    analysis: dict[str, Any] = {
        'domain': '',
        'industry': 'unknown',
        'page_focus': '',
        **{category: [] for category in COMPETITOR_CATEGORIES},
        **parsed,
    }
    for category in COMPETITOR_CATEGORIES:
        if not isinstance(analysis.get(category), list):
            analysis[category] = []
    if page_data.get('success'):
        analysis['seo_elements'] = {
            'title': page_data.get('title', ''),
            'meta_description': page_data.get('meta_description', ''),
            'h1_tags': page_data.get('h1_tags', []),
            'h2_tags': page_data.get('h2_tags', []),
        }
    count = sum(len(analysis[category]) for category in COMPETITOR_CATEGORIES)
    return {'analysis': analysis, 'keyword_count': count}


def _run_step(job: dict[str, Any], provider_id: str) -> dict[str, Any]:
    provider, client = _provider_client(provider_id)

    if job.get('type') == TYPE_COMPETITOR:
        page_data = job.get('page_data') or {}
        prompt = build_competitor_prompt(job.get('domain', ''), page_data)
        text = run_web_search(provider, client, prompt, max_retries=STEP_MAX_RETRIES)
        result = _parse_competitor(text, page_data)
    else:
        prompt = build_expansion_prompt(job.get('seed_keyword', ''), job.get('industry', 'general'), int(job.get('count') or 20))
        text = run_web_search(provider, client, prompt, max_retries=STEP_MAX_RETRIES)
        result = _parse_expansion(text)
    result['raw_response'] = text
    return result


def execute_step(event: dict[str, Any]) -> dict[str, Any]:
    job_id, step_id, provider_id = event['job_id'], event['step_id'], event['provider']
    job = _load_job(job_id)
    persisted = (job.get('steps') or {}).get(step_id)
    if not _owned_for_round(job, event) or not isinstance(persisted, dict):
        return _step_result(job, event, step_id, STEP_FAILED)
    if persisted.get('provider') != provider_id or int(persisted.get('round') or 0) != _event_round(event):
        return _step_result(job, event, step_id, STEP_FAILED)
    if persisted.get('status') in STEP_TERMINAL_STATUSES:
        return _step_result(job, event, step_id, persisted['status'])
    if int(persisted.get('attempt') or 0) != _event_attempt(event):
        return _step_result(job, event, step_id, STEP_FAILED)

    planned = step_plan_fields(persisted)
    started_at = get_timestamp()
    running = {
        **planned,
        'provider': provider_id,
        'status': STEP_RUNNING,
        'attempt': _event_attempt(event),
        'started_at': started_at,
    }
    if not _write_step(
        job,
        event,
        step_id,
        running,
        allowed_statuses=(STEP_PENDING, STEP_RUNNING),
    ):
        return _step_result(_load_job(job_id), event, step_id, STEP_FAILED)

    # At-least-once boundary: another Lambda invocation can be in the same
    # external provider call concurrently. The conditional terminal write
    # below preserves whichever valid checkpoint commits first.
    try:
        result = _run_agent_step(job, planned, provider_id) if job.get('type') == TYPE_AGENT else _run_step(job, provider_id)
        step = {
            **planned,
            'provider': provider_id,
            'status': STEP_COMPLETED,
            'attempt': _event_attempt(event),
            'started_at': started_at,
            'finished_at': get_timestamp(),
            **result,
        }
    except Exception as exc:
        logger.exception('Step %s of job %s failed', step_id, job_id)
        step = {
            **planned,
            'provider': provider_id,
            'status': STEP_FAILED,
            'attempt': _event_attempt(event),
            'started_at': started_at,
            'finished_at': get_timestamp(),
            'error_message': _error_text(exc),
        }

    if not _write_step(
        job,
        event,
        step_id,
        step,
        allowed_statuses=(STEP_PENDING, STEP_RUNNING),
    ):
        return _step_result(_load_job(job_id), event, step_id, None)
    logger.info('Step %s of job %s committed %s', step_id, job_id, step['status'])
    return _step_result({**job, 'steps': {**job.get('steps', {}), step_id: step}}, event, step_id, step['status'])


def fail_step(event: dict[str, Any]) -> dict[str, Any]:
    job_id, step_id = event['job_id'], event['step_id']
    try:
        job = _load_job(job_id)
    except ResearchJobNotFoundError:
        return {**_base_result(event, _event_round(event) or 1), 'step_id': step_id, 'status': STEP_FAILED}
    persisted = (job.get('steps') or {}).get(step_id)
    if not _owned_for_round(job, event) or not isinstance(persisted, dict):
        return _step_result(job, event, step_id, STEP_FAILED)
    if persisted.get('status') in STEP_TERMINAL_STATUSES:
        return _step_result(job, event, step_id, persisted['status'])

    step = {
        **step_plan_fields(persisted),
        'provider': event.get('provider', ''),
        'status': STEP_FAILED,
        'attempt': _event_attempt(event),
        'finished_at': get_timestamp(),
        'error_message': _error_text(event.get('error')),
    }
    if not _write_step(
        job,
        event,
        step_id,
        step,
        allowed_statuses=(STEP_PENDING, STEP_RUNNING),
    ):
        return _step_result(_load_job(job_id), event, step_id, None)
    return {**_base_result(event, _event_round(event) or 1), 'step_id': step_id, 'status': STEP_FAILED}


# =============================================================================
# Evaluate and Finalize
# =============================================================================

def _stop_evaluation(reason: str) -> dict[str, Any]:
    return {'assessment': '', 'decision': 'stop', 'reason': reason, 'next_queries': []}


def _evaluate_round(job: dict[str, Any], round_number: int, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    config = job.get('config') or {}
    try:
        text = invoke_bedrock(
            build_evaluate_prompt(config, round_number, candidates),
            ModelRole.RESEARCH_EVALUATION,
            max_tokens=EVALUATE_MAX_TOKENS,
            system=_agent_system_prompt(job),
        )
    except Exception as exc:
        logger.exception('Agent job %s evaluation failed', job['id'])
        return _stop_evaluation(f'The evaluation model failed ({_error_text(exc)}); finishing with the keywords found so far.')
    evaluation = parse_evaluation(text, config, exclude_queries=planned_query_texts(job))
    if evaluation is None:
        return _stop_evaluation('The evaluation model returned no usable decision; finishing with the keywords found so far.')
    return evaluation


def _evaluation_result(event: dict[str, Any], evaluation: dict[str, Any], round_number: int) -> dict[str, Any]:
    result = _base_result(event, round_number)
    result['decision'] = evaluation.get('decision', 'stop')
    result['expected_round'] = round_number + 1 if result['decision'] == 'continue' else round_number
    return result


def evaluate(event: dict[str, Any]) -> dict[str, Any]:
    job_id = event['job_id']
    job = _load_job(job_id)
    round_number = _event_round(event) or 1
    if not _owned_for_round(job, event):
        return _evaluation_result(event, _stop_evaluation('Execution ownership changed.'), round_number)
    if job.get('type') != TYPE_AGENT:
        return _evaluation_result(event, _stop_evaluation('Non-agent research has one round.'), round_number)

    round_index, round_info = _round_entry(job, round_number)
    if round_info is None:
        return _evaluation_result(event, _stop_evaluation('The expected round was not planned.'), round_number)
    persisted = round_info.get('evaluation')
    if isinstance(persisted, dict):
        return _evaluation_result(event, persisted, round_number)

    candidates = _agent_candidates(job, round_number)
    max_rounds = _agent_max_rounds(job)
    if round_number >= max_rounds:
        evaluation = _stop_evaluation(f'Reached the maximum of {max_rounds} round{"s" if max_rounds != 1 else ""}.')
    elif not candidates:
        evaluation = _stop_evaluation('No candidate keywords were found; nothing to expand.')
    else:
        evaluation = _evaluate_round(job, round_number, candidates)
    evaluation = bound_round_evaluation(
        round_info,
        {**evaluation, 'candidate_count': len(candidates), 'evaluated_at': get_timestamp()},
    )

    names: dict[str, str] = {}
    values: dict[str, Any] = {
        ':ev': convert_floats_to_decimal(evaluation),
        ':ts': evaluation['evaluated_at'],
        ':revision_increment': 1,
    }
    condition = _active_condition(job, event, names, values)
    condition += f' AND attribute_not_exists(rounds[{round_index}].evaluation)'
    try:
        research_table.update_item(
            Key={'id': job_id},
            UpdateExpression=(
                f'SET rounds[{round_index}].evaluation = :ev, updated_at = :ts '
                'ADD checkpoint_revision :revision_increment'
            ),
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if not _is_conditional_failure(exc):
            raise
        current = _load_job(job_id)
        _current_index, current_round = _round_entry(current, round_number)
        current_evaluation = current_round.get('evaluation') if isinstance(current_round, dict) else None
        if isinstance(current_evaluation, dict):
            return _evaluation_result(event, current_evaluation, round_number)
        return _evaluation_result(event, _stop_evaluation('Execution ownership changed.'), round_number)
    logger.info('Agent job %s round %s evaluated as %s', job_id, round_number, evaluation['decision'])
    return _evaluation_result(event, evaluation, round_number)


def _select_proposal(job: dict[str, Any], candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    if not candidates:
        return [], 'none'
    config = job.get('config') or {}
    try:
        text = invoke_bedrock(
            build_selection_prompt(config, candidates),
            ModelRole.RESEARCH_PLANNING,
            max_tokens=SELECTION_MAX_TOKENS,
            system=_agent_system_prompt(job),
        )
        proposal = parse_selection(text, config, candidates)
    except Exception:
        logger.exception('Agent job %s selection failed', job['id'])
        proposal = None
    if proposal:
        return proposal, 'model'
    return fallback_selection(config, candidates), 'fallback'


def _failure_summary(job: dict[str, Any]) -> str:
    failures = []
    for step_id, step in sorted((job.get('steps') or {}).items()):
        if not isinstance(step, dict) or step.get('status') == STEP_COMPLETED:
            continue
        message = step.get('error_message') or ('did not finish' if step.get('status') in (STEP_PENDING, STEP_RUNNING) else 'failed')
        failures.append(f"{step.get('provider', step_id)}: {message}")
    return ('; '.join(failures) or 'No provider produced a result')[:ERROR_MESSAGE_LIMIT]


def _terminal_response(job: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    return {
        **_base_result(event, _event_round(event) or int(job.get('round') or 1)),
        'status': job.get('status', STATUS_FAILED),
        'keyword_count': int(job.get('keyword_count') or 0),
    }


def _write_terminal_checkpoint(
    job_id: str,
    event: dict[str, Any],
    *,
    action: Callable[[dict[str, Any]], dict[str, Any]],
    expression: str,
    condition: str,
    names: dict[str, str],
    values: dict[str, Any],
) -> dict[str, Any] | None:
    """Apply a terminal write; return ``None`` on success or the response to answer with after a lost race.

    A conditional failure means another writer moved the row. When the job is
    already terminal or no longer ours, answer with its current state;
    otherwise replay ``action`` against the fresh row, giving up after three
    replays.
    """
    try:
        research_table.update_item(
            Key={'id': job_id},
            UpdateExpression=expression,
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if not _is_conditional_failure(exc):
            raise
        current = _load_job(job_id)
        if current.get('status') in TERMINAL_STATUSES or not _owned_for_round(current, event):
            return _terminal_response(current, event)
        retries = int(event.get('_checkpoint_retry') or 0)
        if retries < 3:
            return action({**event, '_checkpoint_retry': retries + 1})
        raise CheckpointConflictError(
            f'Could not {action.__name__} research job {job_id} while checkpoints were changing',
        ) from exc
    return None


def finalize(event: dict[str, Any]) -> dict[str, Any]:
    job_id = event['job_id']
    job = _load_job(job_id)
    if job.get('status') in TERMINAL_STATUSES:
        return _terminal_response(job, event)
    if not _owned_for_round(job, event):
        return _terminal_response(job, event)

    summary = summarize_job(job)
    status = final_status(job)
    names: dict[str, str] = {}
    timestamp = get_timestamp()
    values: dict[str, Any] = {
        ':s': status,
        ':kc': summary['keyword_count'],
        ':sd': summary['steps_done'],
        ':sf': summary['steps_failed'],
        ':p': summary['provider'],
        ':ts': timestamp,
        ':finalized_attempt': _event_attempt(event),
        ':finalized_round': _event_round(event),
    }
    sets = [
        '#s = :s',
        'keyword_count = :kc',
        'steps_done = :sd',
        'steps_failed = :sf',
        'provider = :p',
        'finished_at = :ts',
        'updated_at = :ts',
        'finalized_attempt = :finalized_attempt',
        'finalized_round = :finalized_round',
    ]
    if job.get('type') == TYPE_COMPETITOR:
        analysis = summary['analysis']
        values.update({
            ':a': convert_floats_to_decimal(analysis),
            ':ind': analysis.get('industry', 'unknown'),
            ':pf': analysis.get('page_focus', ''),
        })
        sets.extend(['analysis = :a', 'industry = :ind', 'page_focus = :pf'])
    else:
        # `keywords` is the proposal the user reviews; the merged candidates
        # stay on the steps (and in the trace counts).
        source = 'merged'
        proposal = summary['keywords']
        if job.get('type') == TYPE_AGENT:
            proposal, source = _select_proposal(job, proposal)
            values[':cc'] = summary['keyword_count']
            sets.append('candidates_count = :cc')
        bounded, truncation = bound_final_proposal(proposal)
        if job.get('type') == TYPE_AGENT:
            # Marked after bounding: bounding keeps only the candidate fields,
            # and the recommendation must describe the entries actually stored.
            bounded = mark_tracking_subset(bounded, job.get('config') or {})
            values[':tc'] = sum(entry['tracking'] for entry in bounded)
            sets.append('tracking_count = :tc')
        values.update({
            ':kw': convert_floats_to_decimal(bounded),
            ':kc': len(bounded),
            ':src': source,
            ':proposal_truncation': truncation,
        })
        sets.extend([
            'keywords = :kw',
            'proposal_source = :src',
            'proposal_truncation = :proposal_truncation',
        ])

    condition = _active_condition(job, event, names, values)
    condition += f' AND {_revision_condition(job, values)}'
    expression = f"SET {', '.join(sets)}"
    if status == STATUS_COMPLETED:
        expression += ' REMOVE error_message'
    else:
        values[':e'] = _failure_summary(job)
        expression += ', error_message = :e'
    conflict = _write_terminal_checkpoint(
        job_id,
        event,
        action=finalize,
        expression=expression,
        condition=condition,
        names=names,
        values=values,
    )
    if conflict is not None:
        return conflict

    finalized = {**job, 'status': status, 'keyword_count': values[':kc']}
    logger.info('Finalized research job %s attempt %s as %s', job_id, _event_attempt(event), status)
    return _terminal_response(finalized, event)


def fail(event: dict[str, Any]) -> dict[str, Any]:
    """Persist checkpoint visibility when the owned state machine fails."""
    job_id = event['job_id']
    message = _error_text(event.get('error'))
    try:
        job = _load_job(job_id)
    except ResearchJobNotFoundError:
        return {**_base_result(event, _event_round(event) or 1), 'status': STATUS_FAILED}
    if job.get('status') in TERMINAL_STATUSES or not _owned_for_round(job, event):
        return _terminal_response(job, event)

    status, result = checkpoint_terminal_result(job)
    names: dict[str, str] = {}
    timestamp = get_timestamp()
    values: dict[str, Any] = {
        ':s': status,
        ':e': message,
        ':ts': timestamp,
        ':finalized_attempt': _event_attempt(event),
        ':finalized_round': _event_round(event),
    }
    sets = [
        '#s = :s',
        'error_message = :e',
        'finished_at = :ts',
        'updated_at = :ts',
        'finalized_attempt = :finalized_attempt',
        'finalized_round = :finalized_round',
    ]
    for index, (attribute, value) in enumerate(result.items()):
        token = f':result{index}'
        values[token] = convert_floats_to_decimal(value)
        sets.append(f'{attribute} = {token}')
    condition = _active_condition(job, event, names, values)
    condition += f' AND {_revision_condition(job, values)}'
    conflict = _write_terminal_checkpoint(
        job_id,
        event,
        action=fail,
        expression=f"SET {', '.join(sets)}",
        condition=condition,
        names=names,
        values=values,
    )
    if conflict is not None:
        return conflict

    failed = {**job, **result, 'status': status, 'error_message': message}
    logger.error('Research job %s attempt %s ended %s: %s', job_id, _event_attempt(event), status, message)
    return _terminal_response(failed, event)


ACTIONS = {
    'plan': plan,
    'execute_step': execute_step,
    'fail_step': fail_step,
    'evaluate': evaluate,
    'finalize': finalize,
    'fail': fail,
}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    action = event.get('action')
    if action not in ACTIONS:
        raise ValueError(f'Unknown research worker action: {action!r}')
    logger.info(
        'Research worker action=%s job_id=%s attempt=%s round=%s step_id=%s',
        action,
        event.get('job_id'),
        event.get('attempt'),
        event.get('expected_round'),
        event.get('step_id'),
    )
    return ACTIONS[action](event)
