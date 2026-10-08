"""
The two-step spend operations: ``estimate_*`` prices a spend and issues a confirmation token; ``start_*`` spends.

An estimate reads the existing API (keywords in the scope, enabled engines
and search providers, enabled personas) through the same invoker as every
read tool, counts the calls the spend will make, and binds a single-use
token to the caller, the family and the exact API request (``state``). The
start presents the token, which is consumed atomically before anything else,
then passes the per-caller limits and replays the request. No dollar
figures: the estimate is a call count. Read-only counting, so an estimate
never spends; the API handlers still apply their own checks to the start.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

import state
from auth import Caller, authorize_tool
from botocore.exceptions import BotoCoreError, ClientError
from catalogue import CONFIRMATION_ARGUMENT, JsonObject, Route, Tool
from invoke import (
    answer_result,
    audit,
    checked_route,
    invoke_route,
    refusal_result,
    replay,
    tool_result,
    unreachable_result,
)

from shared.analysis_runs import MAX_QUERY_PROMPTS_PER_RUN
from shared.markets import keyword_market_id
from shared.research_agent import AGENT_DEFAULT_ROUNDS, AGENT_MAX_QUERIES_PER_ROUND

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: ``shared.ai_clients.WEB_SEARCH_PROVIDERS``: the providers keyword research fans out to (checked by a test).
RESEARCH_PROVIDERS = ('perplexity', 'openai', 'gemini')
SIGNALS_PROVIDER = 'serpapi'
#: Keyword pages (1,000 rows scanned each) an estimate reads before it gives up counting.
MAX_KEYWORD_PAGES = 20
#: The UTC-day counter each family draws from.
COUNTERS = {'run': 'runs', 'research': 'jobs', 'content': 'jobs'}
_RUNNING = 'RUNNING'


class UpstreamError(Exception):
    """An API read an estimate needs answered with an error; carries the answer for the tool error."""

    def __init__(self, status: int, body: Any) -> None:
        super().__init__(f'API answered {status}')
        self.status = status
        self.body = body


@dataclass
class Estimate:
    """What a spend would do (``counts``), why it cannot start now (``blocker``), and the line the model reads."""

    counts: JsonObject
    summary: str
    blocker: str | None = None
    notes: list[str] = field(default_factory=list)


# --- Reads ----------------------------------------------------------------------

def _ask(caller: Caller, route: Route) -> tuple[int, Any]:
    """``invoke_route``, with an unreachable API read as a ``502``."""
    try:
        return invoke_route(route, caller)
    except (BotoCoreError, ClientError, ValueError):
        logger.exception('Reading %s for a spend estimate failed', route.path)
        return 502, {'error': 'The API could not be reached'}


def _read(caller: Caller, router: str, path: str, query: dict[str, str] | None = None) -> Any:
    status, body = _ask(caller, Route(router, 'GET', path, path, None, query, None))
    if not 200 <= status < 300:
        raise UpstreamError(status, body)
    return body


def _keyword_pages(caller: Caller, group_id: str | None) -> tuple[list[dict[str, Any]], bool]:
    """Active keywords (optionally of one group) and whether every page was read."""
    query: dict[str, str] = {'status': 'active', 'limit': '1000'}
    if group_id:
        query['group_id'] = group_id
    keywords: list[dict[str, Any]] = []
    for _page in range(MAX_KEYWORD_PAGES):
        body = _read(caller, 'keyword-mgmt', '/api/keywords', query)
        keywords.extend(item for item in body.get('keywords', []) if isinstance(item, dict))
        token = body.get('next_token')
        if not token:
            return keywords, True
        query['next_token'] = token
    return keywords, False


def count_scope_keywords(caller: Caller, scope: JsonObject) -> tuple[int, bool]:
    """``(active keywords in scope, complete)``; ``scope`` is the run's ``{"mode": ...}`` descriptor."""
    group_ids = scope.get('group_ids') or [None]
    keywords, complete = _keyword_pages(caller, group_ids[0])
    if scope.get('mode') == 'keywords':
        wanted = set(scope.get('keyword_ids') or [])
        keywords = [item for item in keywords if item.get('id') in wanted]
    market_ids = scope.get('market_ids')
    if isinstance(market_ids, list):
        markets = set(market_ids)
        keywords = [item for item in keywords if keyword_market_id(item) in markets]
    return len(keywords), complete


def _providers(caller: Caller) -> list[dict[str, Any]]:
    body = _read(caller, 'config-mgmt', '/api/providers')
    return [item for item in body.get('providers', []) if isinstance(item, dict)]


def _active(providers: list[dict[str, Any]], provider_type: str) -> list[str]:
    """Ids of the providers of ``provider_type`` a run calls: enabled and with a key."""
    return [
        str(item.get('id')) for item in providers
        if item.get('type') == provider_type and item.get('enabled') is not False and item.get('configured')
    ]


def _enabled_personas(caller: Caller) -> int:
    body = _read(caller, 'config-mgmt', '/api/query-prompts')
    items = body if isinstance(body, list) else body.get('items', []) if isinstance(body, dict) else []
    enabled = sum(1 for item in items if isinstance(item, dict) and str(item.get('enabled')).lower() == 'true')
    return min(enabled, MAX_QUERY_PROMPTS_PER_RUN)


# --- Estimates --------------------------------------------------------------------

def _run_blocker(keywords: int, complete: bool, calls: int) -> str | None:
    cap = state.limits().max_run_keywords
    if not complete:
        return f'The scope has too many keywords to count; the MCP keyword cap is {cap}'
    if keywords == 0:
        return 'No active keywords match the scope'
    if keywords > cap:
        return f'{keywords} keywords exceed the MCP keyword cap of {cap} per run; narrow the scope'
    if calls == 0:
        return 'No AI engine or search provider is enabled with a key'
    return None


def estimate_run(caller: Caller, route: Route, _arguments: JsonObject) -> Estimate:
    keywords, complete = count_scope_keywords(caller, (route.body or {})['scope'])
    providers = _providers(caller)
    engines, search = _active(providers, 'llm'), _active(providers, 'search')
    personas = _enabled_personas(caller)
    calls = keywords * max(1, personas) * (len(engines) + len(search))
    counts = {
        'keywords': keywords, 'engines': engines, 'search_providers': search, 'personas': personas,
        'provider_calls': calls, 'serpapi_enabled': SIGNALS_PROVIDER in search,
    }
    summary = (f'{keywords} keyword(s) x {max(1, personas)} persona(s) x {len(engines) + len(search)} provider(s) '
               f'= {calls} provider call(s)')
    notes = ['Crawling cited pages and summarising them with Bedrock adds calls that depend on the answers.']
    return Estimate(counts, summary, _run_blocker(keywords, complete, calls), notes)


def _research_counts(kind: str, arguments: JsonObject, providers: int, signals: bool) -> JsonObject:
    """Upper bounds of the calls one research job makes (see ``lambda/research-worker``)."""
    if kind != 'agent':
        return {'provider_calls': providers, 'page_fetches': 1 if kind == 'competitor' else 0, 'bedrock_calls': 0}
    rounds = int(arguments.get('max_rounds') or AGENT_DEFAULT_ROUNDS)
    return {
        'provider_calls': rounds * AGENT_MAX_QUERIES_PER_ROUND + (rounds if signals else 0),
        'page_fetches': 0,
        # plan round one, evaluate every round, select the proposal
        'bedrock_calls': rounds + 2,
    }


def estimate_research(caller: Caller, _route: Route, arguments: JsonObject) -> Estimate:
    configured = {str(item.get('id')) for item in _providers(caller) if item.get('configured')}
    search = [provider for provider in RESEARCH_PROVIDERS if provider in configured]
    counts = {'kind': arguments['kind'], 'web_search_providers': search,
              **_research_counts(arguments['kind'], arguments, len(search), SIGNALS_PROVIDER in configured)}
    summary = (f'at most {counts["provider_calls"]} provider call(s), {counts["bedrock_calls"]} Bedrock call(s), '
               f'{counts["page_fetches"]} page fetch(es)')
    blocker = None if search else 'No web-search provider (Perplexity, OpenAI, Gemini) has an API key'
    return Estimate(counts, summary, blocker)


def estimate_content(_caller: Caller, route: Route, _arguments: JsonObject) -> Estimate:
    idea = (route.body or {})['idea']
    fetches = 1 if idea['content_angle'] == 'improve_current_url' else 0
    counts = {'bedrock_calls': 1, 'max_attempts': 3, 'page_fetches': fetches, 'scope': idea['scope']}
    return Estimate(counts, f'1 Bedrock generation (retried at most twice on failure), {fetches} page fetch(es)')


Estimator = Callable[[Caller, Route, JsonObject], Estimate]
ESTIMATORS: dict[str, Estimator] = {'run': estimate_run, 'research': estimate_research, 'content': estimate_content}


#: The tool that confirms each family's estimate.
STARTS = {'run': 'start_run', 'research': 'start_research', 'content': 'generate_content_brief'}
_DAILY_WHAT = {'run': 'analysis runs', 'research': 'research or content jobs', 'content': 'research or content jobs'}


@dataclass(frozen=True)
class _Call:
    """One spend call being served: who, through which tool, which operation, since when."""

    tool_name: str
    operation: Tool
    caller: Caller
    started: float

    @property
    def family(self) -> str:
        return self.operation.spend.family if self.operation.spend is not None else ''

    def audit(self, outcome: str, reason: str | None = None) -> None:
        audit(self.caller, self.tool_name, self.operation, outcome, self.started, reason)

    def refuse(self, outcome: str, reason: str) -> JsonObject:
        self.audit(outcome, reason)
        return refusal_result(reason)

    def upstream(self, error: UpstreamError, arguments: JsonObject) -> JsonObject:
        self.audit(f'http_{error.status}')
        return answer_result(self.operation, error.status, error.body, arguments)


def _per_day(family: str) -> int:
    limits = state.limits()
    return limits.runs_per_day if family == 'run' else limits.jobs_per_day


def _limit_message(family: str) -> str:
    return f'Limit reached: {_per_day(family)} {_DAILY_WHAT[family]} per caller per UTC day (resets {state.next_reset()})'


def _limit_status(caller: Caller, family: str) -> JsonObject:
    status: JsonObject = {
        'used_today': state.used_today(caller.sub, COUNTERS[family]),
        'per_day': _per_day(family),
        'resets_at': state.next_reset(),
    }
    if family == 'run':
        status['runs_in_flight_allowed'] = state.limits().runs_in_flight
    return status


# --- Estimate ---------------------------------------------------------------------

def _estimate_result(call: _Call, estimate: Estimate, limits: JsonObject, token: tuple[str, str] | None) -> JsonObject:
    data: JsonObject = {**estimate.counts, 'limits': limits, 'notes': estimate.notes}
    name = call.operation.name
    if token is None:
        data.update({'can_start': False, 'reason': estimate.blocker})
        return tool_result(f'{name}: {estimate.summary}. Cannot start: {estimate.blocker}', data)
    data.update({'can_start': True, CONFIRMATION_ARGUMENT: token[0], 'expires_at': token[1]})
    text = (f'{name}: {estimate.summary}. Show this to the user; only after they approve, call {STARTS[call.family]} '
            f'with the same arguments and this confirmation_token (single use, expires {token[1]}).')
    return tool_result(text, data)


def _estimate(call: _Call, route: Route, arguments: JsonObject) -> JsonObject:
    try:
        estimate = ESTIMATORS[call.family](call.caller, route, arguments)
    except UpstreamError as error:
        return call.upstream(error, arguments)
    limits = _limit_status(call.caller, call.family)
    if estimate.blocker is None and limits['used_today'] >= limits['per_day']:
        estimate.blocker = _limit_message(call.family)
    if estimate.blocker is not None:
        call.audit('estimate_blocked', estimate.blocker)
        return _estimate_result(call, estimate, limits, None)
    token = state.issue_token(call.caller.sub, call.family, state.request_digest(route._asdict()))
    call.audit('estimated')
    return _estimate_result(call, estimate, limits, token)


# --- Start ------------------------------------------------------------------------

def _is_running(caller: Caller, run: JsonObject) -> bool:
    """Whether a started run still runs; one the API cannot describe counts as running, unless it is gone (404)."""
    arn = str(run.get('execution_arn') or '')
    route = Route('execution-mgmt', 'GET', f'/api/executions/{arn}', '/api/executions/{id}', {'id': arn}, None, None)
    status, body = _ask(caller, route)
    if status == 404:
        return False
    if not 200 <= status < 300 or not isinstance(body, dict):
        return True
    return (body.get('execution') or {}).get('status') == _RUNNING


def _runs_in_flight(caller: Caller, limit: int) -> list[str]:
    """The execution ARNs of the caller's started runs that still run, up to ``limit`` of them."""
    running: list[str] = []
    for run in state.unfinished_runs(caller.sub):
        if not _is_running(caller, run):
            state.mark_finished(run)
            continue
        running.append(str(run.get('execution_arn') or ''))
        if len(running) >= limit:
            break
    return running


def _run_refusal(caller: Caller, scope: JsonObject) -> str | None:
    """Why ``start_run`` may not start now: the keyword cap (counted again) or the runs in flight."""
    limits = state.limits()
    keywords, complete = count_scope_keywords(caller, scope)
    if not complete or keywords > limits.max_run_keywords:
        return f'The scope has more than {limits.max_run_keywords} keywords, the MCP keyword cap per run'
    allowed = limits.runs_in_flight
    running = _runs_in_flight(caller, allowed) if allowed >= 1 else []
    if allowed < 1 or len(running) >= allowed:
        # Name the runs, so the assistant can follow them with get_run_status.
        names = ', '.join(arn for arn in running if arn)
        follow = f' (get_run_status with execution_arn {names})' if names else ' (get_run_status)'
        return f'Limit reached: {allowed} analysis run(s) in flight per caller; wait until it finishes{follow}'
    return None


def _spend(call: _Call, route: Route, arguments: JsonObject) -> JsonObject:
    """Reserve today's use, replay the request, and give the use back when nothing started."""
    counter = COUNTERS[call.family]
    day = state.reserve(call.caller.sub, counter, _per_day(call.family))
    if day is None:
        return call.refuse('limit_reached', _limit_message(call.family))
    answer = replay(call.tool_name, call.operation, route, call.caller, call.started)
    if answer is None:
        state.release(call.caller.sub, counter, day)
        return unreachable_result(call.operation)
    status, body = answer
    if not 200 <= status < 300:
        state.release(call.caller.sub, counter, day)
    elif call.family == 'run' and isinstance(body, dict) and body.get('execution_arn'):
        state.record_run(call.caller.sub, str(body['execution_arn']))
    call.audit(f'http_{status}')
    return answer_result(call.operation, status, body, arguments)


def _start_run(call: _Call, route: Route, arguments: JsonObject) -> JsonObject:
    if not state.acquire_run_lock(call.caller.sub):
        return call.refuse('limit_reached', 'Another start_run of yours is in progress; try again in a minute')
    try:
        refusal = _run_refusal(call.caller, (route.body or {})['scope'])
        if refusal is not None:
            return call.refuse('limit_reached', refusal)
        return _spend(call, route, arguments)
    finally:
        state.release_run_lock(call.caller.sub)


def _start(call: _Call, route: Route, arguments: JsonObject, token: str) -> JsonObject:
    try:
        state.consume_token(token, call.caller.sub, call.family, state.request_digest(route._asdict()))
    except state.TokenRefused as refused:
        return call.refuse('token_refused', str(refused))
    try:
        if call.family == 'run':
            return _start_run(call, route, arguments)
        return _spend(call, route, arguments)
    except UpstreamError as error:
        return call.upstream(error, arguments)


def run_spend(tool_name: str, operation: Tool, arguments: Any, caller: Caller) -> JsonObject:
    """Serve one call of a spend operation; ``InvalidArguments`` propagates as for every tool."""
    call = _Call(tool_name, operation, caller, perf_counter())
    refusal = authorize_tool(caller, operation.scope, operation.admin)
    if refusal is not None:
        return call.refuse('denied', refusal)
    valid, route = checked_route(tool_name, operation, arguments, caller, call.started)
    request = {name: value for name, value in valid.items() if name != CONFIRMATION_ARGUMENT}
    if operation.spend is not None and operation.spend.step == 'estimate':
        return _estimate(call, route, request)
    return _start(call, route, request, str(valid[CONFIRMATION_ARGUMENT]))
