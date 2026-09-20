"""
Keyword research job persistence, bounded checkpoints and result merging.

A job is one DynamoDB row and one active Step Functions execution attempt.
Every mutation is fenced by the worker with the row's monotonic ``attempt``,
active execution ARN and active round. Provider calls are at-least-once: a
Lambda retry can repeat an external call, but a completed checkpoint is never
replaced and stale executions cannot mutate a newer attempt.
"""

from __future__ import annotations

import time
from decimal import Decimal
from typing import Any

from shared.research_agent import (
    LEGACY_AUDIENCE,
    LEGACY_DIMENSION_CATALOG,
    LEGACY_SUBJECT,
    config_tracking_count,
)
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
STEP_TERMINAL_STATUSES = frozenset({STEP_COMPLETED, STEP_FAILED})

TYPE_EXPANSION = 'expansion'
TYPE_COMPETITOR = 'competitor'
TYPE_AGENT = 'agent'
JOB_TYPES = (TYPE_EXPANSION, TYPE_COMPETITOR, TYPE_AGENT)

RESEARCH_TTL_SECONDS = 90 * 24 * 3600
RESEARCH_STALE_AFTER_SECONDS = 35 * 60

COMPETITOR_CATEGORIES = ('primary_keywords', 'secondary_keywords', 'longtail_keywords', 'content_gaps')

# DynamoDB allows 400 KiB per item. Agent jobs persist at most
# AGENT_MAX_QUERIES_PER_ROUND + 1 steps (one signals step) per round for
# AGENT_MAX_ROUNDS rounds. These per-field budgets leave substantial headroom
# for config, plans, evaluations and attribute-name overhead;
# test_research_jobs.py proves a maximal row composed from them stays below a
# conservative 300 KB.
STEP_RESULT_MAX_BYTES = 6_000
ROUND_PLAN_MAX_BYTES = 8_000
ROUND_CHECKPOINT_MAX_BYTES = 12_000
FINAL_PROPOSAL_MAX_BYTES = 55_000
STEP_CANDIDATE_LIMIT = 50
COMPETITOR_CATEGORY_CANDIDATE_LIMIT = 5
FINAL_PROPOSAL_CANDIDATE_LIMIT = 100
RAW_RESPONSE_LIMIT = 1_500
KEYWORD_TEXT_LIMIT = 200
CANDIDATE_SOURCE_LIMIT = 300
CANDIDATE_RATIONALE_LIMIT = 300
CANDIDATE_LABEL_LIMIT = 40
PROVIDER_COUNT_LIMIT = 5
WARNING_COUNT_LIMIT = 5
WARNING_TEXT_LIMIT = 300


def ttl_epoch(now: float | None = None) -> int:
    return int((now if now is not None else time.time()) + RESEARCH_TTL_SECONDS)


def step_id_for(provider_id: str, round_number: int = 1) -> str:
    """Deterministic step id: one step per provider per round."""
    return f'r{round_number}-{provider_id}'


def build_job_item(job_id: str, job_type: str, request: dict[str, Any], *, timestamp: str | None = None) -> dict[str, Any]:
    """Build the pending row written before attempt one starts."""
    stamp = timestamp or get_timestamp()
    item: dict[str, Any] = {
        'id': job_id,
        'type': job_type,
        'status': STATUS_PENDING,
        'attempt': 1,
        'retry_count': 0,
        'attempt_started_at': stamp,
        'round': 0,
        'keyword_count': 0,
        'steps': {},
        'steps_total': 0,
        'steps_done': 0,
        'checkpoint_revision': 0,
        'created_at': stamp,
        'updated_at': stamp,
        'ttl': ttl_epoch(),
    }
    item.update(request)
    return item


def job_attempt(job: dict[str, Any]) -> int:
    """Current attempt, including the deterministic value for legacy rows."""
    return int(job.get('attempt') or int(job.get('retry_count') or 0) + 1)


def _steps_with_status(job: dict[str, Any], status: str, *, through_round: int | None) -> list[dict[str, Any]]:
    steps = job.get('steps') or {}
    return [
        step for step in steps.values()
        if isinstance(step, dict)
        and step.get('status') == status
        and (through_round is None or int(step.get('round') or 1) <= through_round)
    ]


def completed_steps(job: dict[str, Any], *, through_round: int | None = None) -> list[dict[str, Any]]:
    return _steps_with_status(job, STEP_COMPLETED, through_round=through_round)


def failed_steps(job: dict[str, Any], *, through_round: int | None = None) -> list[dict[str, Any]]:
    return _steps_with_status(job, STEP_FAILED, through_round=through_round)


def retry_start_round(job: dict[str, Any]) -> int:
    """Earliest unfinished persisted round, or the latest round for replay."""
    if job.get('type') != TYPE_AGENT:
        return 1
    rounds = sorted({
        int(step.get('round') or 1)
        for step in (job.get('steps') or {}).values()
        if isinstance(step, dict)
    })
    for round_number in rounds:
        round_steps = [
            step for step in (job.get('steps') or {}).values()
            if isinstance(step, dict) and int(step.get('round') or 1) == round_number
        ]
        if any(step.get('status') != STEP_COMPLETED for step in round_steps):
            return round_number
    return max(1, int(job.get('round') or 0))


def persisted_size_bytes(value: Any) -> int:
    """Deterministic conservative size measure for values persisted in DynamoDB.

    DynamoDB item size is based on UTF-8 attribute names and values. Container
    markers are counted too, making this helper slightly conservative while
    remaining independent of JSON formatting and Decimal serialization.
    """
    if isinstance(value, dict):
        return 2 + sum(len(str(key).encode('utf-8')) + persisted_size_bytes(item) for key, item in value.items())
    if isinstance(value, (list, tuple, set)):
        return 2 + sum(1 + persisted_size_bytes(item) for item in value)
    if isinstance(value, str):
        return len(value.encode('utf-8'))
    if isinstance(value, bytes):
        return len(value)
    if value is None or isinstance(value, bool):
        return 1
    if isinstance(value, (int, float, Decimal)):
        return len(str(value).encode('utf-8'))
    return len(str(value).encode('utf-8'))


def _utf8_prefix(value: Any, max_bytes: int) -> tuple[str, bool]:
    if not isinstance(value, str):
        return '', False
    collapsed = ' '.join(value.split())
    encoded = collapsed.encode('utf-8')
    if len(encoded) <= max_bytes:
        return collapsed, False
    return encoded[:max_bytes].decode('utf-8', errors='ignore'), True


def _bounded_round_queries(value: Any) -> tuple[list[dict[str, str]], int, bool]:
    if not isinstance(value, list):
        return [], 0, False
    queries: list[dict[str, str]] = []
    strings_truncated = False
    for entry in value[:8]:
        if not isinstance(entry, dict):
            continue
        query, query_truncated = _utf8_prefix(entry.get('query'), 400)
        dimension, dimension_truncated = _utf8_prefix(entry.get('dimension'), 40)
        rationale, rationale_truncated = _utf8_prefix(entry.get('rationale'), 300)
        strings_truncated = strings_truncated or query_truncated or dimension_truncated or rationale_truncated
        if query:
            queries.append({
                'query': query,
                'dimension': dimension or 'other',
                'rationale': rationale,
            })
    return queries, len(value), strings_truncated or len(value) > 8


def bound_round_plan(round_info: dict[str, Any]) -> dict[str, Any]:
    """Bound one immutable round plan independently of model character widths."""
    queries, received, strings_truncated = _bounded_round_queries(round_info.get('queries'))
    strategy, strategy_truncated = _utf8_prefix(round_info.get('strategy'), 600)
    planned_at, timestamp_truncated = _utf8_prefix(round_info.get('planned_at'), 40)
    step_ids = []
    raw_step_ids = round_info.get('step_ids')
    if isinstance(raw_step_ids, list):
        for step_id in raw_step_ids[:9]:
            text, truncated = _utf8_prefix(step_id, 100)
            strings_truncated = strings_truncated or truncated
            if text:
                step_ids.append(text)
        strings_truncated = strings_truncated or len(raw_step_ids) > 9
    bounded = {
        'round': int(round_info.get('round') or 1),
        'planned_at': planned_at,
        'planned_attempt': int(round_info.get('planned_attempt') or 1),
        'strategy': strategy,
        'queries': queries,
        'step_ids': step_ids,
        'plan_truncation': {
            'queries_received': received,
            'queries_stored': len(queries),
            'strings_truncated': strings_truncated or strategy_truncated or timestamp_truncated,
            'size_limited': False,
        },
    }
    while persisted_size_bytes(bounded) > ROUND_PLAN_MAX_BYTES and queries:
        queries.pop()
        bounded['plan_truncation']['size_limited'] = True
    bounded['plan_truncation']['queries_stored'] = len(queries)
    return bounded


def bound_round_evaluation(round_info: dict[str, Any], evaluation: dict[str, Any]) -> dict[str, Any]:
    """Bound an evaluation so its complete persisted round stays composable."""
    next_queries, received, strings_truncated = _bounded_round_queries(evaluation.get('next_queries'))
    assessment, assessment_truncated = _utf8_prefix(evaluation.get('assessment'), 1_000)
    reason, reason_truncated = _utf8_prefix(evaluation.get('reason'), 500)
    evaluated_at, timestamp_truncated = _utf8_prefix(evaluation.get('evaluated_at'), 40)
    decision = 'continue' if evaluation.get('decision') == 'continue' and next_queries else 'stop'
    if decision == 'stop':
        next_queries = []
    bounded: dict[str, Any] = {
        'assessment': assessment,
        'decision': decision,
        'reason': reason,
        'next_queries': next_queries,
        'candidate_count': max(0, int(evaluation.get('candidate_count') or 0)),
        'evaluated_at': evaluated_at,
        'evaluation_truncation': {
            'queries_received': received,
            'queries_stored': len(next_queries),
            'strings_truncated': strings_truncated or assessment_truncated or reason_truncated or timestamp_truncated,
            'size_limited': False,
        },
    }
    plan = bound_round_plan(round_info)
    while persisted_size_bytes({**plan, 'evaluation': bounded}) > ROUND_CHECKPOINT_MAX_BYTES and len(next_queries) > 1:
        next_queries.pop()
        bounded['evaluation_truncation']['size_limited'] = True
    bounded['evaluation_truncation']['queries_stored'] = len(next_queries)
    return bounded


def _bounded_text(value: Any, limit: int) -> tuple[str, bool]:
    return _utf8_prefix(value, limit)


def _relevance(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _bounded_candidate(entry: Any) -> tuple[dict[str, Any] | None, bool]:
    if not isinstance(entry, dict):
        return None, False
    keyword, truncated = _bounded_text(entry.get('keyword'), KEYWORD_TEXT_LIMIT)
    if not keyword:
        return None, truncated
    candidate: dict[str, Any] = {'keyword': keyword}
    for field, limit in (
        ('intent', CANDIDATE_LABEL_LIMIT),
        ('competition', CANDIDATE_LABEL_LIMIT),
        ('dimension', CANDIDATE_LABEL_LIMIT),
        ('source', CANDIDATE_SOURCE_LIMIT),
        ('opportunity', CANDIDATE_RATIONALE_LIMIT),
        ('rationale', CANDIDATE_RATIONALE_LIMIT),
    ):
        text, was_truncated = _bounded_text(entry.get(field), limit)
        truncated = truncated or was_truncated
        if text:
            candidate[field] = text
    relevance = entry.get('relevance')
    if isinstance(relevance, (int, float, Decimal)) and not isinstance(relevance, bool):
        candidate['relevance'] = relevance
    providers = entry.get('providers')
    if isinstance(providers, list):
        bounded_providers = []
        for provider in providers:
            text, was_truncated = _bounded_text(provider, CANDIDATE_LABEL_LIMIT)
            truncated = truncated or was_truncated
            if text and text not in bounded_providers:
                bounded_providers.append(text)
            if len(bounded_providers) >= PROVIDER_COUNT_LIMIT:
                truncated = truncated or len(providers) > PROVIDER_COUNT_LIMIT
                break
        if bounded_providers:
            candidate['providers'] = bounded_providers
    return candidate, truncated


def _ranked_candidates(entries: Any, limit: int) -> tuple[list[dict[str, Any]], int, bool]:
    if not isinstance(entries, list):
        return [], 0, False
    candidates: list[tuple[int, dict[str, Any]]] = []
    strings_truncated = False
    for index, entry in enumerate(entries):
        candidate, truncated = _bounded_candidate(entry)
        strings_truncated = strings_truncated or truncated
        if candidate is not None:
            candidates.append((index, candidate))
    candidates.sort(key=lambda item: (-_relevance(item[1].get('relevance')), item[0], item[1]['keyword'].casefold()))
    received = len(candidates)
    return [candidate for _index, candidate in candidates[:limit]], received, strings_truncated


def _bounded_queries(value: Any) -> tuple[list[dict[str, str]], bool]:
    if not isinstance(value, list):
        return [], False
    queries: list[dict[str, str]] = []
    truncated = False
    for entry in value[:8]:
        if not isinstance(entry, dict):
            continue
        query, query_truncated = _bounded_text(entry.get('query'), KEYWORD_TEXT_LIMIT)
        dimension, dimension_truncated = _bounded_text(entry.get('dimension'), CANDIDATE_LABEL_LIMIT)
        truncated = truncated or query_truncated or dimension_truncated
        if query:
            queries.append({'query': query, 'dimension': dimension or 'other'})
    return queries, truncated or len(value) > 8


def _bounded_warnings(value: Any) -> tuple[list[str], bool]:
    """Cap a step's warnings to ``WARNING_COUNT_LIMIT`` entries of ``WARNING_TEXT_LIMIT`` characters each."""
    if not isinstance(value, list):
        return [], False
    warnings: list[str] = []
    truncated = False
    for warning in value[:WARNING_COUNT_LIMIT]:
        text, text_truncated = _bounded_text(warning, WARNING_TEXT_LIMIT)
        truncated = truncated or text_truncated
        if text:
            warnings.append(text)
    return warnings, truncated or len(value) > WARNING_COUNT_LIMIT


def _bounded_analysis(value: Any) -> tuple[dict[str, Any], int, int, bool]:
    analysis = value if isinstance(value, dict) else {}
    bounded: dict[str, Any] = {}
    strings_truncated = False
    for field, limit, default in (
        ('domain', 253, ''),
        ('industry', 100, 'unknown'),
        ('page_focus', CANDIDATE_RATIONALE_LIMIT, ''),
    ):
        text, truncated = _bounded_text(analysis.get(field), limit)
        strings_truncated = strings_truncated or truncated
        bounded[field] = text or default

    received = 0
    for category in COMPETITOR_CATEGORIES:
        candidates, category_received, truncated = _ranked_candidates(
            analysis.get(category), COMPETITOR_CATEGORY_CANDIDATE_LIMIT,
        )
        bounded[category] = candidates
        received += category_received
        strings_truncated = strings_truncated or truncated

    seo = analysis.get('seo_elements')
    if isinstance(seo, dict):
        bounded_seo: dict[str, Any] = {}
        for field, limit in (('title', 300), ('meta_description', 1_000)):
            text, truncated = _bounded_text(seo.get(field), limit)
            strings_truncated = strings_truncated or truncated
            if text:
                bounded_seo[field] = text
        for field, count in (('h1_tags', 3), ('h2_tags', 5)):
            values = seo.get(field)
            if isinstance(values, list):
                tags = []
                for item in values[:count]:
                    text, truncated = _bounded_text(item, 300)
                    strings_truncated = strings_truncated or truncated
                    if text:
                        tags.append(text)
                if tags:
                    bounded_seo[field] = tags
                strings_truncated = strings_truncated or len(values) > count
        if bounded_seo:
            bounded['seo_elements'] = bounded_seo

    stored = sum(len(bounded[category]) for category in COMPETITOR_CATEGORIES)
    return bounded, received, stored, strings_truncated


def _pop_lowest_candidate(step: dict[str, Any]) -> bool:
    keywords = step.get('keywords')
    if isinstance(keywords, list) and keywords:
        keywords.pop()
        step['keyword_count'] = len(keywords)
        return True
    analysis = step.get('analysis')
    if not isinstance(analysis, dict):
        return False
    populated = [category for category in COMPETITOR_CATEGORIES if analysis.get(category)]
    if not populated:
        return False
    category = min(
        populated,
        key=lambda name: (_relevance(analysis[name][-1].get('relevance')), -COMPETITOR_CATEGORIES.index(name)),
    )
    analysis[category].pop()
    step['keyword_count'] = sum(len(analysis[name]) for name in COMPETITOR_CATEGORIES)
    return True


def _fit_raw_response(step: dict[str, Any], raw_response: str) -> str:
    """Largest UTF-8-safe prefix that leaves the checkpoint within its budget."""
    low = 0
    high = min(len(raw_response), RAW_RESPONSE_LIMIT)
    while low < high:
        middle = (low + high + 1) // 2
        step['raw_response'] = raw_response[:middle]
        if persisted_size_bytes(step) <= STEP_RESULT_MAX_BYTES:
            low = middle
        else:
            high = middle - 1
    if low:
        return raw_response[:low]
    step.pop('raw_response', None)
    return ''


def bound_step_result(step: dict[str, Any]) -> dict[str, Any]:
    """Normalize and size-bound one complete step checkpoint.

    Unknown model fields are discarded. Candidate strings and counts are
    capped explicitly, then lowest-ranked candidates are removed only if the
    deterministic byte budget still requires it. Truncation metadata records
    what arrived and what remains.
    """
    bounded: dict[str, Any] = {}
    strings_truncated = False
    for field, limit in (
        ('provider', CANDIDATE_LABEL_LIMIT),
        ('status', CANDIDATE_LABEL_LIMIT),
        ('query', KEYWORD_TEXT_LIMIT),
        ('dimension', CANDIDATE_LABEL_LIMIT),
        ('rationale', CANDIDATE_RATIONALE_LIMIT),
        ('started_at', 40),
        ('finished_at', 40),
        ('error_message', 500),
    ):
        text, truncated = _bounded_text(step.get(field), limit)
        strings_truncated = strings_truncated or truncated
        if text:
            bounded[field] = text
    for field in ('round', 'attempt'):
        # Decimal, not just int: a step reloaded from DynamoDB carries these as
        # Decimal, and dropping them leaves the stored step without a `round`
        # for the worker's `steps.#sid.#step_round` write guard to match, which
        # stranded every provider step. See
        # `TestStepCheckpointSurvivesTheDynamoRoundTrip`.
        # `to_int` is deliberately not used: its 0 default would invent a round
        # for an absent field, and absent must stay absent.
        value = step.get(field)
        if isinstance(value, (int, Decimal)) and not isinstance(value, bool):
            bounded[field] = int(value)

    queries, queries_truncated = _bounded_queries(step.get('queries'))
    strings_truncated = strings_truncated or queries_truncated
    if queries:
        bounded['queries'] = queries

    warnings, warnings_truncated = _bounded_warnings(step.get('warnings'))
    strings_truncated = strings_truncated or warnings_truncated
    if warnings:
        bounded['warnings'] = warnings

    received = 0
    if 'analysis' in step:
        analysis, received, stored, analysis_truncated = _bounded_analysis(step.get('analysis'))
        bounded['analysis'] = analysis
        bounded['keyword_count'] = stored
        strings_truncated = strings_truncated or analysis_truncated
    else:
        keywords, received, keywords_truncated = _ranked_candidates(step.get('keywords'), STEP_CANDIDATE_LIMIT)
        bounded['keywords'] = keywords
        bounded['keyword_count'] = len(keywords)
        strings_truncated = strings_truncated or keywords_truncated

    raw_response = step.get('raw_response')
    raw = raw_response if isinstance(raw_response, str) else ''
    metadata = {
        'candidates_received': received,
        'candidates_stored': bounded['keyword_count'],
        'candidate_limit': STEP_CANDIDATE_LIMIT,
        'strings_truncated': strings_truncated,
        'raw_response_truncated': len(raw) > RAW_RESPONSE_LIMIT,
        'size_limited': False,
    }
    bounded['truncation'] = metadata

    while persisted_size_bytes(bounded) > STEP_RESULT_MAX_BYTES and _pop_lowest_candidate(bounded):
        metadata['size_limited'] = True
    metadata['candidates_stored'] = bounded['keyword_count']

    stored_raw = _fit_raw_response(bounded, raw)
    metadata['raw_response_truncated'] = metadata['raw_response_truncated'] or stored_raw != raw
    if stored_raw:
        bounded['raw_response'] = stored_raw
    return bounded


def bound_final_proposal(proposal: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Keep the ranked proposal prefix within explicit count and byte limits."""
    bounded: list[dict[str, Any]] = []
    strings_truncated = False
    received = 0
    for entry in proposal:
        candidate, truncated = _bounded_candidate(entry)
        strings_truncated = strings_truncated or truncated
        if candidate is None:
            continue
        received += 1
        if len(bounded) < FINAL_PROPOSAL_CANDIDATE_LIMIT:
            bounded.append(candidate)

    metadata = {
        'candidates_received': received,
        'candidates_stored': len(bounded),
        'candidate_limit': FINAL_PROPOSAL_CANDIDATE_LIMIT,
        'strings_truncated': strings_truncated,
        'size_limited': False,
    }
    envelope = {'keywords': bounded, 'proposal_truncation': metadata}
    while persisted_size_bytes(envelope) > FINAL_PROPOSAL_MAX_BYTES and bounded:
        bounded.pop()
        metadata['size_limited'] = True
    metadata['candidates_stored'] = len(bounded)
    return bounded, metadata


def merge_expansion_keywords(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge provider lists by canonical keyword and rank the best evidence."""
    merged: dict[str, dict[str, Any]] = {}
    for step in steps:
        provider = step.get('provider', '')
        for raw_entry in step.get('keywords') or []:
            entry, _truncated = _bounded_candidate(raw_entry)
            if entry is None:
                continue
            text = entry['keyword']
            key = normalize_keyword(text)
            if not key:
                continue
            existing = merged.get(key)
            if existing is None:
                entry['providers'] = [provider] if provider else list(entry.get('providers') or [])
                merged[key] = entry
                continue
            providers = list(existing.get('providers') or [])
            if provider and provider not in providers and len(providers) < PROVIDER_COUNT_LIMIT:
                providers.append(provider)
            if _relevance(entry.get('relevance')) > _relevance(existing.get('relevance')):
                merged[key] = {**entry, 'providers': providers}
            else:
                existing['providers'] = providers
    return sorted(
        merged.values(),
        key=lambda entry: (-_relevance(entry.get('relevance')), -len(entry.get('providers', [])), entry['keyword'].casefold()),
    )


def merge_competitor_analyses(steps: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge bounded competitor categories without duplicate keywords."""
    result: dict[str, Any] = {
        'domain': '',
        'industry': 'unknown',
        'page_focus': '',
        **{category: [] for category in COMPETITOR_CATEGORIES},
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
            for raw_entry in analysis.get(category) or []:
                entry, _truncated = _bounded_candidate(raw_entry)
                if entry is None:
                    continue
                key = normalize_keyword(entry['keyword'])
                if not key or key in seen:
                    continue
                seen.add(key)
                result[category].append({**entry, 'provider': step.get('provider', '')})
        if analysis.get('seo_elements') and 'seo_elements' not in result:
            result['seo_elements'] = analysis['seo_elements']
    return result


def summarize_job(job: dict[str, Any], *, through_round: int | None = None) -> dict[str, Any]:
    """Compute merged checkpoint results and counters without mutating the row."""
    done = completed_steps(job, through_round=through_round)
    failed = failed_steps(job, through_round=through_round)
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
    """Terminal status implied by every persisted step, including unfinished ones."""
    steps = [step for step in (job.get('steps') or {}).values() if isinstance(step, dict)]
    done = [step for step in steps if step.get('status') == STEP_COMPLETED]
    if not done:
        return STATUS_FAILED
    if all(step.get('status') == STEP_COMPLETED for step in steps):
        return STATUS_COMPLETED
    return STATUS_PARTIAL


def checkpoint_terminal_result(job: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Partial/failed terminal fields when an execution dies around checkpoints."""
    summary = summarize_job(job)
    status = STATUS_PARTIAL if completed_steps(job) else STATUS_FAILED
    fields: dict[str, Any] = {
        'keyword_count': summary['keyword_count'],
        'steps_done': summary['steps_done'],
        'steps_failed': summary['steps_failed'],
        'provider': summary['provider'],
    }
    if job.get('type') == TYPE_COMPETITOR:
        fields['analysis'] = summary['analysis']
        fields['industry'] = summary['analysis'].get('industry', 'unknown')
        fields['page_focus'] = summary['analysis'].get('page_focus', '')
    else:
        keywords, truncation = bound_final_proposal(summary['keywords'])
        fields['keywords'] = keywords
        fields['keyword_count'] = len(keywords)
        fields['result_truncation'] = truncation
        if job.get('type') == TYPE_AGENT:
            fields['candidates_count'] = summary['keyword_count']
            fields['proposal_source'] = 'checkpointed_partial'
    return status, fields


def public_view(job: dict[str, Any], *, include_raw: bool = False) -> dict[str, Any]:
    """Shape a row for API responses and expose progressive checkpoint results."""
    private = {'steps', 'raw_response', 'ttl', 'execution_arn', 'execution_id', 'active_round'}
    view = {key: value for key, value in job.items() if key not in private}
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
        view.update(summarize_job(job))
    if include_raw and job.get('raw_response'):
        view['raw_response'] = job['raw_response']
    return view


def with_legacy_profile(config: dict[str, Any]) -> dict[str, Any]:
    """An agent config with its profile and resolved tracking count present.

    Runs from before 2.6.0 stored none of the profile fields; they were all
    hotel runs. Runs from before tracking recommendations stored no
    ``tracking_count``; they read as ``min(15, target_count)``. The stored row
    is never touched — only the API view is completed.
    """
    completed = {
        **config,
        'tracking_count': config_tracking_count(config),
    }
    if config.get('dimension_catalog'):
        return completed
    return {
        **completed,
        'subject': config.get('subject') or LEGACY_SUBJECT,
        'audience': config.get('audience') or LEGACY_AUDIENCE,
        'dimension_catalog': [dict(dimension) for dimension in LEGACY_DIMENSION_CATALOG],
    }
