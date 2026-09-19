"""
Keyword research jobs: row shape, step bookkeeping and result merging.

A research job (keyword expansion or competitor analysis) is one row in
``CitationAnalysis-KeywordResearch`` and runs as one execution of the
``CitationAnalysis-KeywordResearch`` state machine:

    Plan -> Map(ExecuteStep, parallel) -> Finalize

Every configured web-search provider is a *step*; each step writes its own
result under ``steps.<step_id>`` the moment it finishes, so a provider that
times out or a worker that dies loses only its own step, never the job.
``Finalize`` merges the completed steps into the job-level result. The API
also merges on read while a job is still running, so partial results are
visible before the job ends. Agent jobs (``shared.research_agent``) reuse
the same row and step bookkeeping with model-planned steps and rounds.

Statuses::

    pending   row created, execution starting
    running   Plan has run; steps are executing
    completed every step succeeded
    partial   at least one step succeeded and at least one failed
    failed    no step produced a result (or the execution died)

Both the API Lambda and the worker import this module, so the two never
disagree on the row shape.
"""

from __future__ import annotations

import time
from typing import Any

from shared.research_agent import LEGACY_AUDIENCE, LEGACY_DIMENSION_CATALOG, LEGACY_SUBJECT
from shared.utils import get_timestamp, normalize_keyword

STATUS_PENDING = 'pending'
STATUS_RUNNING = 'running'
STATUS_COMPLETED = 'completed'
STATUS_PARTIAL = 'partial'
STATUS_FAILED = 'failed'
TERMINAL_STATUSES = frozenset({STATUS_COMPLETED, STATUS_PARTIAL, STATUS_FAILED})
ACTIVE_STATUSES = frozenset({STATUS_PENDING, STATUS_RUNNING})

STEP_PENDING = 'pending'
STEP_RUNNING = 'running'
STEP_COMPLETED = 'completed'
STEP_FAILED = 'failed'

TYPE_EXPANSION = 'expansion'
TYPE_COMPETITOR = 'competitor'
# Research agent (2.5.0): steps are planned by a model per round instead of
# one per provider; ``shared.research_agent`` owns the config and prompts.
TYPE_AGENT = 'agent'
JOB_TYPES = (TYPE_EXPANSION, TYPE_COMPETITOR, TYPE_AGENT)

# Rows expire after 90 days; the UI's history view never needs older jobs and
# the table otherwise grows forever (there was no TTL before 2.2.0).
RESEARCH_TTL_SECONDS = 90 * 24 * 3600

# The state machine times out at 30 minutes; a job still non-terminal after
# that has lost its execution and can be swept to failed.
RESEARCH_STALE_AFTER_SECONDS = 35 * 60

COMPETITOR_CATEGORIES = ('primary_keywords', 'secondary_keywords', 'longtail_keywords', 'content_gaps')
RAW_RESPONSE_LIMIT = 5000


def ttl_epoch(now: float | None = None) -> int:
    return int((now if now is not None else time.time()) + RESEARCH_TTL_SECONDS)


def step_id_for(provider_id: str, round_number: int = 1) -> str:
    """Deterministic step id: one step per provider per round."""
    return f'r{round_number}-{provider_id}'


def build_job_item(job_id: str, job_type: str, request: dict[str, Any], *, timestamp: str | None = None) -> dict[str, Any]:
    """Row written by the API before the execution starts."""
    stamp = timestamp or get_timestamp()
    item: dict[str, Any] = {
        'id': job_id,
        'type': job_type,
        'status': STATUS_PENDING,
        'keyword_count': 0,
        'steps': {},
        'steps_total': 0,
        'steps_done': 0,
        'created_at': stamp,
        'updated_at': stamp,
        'ttl': ttl_epoch(),
    }
    item.update(request)
    return item


def completed_steps(job: dict[str, Any]) -> list[dict[str, Any]]:
    steps = job.get('steps') or {}
    return [step for step in steps.values() if isinstance(step, dict) and step.get('status') == STEP_COMPLETED]


def failed_steps(job: dict[str, Any]) -> list[dict[str, Any]]:
    steps = job.get('steps') or {}
    return [step for step in steps.values() if isinstance(step, dict) and step.get('status') == STEP_FAILED]


def _relevance(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def merge_expansion_keywords(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge per-provider keyword lists into one deduplicated, ranked list.

    Keywords are deduplicated on the canonical keyword identity; the entry with
    the highest relevance wins and every provider that proposed the keyword is
    recorded in ``providers``. Sorted by relevance desc, then text.
    """
    merged: dict[str, dict[str, Any]] = {}
    for step in steps:
        provider = step.get('provider', '')
        for entry in step.get('keywords') or []:
            if not isinstance(entry, dict):
                continue
            text = entry.get('keyword')
            if not isinstance(text, str) or not text.strip():
                continue
            key = normalize_keyword(text)
            if not key:
                continue
            candidate = {**entry, 'keyword': text.strip()}
            existing = merged.get(key)
            if existing is None:
                candidate['providers'] = [provider] if provider else []
                merged[key] = candidate
                continue
            providers = existing.get('providers', [])
            if provider and provider not in providers:
                providers.append(provider)
            if _relevance(candidate.get('relevance')) > _relevance(existing.get('relevance')):
                merged[key] = {**candidate, 'providers': providers}
            else:
                existing['providers'] = providers
    return sorted(
        merged.values(),
        key=lambda entry: (-_relevance(entry.get('relevance')), -len(entry.get('providers', [])), entry['keyword'].casefold()),
    )


def merge_competitor_analyses(steps: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge per-provider competitor analyses: union of each category, deduplicated."""
    result: dict[str, Any] = {
        'domain': '',
        'industry': 'unknown',
        'page_focus': '',
        'primary_keywords': [],
        'secondary_keywords': [],
        'longtail_keywords': [],
        'content_gaps': [],
    }
    seen: set[str] = set()
    for step in steps:
        analysis = step.get('analysis') or {}
        if not isinstance(analysis, dict):
            continue
        for field in ('domain', 'industry', 'page_focus'):
            value = analysis.get(field)
            if isinstance(value, str) and value and (not result[field] or result[field] == 'unknown'):
                result[field] = value
        for category in COMPETITOR_CATEGORIES:
            for entry in analysis.get(category) or []:
                if not isinstance(entry, dict):
                    continue
                text = entry.get('keyword')
                if not isinstance(text, str) or not text.strip():
                    continue
                key = normalize_keyword(text)
                if not key or key in seen:
                    continue
                seen.add(key)
                result[category].append({**entry, 'keyword': text.strip(), 'provider': step.get('provider', '')})
        if analysis.get('seo_elements') and 'seo_elements' not in result:
            result['seo_elements'] = analysis['seo_elements']
    return result


def summarize_job(job: dict[str, Any]) -> dict[str, Any]:
    """Compute the merged result and counters for the job's current steps.

    Used by Finalize (to persist) and by the read API (to expose partial
    results while the job is still running).
    """
    done = completed_steps(job)
    failed = failed_steps(job)
    if job.get('type') == TYPE_COMPETITOR:
        analysis = merge_competitor_analyses(done)
        count = sum(len(analysis.get(category, [])) for category in COMPETITOR_CATEGORIES)
        result: dict[str, Any] = {'analysis': analysis}
    else:
        keywords = merge_expansion_keywords(done)
        count = len(keywords)
        result = {'keywords': keywords}
    result['keyword_count'] = count
    result['steps_done'] = len(done) + len(failed)
    result['steps_failed'] = len(failed)
    result['provider'] = ', '.join(sorted({step.get('provider', '') for step in done if step.get('provider')}))
    return result


def final_status(job: dict[str, Any]) -> str:
    """Terminal status implied by the step outcomes."""
    done = completed_steps(job)
    failed = failed_steps(job)
    if done and not failed:
        return STATUS_COMPLETED
    if done:
        return STATUS_PARTIAL
    return STATUS_FAILED


def public_view(job: dict[str, Any], *, include_raw: bool = False) -> dict[str, Any]:
    """Shape a job row for API responses.

    While the job is running the merged result is computed from the steps
    that have already completed, so clients can render progress. Step raw
    responses are stripped unless asked for.
    """
    view = {key: value for key, value in job.items() if key not in ('steps', 'raw_response', 'ttl')}
    steps = job.get('steps') or {}
    view['steps'] = [
        {
            'step_id': step_id,
            'provider': step.get('provider', ''),
            'status': step.get('status', STEP_PENDING),
            'keyword_count': step.get('keyword_count', 0),
            'error_message': step.get('error_message'),
            'started_at': step.get('started_at'),
            'finished_at': step.get('finished_at'),
            # Agent steps carry what was planned for them (absent otherwise).
            **{key: step[key] for key in ('round', 'query', 'dimension') if key in step},
            **({'query_count': len(step['queries'])} if isinstance(step.get('queries'), list) else {}),
        }
        for step_id, step in sorted(steps.items())
        if isinstance(step, dict)
    ]
    view['steps_total'] = int(job.get('steps_total') or len(view['steps']))
    if job.get('type') == TYPE_AGENT and isinstance(view.get('config'), dict):
        view['config'] = with_legacy_profile(view['config'])
    if job.get('status') in ACTIVE_STATUSES and steps:
        # Progressive results: merge whatever has completed so far.
        view.update(summarize_job(job))
    if include_raw and job.get('raw_response'):
        view['raw_response'] = job['raw_response']
    return view


def with_legacy_profile(config: dict[str, Any]) -> dict[str, Any]:
    """An agent config with subject, audience and dimension catalogue present.

    Runs from before 2.6.0 stored none of the three; they were all hotel
    runs, so the hotel template's values are what they researched with. The
    stored row is never touched — only the API view is completed.
    """
    if config.get('dimension_catalog'):
        return config
    return {
        **config,
        'subject': config.get('subject') or LEGACY_SUBJECT,
        'audience': config.get('audience') or LEGACY_AUDIENCE,
        'dimension_catalog': [dict(dimension) for dimension in LEGACY_DIMENSION_CATALOG],
    }
