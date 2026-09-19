"""
ResearchWorker Lambda Function

Runs the steps of the ``CitationAnalysis-KeywordResearch`` state machine:

    Plan -> Map(ExecuteStep | FailStep) -> Evaluate -> continue? -> Plan ...
                                                     \\-> Finalize
                                          (any crash -> FailJob)

One research job (keyword expansion, competitor analysis or the research
agent) is one row in ``CitationAnalysis-KeywordResearch`` and one execution.
Expansion and competitor jobs run one step per configured web-search
provider; agent jobs run one step per model-planned query, in rounds. Every
step checkpoints its own result under ``steps.<step_id>`` the moment it
finishes — a provider that times out, or a worker that dies mid-call, loses
that one step and nothing else. ``Finalize`` merges the completed steps into
the job-level result (for the agent: a model-selected proposal).

Actions (``event['action']``):

    plan          decide which steps to run (all providers, or only the
                  non-completed ones on a retry; for the agent: the round's
                  planned queries) and mark the job running
    execute_step  run one provider and write the step's result or failure
    fail_step     record a step the state machine could not complete
                  (worker crash or Lambda timeout — nothing raised in Python)
    evaluate      agent only: judge the round, decide continue | stop and plan
                  the next round's queries (other job types answer ``stop``)
    finalize      merge completed steps; status completed | partial | failed
    fail          mark the whole job failed (Plan or Finalize crashed)

Provider errors never escape ``execute_step``: they are written to the step
and the state machine moves on, so one bad API key cannot take the other
providers' results with it. Step Functions retries cover only Lambda-level
failures (throttling, timeouts).
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import time
from typing import Any
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError
from bs4 import BeautifulSoup

from shared.ai_clients import get_web_search_clients, get_web_search_provider, run_web_search
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
    parse_evaluation,
    parse_plan,
    parse_selection,
    planned_query_texts,
    step_plan_fields,
)
from shared.research_jobs import (
    COMPETITOR_CATEGORIES,
    RAW_RESPONSE_LIMIT,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    STEP_COMPLETED,
    STEP_FAILED,
    STEP_PENDING,
    STEP_RUNNING,
    TERMINAL_STATUSES,
    TYPE_AGENT,
    TYPE_COMPETITOR,
    completed_steps,
    final_status,
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

# In-process HTTP retries per provider call. The Lambda runs for at most 300s
# and the slowest client (OpenAI) waits 90s per attempt, so two attempts plus
# backoff stay inside the budget. Step Functions owns any further retry.
STEP_MAX_RETRIES = 2

ERROR_MESSAGE_LIMIT = 500

# Bedrock output budgets for the agent's own calls (excluding thinking): the
# planner and evaluator answer with at most 8 queries; the selection lists up
# to 100 keywords with a one-sentence rationale each.
PLAN_MAX_TOKENS = 1500
EVALUATE_MAX_TOKENS = 1500
SELECTION_MAX_TOKENS = 6000

# The SerpAPI signals step makes two calls per planned query; stop collecting
# past this budget so the step always ends inside the 300s Lambda timeout.
SIGNALS_TIME_BUDGET_SECONDS = 200

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


class ResearchJobNotFoundError(LookupError):
    """The job row an action was asked to work on does not exist."""


class NoProviderConfiguredError(RuntimeError):
    """No web-search provider has an API key, so nothing can be planned."""


class StepFailedError(RuntimeError):
    """A provider step failed for a reason worth showing the user."""


class AgentPlanningError(RuntimeError):
    """The planning model returned no usable queries — the agent job cannot start."""


# =============================================================================
# Prompts
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
    """Prompt fragment for scraped page elements; untrusted, so every field is wrapped."""
    if not page_data.get('success'):
        return ''
    title_tag = wrap_user_input(page_data.get('title') or 'N/A', "page_title")
    meta_tag = wrap_user_input(page_data.get('meta_description') or 'N/A', "page_meta", max_length=2000)
    h1_wrapped = ', '.join(wrap_user_input(h, "h1") for h in page_data.get('h1_tags', [])[:3]) or 'N/A'
    h2_wrapped = ', '.join(wrap_user_input(h, "h2") for h in page_data.get('h2_tags', [])[:5]) or 'N/A'
    return f"""
Page SEO Elements (from direct scrape):
- Title: {title_tag}
- Meta Description: {meta_tag}
- H1 Tags: {h1_wrapped}
- H2 Tags: {h2_wrapped}
"""


def build_competitor_prompt(domain: str, page_data: dict[str, Any]) -> str:
    domain_tag = wrap_user_input(domain, "domain")
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


# =============================================================================
# Page scraping (competitor analysis context)
# =============================================================================

def fetch_page_seo_elements(url: str) -> dict[str, Any]:
    """Fetch a webpage and extract SEO-relevant elements as LLM context.

    Re-validates the URL (the API validated it when the job was created) and
    follows redirects one validated hop at a time, so a ``301`` to an internal
    address cannot bypass the SSRF check. Failures are returned, not raised:
    the analysis proceeds without page context.
    """
    domain = urlparse(url).netloc.replace('www.', '')
    is_safe, ssrf_error = validate_url_safe(url)
    if not is_safe:
        logger.warning("fetch_page_seo_elements rejected URL: %s", ssrf_error)
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
        if fetch_error:
            logger.warning("fetch_page_seo_elements rejected URL: %s", fetch_error)
            return {'success': False, 'error': f'URL rejected: {fetch_error}', 'domain': domain}

        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        title_tag = soup.find('title')
        meta_desc_tag = soup.find('meta', attrs={'name': 'description'})
        meta_kw_tag = soup.find('meta', attrs={'name': 'keywords'})
        og_tags = {}
        for og in soup.find_all('meta', attrs={'property': re.compile(r'^og:')}):
            prop = og.get('property', '').replace('og:', '')
            content = og.get('content', '')
            if prop and content:
                og_tags[prop] = content

        return {
            'success': True,
            'domain': domain,
            'title': title_tag.get_text(strip=True) if title_tag else '',
            'meta_description': meta_desc_tag.get('content', '') if meta_desc_tag else '',
            'meta_keywords': meta_kw_tag.get('content', '') if meta_kw_tag else '',
            'h1_tags': [h1.get_text(strip=True) for h1 in soup.find_all('h1') if h1.get_text(strip=True)][:5],
            'h2_tags': [h2.get_text(strip=True) for h2 in soup.find_all('h2') if h2.get_text(strip=True)][:10],
            'og_tags': og_tags,
        }
    except Exception as e:
        logger.warning(f"Error fetching {url}: {e}")
        return {'success': False, 'error': str(e), 'domain': domain}


# =============================================================================
# DynamoDB helpers
# =============================================================================

def _load_job(job_id: str) -> dict[str, Any]:
    job = research_table.get_item(Key={'id': job_id}).get('Item')
    if not job:
        raise ResearchJobNotFoundError(f'Research job {job_id} not found')
    return job


def _write_step(job_id: str, step_id: str, step: dict[str, Any], *, unless_completed: bool = False) -> bool:
    """Write one step object atomically; returns False if skipped by the guard."""
    params: dict[str, Any] = {
        'Key': {'id': job_id},
        'UpdateExpression': 'SET steps.#sid = :step, updated_at = :ts',
        'ExpressionAttributeNames': {'#sid': step_id},
        'ExpressionAttributeValues': {':step': convert_floats_to_decimal(step), ':ts': get_timestamp()},
    }
    if unless_completed:
        params['ConditionExpression'] = 'attribute_not_exists(steps.#sid.#st) OR steps.#sid.#st <> :completed'
        params['ExpressionAttributeNames']['#st'] = 'status'
        params['ExpressionAttributeValues'][':completed'] = STEP_COMPLETED
    try:
        research_table.update_item(**params)
    except ClientError as exc:
        if exc.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
            return False
        raise
    return True


def _error_text(error: Any) -> str:
    """Human-readable message from a Step Functions error object or an exception."""
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


# =============================================================================
# Actions
# =============================================================================

def _steps_to_run(job: dict[str, Any], provider_ids: list[str], retry: bool) -> tuple[dict[str, dict[str, Any]], list[dict[str, str]]]:
    """Decide the full step map to persist and the subset to execute.

    Fresh job: one pending step per configured provider. Retry: keep the
    completed steps, reset every other one to pending and run only those.
    A retry of a job that never got its steps planned is treated as fresh.
    """
    existing = {step_id: step for step_id, step in (job.get('steps') or {}).items() if isinstance(step, dict)}
    if retry and existing:
        to_run = []
        for step_id, step in existing.items():
            if step.get('status') == STEP_COMPLETED:
                continue
            existing[step_id] = {'provider': step.get('provider', ''), 'status': STEP_PENDING}
            to_run.append({'step_id': step_id, 'provider': step.get('provider', '')})
        return existing, to_run

    steps = {step_id_for(provider_id): {'provider': provider_id, 'status': STEP_PENDING} for provider_id in provider_ids}
    return steps, [{'step_id': step_id, 'provider': step['provider']} for step_id, step in steps.items()]


def plan(event: dict[str, Any]) -> dict[str, Any]:
    job_id = event['job_id']
    retry = bool(event.get('retry'))
    job = _load_job(job_id)

    provider_ids = [provider.provider_id for provider, _client in get_web_search_clients()]
    if not provider_ids:
        raise NoProviderConfiguredError('No API keys configured')

    if job.get('type') == TYPE_AGENT:
        return _plan_agent(job, provider_ids, retry, event.get('execution_arn', ''))

    steps, to_run = _steps_to_run(job, provider_ids, retry)

    names = {'#s': 'status'}
    values: dict[str, Any] = {
        ':running': STATUS_RUNNING,
        ':total': len(steps),
        ':ts': get_timestamp(),
        ':arn': event.get('execution_arn', ''),
    }
    sets = ['#s = :running', 'steps_total = :total', 'updated_at = :ts', 'execution_arn = :arn']
    removes = ['error_message']

    if job.get('type') == TYPE_COMPETITOR and not job.get('page_data'):
        values[':page'] = fetch_page_seo_elements(job.get('url', ''))
        sets.append('page_data = :page')

    if not job.get('steps'):
        values[':steps'] = steps
        sets.append('steps = :steps')
    else:
        for index, item in enumerate(to_run):
            names[f'#st{index}'] = item['step_id']
            values[f':st{index}'] = steps[item['step_id']]
            sets.append(f'steps.#st{index} = :st{index}')

    research_table.update_item(
        Key={'id': job_id},
        UpdateExpression=f"SET {', '.join(sets)} REMOVE {', '.join(removes)}",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    logger.info(f"Planned research job {job_id}: {len(to_run)} of {len(steps)} steps to run (retry={retry})")
    return {'job_id': job_id, 'steps': to_run}


# =============================================================================
# Research agent
# =============================================================================

def _agent_max_rounds(job: dict[str, Any]) -> int:
    config = job.get('config') or {}
    return max(1, min(int(config.get('max_rounds') or AGENT_DEFAULT_ROUNDS), AGENT_MAX_ROUNDS))


def _agent_system_prompt(job: dict[str, Any]) -> str:
    return job.get('system_prompt') or DEFAULT_SYSTEM_PROMPT


def _agent_candidates(job: dict[str, Any]) -> list[dict[str, Any]]:
    """Every keyword found so far, merged across steps and rounds."""
    return merge_expansion_keywords(completed_steps(job))


def _plan_first_round(job: dict[str, Any]) -> dict[str, Any]:
    """Ask the planning model for round 1; a planner that answers nothing usable fails the job."""
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


def _plan_agent(job: dict[str, Any], provider_ids: list[str], retry: bool, execution_arn: str) -> dict[str, Any]:
    """Plan the agent's next round, or re-run the unfinished steps on a retry.

    Round 1 comes from the planning model; every later round runs the queries
    the evaluator asked for. A retry keeps the plan and every completed step
    and re-runs only the steps that did not complete — when all of them did
    (the crash was in Evaluate or Finalize) nothing runs and the state machine
    proceeds straight to Evaluate again.
    """
    job_id = job['id']
    existing = {step_id: step for step_id, step in (job.get('steps') or {}).items() if isinstance(step, dict)}
    round_number = int(job.get('round') or 0)
    timestamp = get_timestamp()

    names = {'#s': 'status', '#rnd': 'round'}
    values: dict[str, Any] = {':running': STATUS_RUNNING, ':ts': timestamp, ':arn': execution_arn}
    sets = ['#s = :running', 'updated_at = :ts', 'execution_arn = :arn']

    if retry and existing:
        to_run = []
        for index, (step_id, step) in enumerate(existing.items()):
            if step.get('status') == STEP_COMPLETED:
                continue
            reset = {**step_plan_fields(step), 'provider': step.get('provider', ''), 'status': STEP_PENDING}
            names[f'#st{index}'] = step_id
            values[f':st{index}'] = reset
            sets.append(f'steps.#st{index} = :st{index}')
            to_run.append({'step_id': step_id, 'provider': reset['provider']})
        values[':total'] = len(existing)
        sets.append('steps_total = :total')
        research_table.update_item(
            Key={'id': job_id},
            UpdateExpression=f"SET {', '.join(sets)} REMOVE error_message",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
        logger.info(f"Agent job {job_id}: retry re-runs {len(to_run)} of {len(existing)} steps (round {round_number})")
        return {'job_id': job_id, 'steps': to_run, 'retry': False}

    if round_number >= _agent_max_rounds(job):
        # Nothing left to plan; Evaluate forces `stop` at the round cap.
        return {'job_id': job_id, 'steps': [], 'retry': False}

    strategy = ''
    if round_number == 0:
        planned = _plan_first_round(job)
        queries, strategy = planned['queries'], planned['strategy']
    else:
        rounds = job.get('rounds') or []
        last = rounds[-1] if rounds and isinstance(rounds[-1], dict) else {}
        queries = list((last.get('evaluation') or {}).get('next_queries') or [])
    if not queries:
        return {'job_id': job_id, 'steps': [], 'retry': False}

    new_round = round_number + 1
    new_steps = assign_steps(queries, provider_ids, new_round, with_signals=bool(get_api_key(SIGNALS_SECRET_NAME)))
    round_info = {
        'round': new_round,
        'planned_at': timestamp,
        'strategy': strategy,
        'queries': queries,
        'step_ids': list(new_steps),
    }
    values.update({':rnd': new_round, ':round_info': [round_info], ':empty': [], ':total': len(existing) + len(new_steps)})
    sets += ['#rnd = :rnd', 'rounds = list_append(if_not_exists(rounds, :empty), :round_info)', 'steps_total = :total']
    if not existing:
        values[':steps'] = new_steps
        sets.append('steps = :steps')
    else:
        for index, (step_id, step) in enumerate(new_steps.items()):
            names[f'#st{index}'] = step_id
            values[f':st{index}'] = step
            sets.append(f'steps.#st{index} = :st{index}')

    research_table.update_item(
        Key={'id': job_id},
        UpdateExpression=f"SET {', '.join(sets)} REMOVE error_message",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    to_run = [{'step_id': step_id, 'provider': step['provider']} for step_id, step in new_steps.items()]
    logger.info(f"Agent job {job_id}: planned round {new_round} with {len(queries)} queries as {len(to_run)} steps")
    return {'job_id': job_id, 'steps': to_run, 'retry': False}


def _run_signals_step(config: dict[str, Any], planned: dict[str, Any]) -> dict[str, Any]:
    """Google related searches / questions / autocomplete for every query of the round."""
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
            for candidate in fetch_google_signals(api_key, query, country=config.get('country', 'us'), language=config.get('language', 'en')):
                keywords.append({**candidate, 'dimension': dimension})
        except Exception as exc:
            errors.append(f'{query}: {_error_text(exc)}')
    if not keywords and errors:
        raise StepFailedError('; '.join(errors)[:ERROR_MESSAGE_LIMIT])
    result: dict[str, Any] = {'keywords': keywords, 'keyword_count': len(keywords)}
    if errors:
        result['warnings'] = errors[:5]
    return result


def _run_agent_step(job: dict[str, Any], planned: dict[str, Any], provider_id: str) -> dict[str, Any]:
    """Run one planned query on its provider (or the round's signals step)."""
    config = job.get('config') or {}
    if provider_id == SIGNALS_PROVIDER_ID:
        return _run_signals_step(config, planned)

    provider = get_web_search_provider(provider_id)
    if provider is None:
        raise StepFailedError(f'Unknown provider {provider_id!r}')
    api_key = get_api_key(provider.secret_name)
    if not api_key:
        raise StepFailedError(f'{provider_id} is not configured')
    client = provider.client_class(api_key)

    dimension = planned.get('dimension', OTHER_DIMENSION)
    prompt = build_search_prompt(config, planned.get('query', ''), dimension)
    text = run_web_search(provider, client, prompt, max_retries=STEP_MAX_RETRIES)
    result = _parse_expansion(text)
    for keyword in result['keywords']:
        keyword.setdefault('dimension', dimension)
    result['raw_response'] = text[:RAW_RESPONSE_LIMIT]
    return result


def _stop_evaluation(reason: str) -> dict[str, Any]:
    return {'assessment': '', 'decision': 'stop', 'reason': reason, 'next_queries': []}


def _evaluate_round(job: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    """Ask the evaluation model whether another round is worth it.

    Model errors degrade to ``stop`` (recorded as the reason) instead of
    failing the job: the keywords found so far are still worth finalizing.
    """
    config = job.get('config') or {}
    try:
        text = invoke_bedrock(
            build_evaluate_prompt(config, int(job.get('round') or 0), candidates),
            ModelRole.RESEARCH_EVALUATION,
            max_tokens=EVALUATE_MAX_TOKENS,
            system=_agent_system_prompt(job),
        )
    except Exception as exc:
        logger.warning(f"Agent job {job['id']}: evaluation model failed: {exc}")
        return _stop_evaluation(f'The evaluation model failed ({_error_text(exc)}); finishing with the keywords found so far.')
    evaluation = parse_evaluation(text, config, exclude_queries=planned_query_texts(job))
    if evaluation is None:
        return _stop_evaluation('The evaluation model returned no usable decision; finishing with the keywords found so far.')
    return evaluation


def evaluate(event: dict[str, Any]) -> dict[str, Any]:
    """Agent only: judge the round just finished and decide continue | stop."""
    job_id = event['job_id']
    job = _load_job(job_id)
    if job.get('type') != TYPE_AGENT:
        return {'job_id': job_id, 'decision': 'stop', 'retry': False}

    round_number = int(job.get('round') or 0)
    max_rounds = _agent_max_rounds(job)
    candidates = _agent_candidates(job)
    if round_number >= max_rounds:
        evaluation = _stop_evaluation(f'Reached the maximum of {max_rounds} round{"s" if max_rounds != 1 else ""}.')
    elif not candidates:
        evaluation = _stop_evaluation('No candidate keywords were found; nothing to expand.')
    else:
        evaluation = _evaluate_round(job, candidates)

    evaluation = {**evaluation, 'candidate_count': len(candidates), 'evaluated_at': get_timestamp()}
    if round_number >= 1:
        research_table.update_item(
            Key={'id': job_id},
            UpdateExpression=f'SET rounds[{round_number - 1}].evaluation = :ev, updated_at = :ts',
            ExpressionAttributeValues={':ev': convert_floats_to_decimal(evaluation), ':ts': evaluation['evaluated_at']},
        )
    logger.info(f"Agent job {job_id}: round {round_number} evaluated -> {evaluation['decision']} ({len(candidates)} candidates)")
    return {'job_id': job_id, 'decision': evaluation['decision'], 'round': round_number, 'retry': False}


def _select_proposal(job: dict[str, Any], candidates: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    """The final ranked list: model-selected, or the top candidates when the model fails."""
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
    except Exception as exc:
        logger.warning(f"Agent job {job['id']}: selection model failed: {exc}")
        proposal = None
    if proposal:
        return proposal, 'model'
    return fallback_selection(config, candidates), 'fallback'


def _parse_expansion(text: str) -> dict[str, Any]:
    parsed = parse_llm_json(text, expect='array')
    if parsed is None:
        raise StepFailedError('Provider returned no parseable keyword list')
    keywords = [entry for entry in parsed if isinstance(entry, dict) and isinstance(entry.get('keyword'), str)]
    return {'keywords': keywords, 'keyword_count': len(keywords)}


def _parse_competitor(text: str, page_data: dict[str, Any]) -> dict[str, Any]:
    parsed = parse_llm_json(text, expect='object')
    if parsed is None:
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
    """Query one provider for the job and return the step result fields."""
    provider = get_web_search_provider(provider_id)
    if provider is None:
        raise StepFailedError(f'Unknown provider {provider_id!r}')
    api_key = get_api_key(provider.secret_name)
    if not api_key:
        raise StepFailedError(f'{provider_id} is not configured')
    client = provider.client_class(api_key)

    if job.get('type') == TYPE_COMPETITOR:
        page_data = job.get('page_data') or {}
        prompt = build_competitor_prompt(job.get('domain', ''), page_data)
        text = run_web_search(provider, client, prompt, max_retries=STEP_MAX_RETRIES)
        result = _parse_competitor(text, page_data)
    else:
        prompt = build_expansion_prompt(job.get('seed_keyword', ''), job.get('industry', 'general'), int(job.get('count') or 20))
        text = run_web_search(provider, client, prompt, max_retries=STEP_MAX_RETRIES)
        result = _parse_expansion(text)

    result['raw_response'] = text[:RAW_RESPONSE_LIMIT]
    return result


def execute_step(event: dict[str, Any]) -> dict[str, Any]:
    job_id, step_id, provider_id = event['job_id'], event['step_id'], event['provider']
    job = _load_job(job_id)
    # Agent steps carry their planned query; every status write keeps it.
    planned = step_plan_fields((job.get('steps') or {}).get(step_id) or {})
    started_at = get_timestamp()
    _write_step(job_id, step_id, {**planned, 'provider': provider_id, 'status': STEP_RUNNING, 'started_at': started_at})

    try:
        result = _run_agent_step(job, planned, provider_id) if job.get('type') == TYPE_AGENT else _run_step(job, provider_id)
        step = {**planned, 'provider': provider_id, 'status': STEP_COMPLETED, 'started_at': started_at, 'finished_at': get_timestamp(), **result}
        logger.info(f"Step {step_id} of job {job_id} completed with {result['keyword_count']} keywords")
    except Exception as e:
        # Provider errors belong to this step alone: record them and return
        # normally so the other providers' steps still count.
        logger.warning(f"Step {step_id} of job {job_id} failed: {e}")
        step = {
            **planned,
            'provider': provider_id,
            'status': STEP_FAILED,
            'started_at': started_at,
            'finished_at': get_timestamp(),
            'error_message': _error_text(e),
        }

    _write_step(job_id, step_id, step)
    return {'job_id': job_id, 'step_id': step_id, 'status': step['status']}


def fail_step(event: dict[str, Any]) -> dict[str, Any]:
    """Record a step whose worker invocation died (Lambda timeout, crash)."""
    job_id, step_id = event['job_id'], event['step_id']
    planned: dict[str, Any] = {}
    with contextlib.suppress(Exception):
        planned = step_plan_fields((_load_job(job_id).get('steps') or {}).get(step_id) or {})
    step = {
        **planned,
        'provider': event.get('provider', ''),
        'status': STEP_FAILED,
        'finished_at': get_timestamp(),
        'error_message': _error_text(event.get('error')),
    }
    written = _write_step(job_id, step_id, step, unless_completed=True)
    return {'job_id': job_id, 'step_id': step_id, 'status': STEP_FAILED if written else STEP_COMPLETED}


def _failure_summary(job: dict[str, Any]) -> str:
    failed = [
        f"{step.get('provider', step_id)}: {step.get('error_message') or 'failed'}"
        for step_id, step in sorted((job.get('steps') or {}).items())
        if isinstance(step, dict) and step.get('status') == STEP_FAILED
    ]
    if not failed:
        return 'No provider produced a result'
    return '; '.join(failed)[:ERROR_MESSAGE_LIMIT]


def finalize(event: dict[str, Any]) -> dict[str, Any]:
    job_id = event['job_id']
    job = _load_job(job_id)
    summary = summarize_job(job)
    status = final_status(job)

    names = {'#s': 'status'}
    values: dict[str, Any] = {
        ':s': status,
        ':kc': summary['keyword_count'],
        ':sd': summary['steps_done'],
        ':sf': summary['steps_failed'],
        ':p': summary['provider'],
        ':ts': get_timestamp(),
    }
    sets = ['#s = :s', 'keyword_count = :kc', 'steps_done = :sd', 'steps_failed = :sf', 'provider = :p', 'finished_at = :ts', 'updated_at = :ts']
    if job.get('type') == TYPE_COMPETITOR:
        analysis = summary['analysis']
        values[':a'] = convert_floats_to_decimal(analysis)
        values[':ind'] = analysis.get('industry', 'unknown')
        values[':pf'] = analysis.get('page_focus', '')
        sets += ['analysis = :a', 'industry = :ind', 'page_focus = :pf']
    elif job.get('type') == TYPE_AGENT:
        # `keywords` is the proposal the user reviews; the merged candidates
        # stay on the steps (and in the trace counts).
        proposal, source = _select_proposal(job, summary['keywords'])
        values.update({
            ':kw': convert_floats_to_decimal(proposal),
            ':kc': len(proposal),
            ':cc': summary['keyword_count'],
            ':src': source,
        })
        sets += ['keywords = :kw', 'candidates_count = :cc', 'proposal_source = :src']
    else:
        values[':kw'] = convert_floats_to_decimal(summary['keywords'])
        sets.append('keywords = :kw')

    expression = f"SET {', '.join(sets)}"
    if status == STATUS_COMPLETED:
        expression += ' REMOVE error_message'
    else:
        values[':e'] = _failure_summary(job)
        expression += ', error_message = :e'

    research_table.update_item(
        Key={'id': job_id},
        UpdateExpression=expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    logger.info(f"Finalized research job {job_id}: status={status} keywords={values[':kc']}")
    return {'job_id': job_id, 'status': status, 'keyword_count': values[':kc']}


def fail(event: dict[str, Any]) -> dict[str, Any]:
    """Mark the whole job failed after Plan or Finalize crashed."""
    job_id = event['job_id']
    message = _error_text(event.get('error'))
    try:
        job = _load_job(job_id)
    except ResearchJobNotFoundError:
        logger.error(f"Research job {job_id} vanished before it could be failed: {message}")
        return {'job_id': job_id, 'status': STATUS_FAILED}

    if job.get('status') in TERMINAL_STATUSES:
        return {'job_id': job_id, 'status': job['status']}

    names = {'#s': 'status'}
    values: dict[str, Any] = {':s': STATUS_FAILED, ':e': message, ':ts': get_timestamp()}
    sets = ['#s = :s', 'error_message = :e', 'finished_at = :ts', 'updated_at = :ts']
    for index, (step_id, step) in enumerate((job.get('steps') or {}).items()):
        if isinstance(step, dict) and step.get('status') != STEP_COMPLETED:
            names[f'#st{index}'] = step_id
            values[f':st{index}'] = {**step, 'status': STEP_FAILED, 'error_message': step.get('error_message') or message}
            sets.append(f'steps.#st{index} = :st{index}')

    research_table.update_item(
        Key={'id': job_id},
        UpdateExpression=f"SET {', '.join(sets)}",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    logger.error(f"Research job {job_id} failed: {message}")
    return {'job_id': job_id, 'status': STATUS_FAILED}


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
    logger.info(f"Research worker action={action} job_id={event.get('job_id')} step_id={event.get('step_id')}")
    return ACTIONS[action](event)
