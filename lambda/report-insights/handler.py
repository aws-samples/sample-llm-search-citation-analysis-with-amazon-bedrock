"""GenerateInsights: the written narrative of each keyword group a run fully covers.

Runs after KpiAlerts in ``CitationAnalysis-Workflow``. KpiAlerts snapshots
exactly the groups the run fully covers and names them
(``alerts.snapshot_group_ids``, ``alerts.run_timestamp``); for each of them,
``GROUP_WORKERS`` at a time, this worker computes the group's insights
(``shared.insights_engine``) and KPIs (``shared.kpi_engine.brand_kpis``) as
``GET /api/reports/insights`` does, asks Bedrock (``ModelRole.ANALYSIS``) for
a narrative written from them alone, keeps the items
``shared.insights_narrative.validate_narrative`` accepts and stores them in
``CitationAnalysis-ReportInsights``.

``POST /api/reports/insights/regenerate`` invokes it asynchronously with
``{"group_id": ...}`` (and an optional ``"market_id"``): the narrative is then
written again for the group's latest runs.

Narratives are per (group, market) (2.37.0), like KpiAlerts' snapshots: the
pairs come from ``alerts.snapshot_scopes`` (older executions name only
``snapshot_group_ids``, the global market). A pair covers the group's
keywords of that market, uses the market's competitors and first-party
aliases (``shared.markets.brand_config_for_market``) and is written in the
market's language; the global market keeps the ``group#<id>`` scope key and
any other market's key is ``group#<id>#<market_id>``.

A group that fails (a Bedrock error, an unreadable answer, output that is
not JSON) is logged and counted; it never fails the run. The state machine
catches anything else, so the report survives this step either way.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable, Iterable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from shared.answer_queries import history_since, query_keyword_rows_since, query_keyword_run_rows, query_latest_run_rows
from shared.dynamo_decimal import convert_floats_to_decimal
from shared.group_kpi_history import build_group_kpi_history
from shared.insights_citations import competitor_domains_from
from shared.insights_engine import compute_insights
from shared.insights_narrative import (
    LANGUAGE_NAMES,
    MAX_NARRATIVE_INSIGHTS,
    MAX_NARRATIVE_RECOMMENDATIONS,
    group_scope_key,
    keyword_language,
    narrative_item,
    validate_narrative,
)
from shared.keyword_groups import keyword_group_ids, query_active_keywords
from shared.kpi_engine import Answer, answers_from_rows, brand_kpis, owned_domains_from
from shared.llm_json import parse_llm_json
from shared.markets import (
    GLOBAL_MARKET_ID,
    Market,
    brand_config_for_market,
    keyword_market_id,
    load_markets,
    market_scoped_key,
    markets_by_id,
)
from shared.models import ModelRole, get_model_id, invoke_bedrock
from shared.prompt_safety import untrusted_input_system_instruction, wrap_user_input
from shared.scope_params import SCOPE_KEYWORDS_CAP, map_scope_keywords, scoped_dynamodb_resource
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config, get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: Groups written at the same time; each one reads its keywords ``SCOPE_MAX_WORKERS`` at a time.
GROUP_WORKERS = 4
#: The window of the stability facts: the 90 days ``GET /api/reports/insights`` defaults to.
HISTORY_DAYS = 90
NARRATIVE_MAX_TOKENS = 3000
#: Room for the KPI and insight JSON inside its prompt tag (``prompt_safety`` caps a field at 4000 by default).
FACTS_MAX_LENGTH = 60000

SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = os.environ['DYNAMODB_TABLE_KEYWORDS']
BRAND_CONFIG_TABLE = os.environ['DYNAMODB_TABLE_BRAND_CONFIG']
REPORT_INSIGHTS_TABLE = os.environ['DYNAMODB_TABLE_REPORT_INSIGHTS']

dynamodb = scoped_dynamodb_resource()


class UnreadableAnswersError(RuntimeError):
    """A keyword's answers could not be read, so the group's facts would be partial."""


class UnparseableNarrativeError(ValueError):
    """The model's output held no JSON object."""


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------

def _scopes_from_alerts(alerts: Mapping[str, Any]) -> list[tuple[str, str]] | None:
    """KpiAlerts' snapshotted (group, market) pairs; executions before markets name only groups (global)."""
    scopes = alerts.get('snapshot_scopes')
    if isinstance(scopes, list):
        return [
            (str(entry['group_id']), str(entry.get('market_id') or GLOBAL_MARKET_ID))
            for entry in scopes
            if isinstance(entry, Mapping) and entry.get('group_id')
        ]
    group_ids = alerts.get('snapshot_group_ids')
    if not isinstance(group_ids, list):
        return None
    return [(str(value), GLOBAL_MARKET_ID) for value in group_ids if value]


def _requests(event: Any) -> tuple[list[tuple[str, str]], str | None]:
    """The (group, market) pairs to write for and the run to read (``None``: each keyword's latest run)."""
    if not isinstance(event, Mapping):
        return [], None
    group_id = event.get('group_id')
    if isinstance(group_id, str) and group_id:
        market_id = event.get('market_id')
        return [(group_id, market_id if isinstance(market_id, str) and market_id else GLOBAL_MARKET_ID)], None
    alerts = event.get('alerts')
    if not isinstance(alerts, Mapping) or alerts.get('status') != 'completed':
        return [], None
    run_timestamp = alerts.get('run_timestamp')
    scopes = _scopes_from_alerts(alerts)
    if not isinstance(run_timestamp, str) or not run_timestamp or scopes is None:
        return [], None
    return scopes, run_timestamp


def _group_keywords(requests: Iterable[tuple[str, str]]) -> dict[tuple[str, str], list[str]]:
    """The active keywords of each (group, market) pair, in name order and capped as a report scope is."""
    wanted = set(requests)
    members: dict[tuple[str, str], list[str]] = {pair: [] for pair in wanted}
    for item in query_active_keywords(dynamodb.Table(KEYWORDS_TABLE)):
        keyword = item.get('keyword')
        if isinstance(keyword, str) and keyword:
            market_id = keyword_market_id(item)
            for group_id in keyword_group_ids(item):
                if (group_id, market_id) in wanted:
                    members[(group_id, market_id)].append(keyword)
    return {
        pair: sorted(set(keywords), key=str.casefold)[:SCOPE_KEYWORDS_CAP]
        for pair, keywords in members.items()
    }


def _markets_for(requests: Iterable[tuple[str, str]]) -> dict[str, Market]:
    """The configured markets the requests name (read only when one is not global)."""
    if all(market_id == GLOBAL_MARKET_ID for _group_id, market_id in requests):
        return {}
    return markets_by_id(load_markets(dynamodb.Table(BRAND_CONFIG_TABLE)))


# ---------------------------------------------------------------------------
# Facts
# ---------------------------------------------------------------------------

def _read_all(keywords: list[str], read: Callable[[Any, str], list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    """``read(table, keyword)`` for every keyword; raises when one of them cannot be read."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    rows = map_scope_keywords(keywords, lambda keyword: read(table, keyword), lambda _keyword: None)
    if any(entry is None for entry in rows):
        raise UnreadableAnswersError('A keyword of the group could not be read')
    return {keyword: entry or [] for keyword, entry in zip(keywords, rows, strict=True)}


def _run_answers(keywords: list[str], run_timestamp: str | None) -> list[Answer]:
    """The answers of the run stamped ``run_timestamp``, or of each keyword's latest run."""
    if run_timestamp is None:
        rows = _read_all(keywords, query_latest_run_rows)
    else:
        rows = _read_all(keywords, lambda table, keyword: query_keyword_run_rows(table, keyword, run_timestamp))
    return answers_from_rows(row for keyword in keywords for row in rows[keyword])


def _rows_since(since: str) -> Callable[[Any, str], list[dict[str, Any]]]:
    return lambda table, keyword: query_keyword_rows_since(table, keyword, since)


def _history(keywords: list[str], owned_domains: list[str]) -> list[dict[str, Any]]:
    """The keywords' stability history over ``HISTORY_DAYS``, as the insights endpoint builds it by default."""
    history = build_group_kpi_history(keywords, _read_all(keywords, _rows_since(history_since(HISTORY_DAYS))), owned_domains)
    return history['keywords']


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

def _tracked_brands(brand_config: Mapping[str, Any]) -> list[str]:
    tracked = brand_config.get('tracked_brands')
    first_party = tracked.get('first_party') if isinstance(tracked, Mapping) else None
    return [str(name) for name in first_party] if isinstance(first_party, list) else []


def narrative_prompt(
    brand_config: Mapping[str, Any],
    language: str,
    kpis: Mapping[str, Any],
    insights: list[dict[str, Any]],
) -> str:
    """The one prompt of a group: its KPIs and computed insights as JSON, and the rules the output is held to."""
    brands = ', '.join(_tracked_brands(brand_config)) or 'the tracked brand'
    industry = str(brand_config.get('industry') or 'general')
    facts = json.dumps({'kpis': kpis, 'insights': insights}, ensure_ascii=False, sort_keys=True, default=str)
    return f"""{untrusted_input_system_instruction()}

You write the narrative of a report on how AI answer engines (OpenAI, Perplexity, Gemini, Claude) mention and cite a brand.
Brand: {wrap_user_input(brands, 'brand')}
Industry: {wrap_user_input(industry, 'industry')}

The facts below are the only facts you may use. "kpis" are the brand's KPIs over the keyword group's latest run
(percentages run from 0 to 100; average_position is a rank, lower is better). "insights" are findings computed
from the answers, each with an "id" and the "evidence" numbers it rests on.
Facts: {wrap_user_input(facts, 'facts', max_length=FACTS_MAX_LENGTH)}

Write in {LANGUAGE_NAMES.get(language, LANGUAGE_NAMES['en'])}.
Return only a JSON object, no prose:
{{"insights": [{{"text": "...", "insight_ids": ["..."]}}],
 "recommendations": [{{"title": "...", "text": "...", "insight_ids": ["..."]}}]}}

Rules:
- At most {MAX_NARRATIVE_INSIGHTS} insights and {MAX_NARRATIVE_RECOMMENDATIONS} recommendations, the most important first.
- Every item lists in "insight_ids" the ids of the insights it rests on, copied exactly.
- Write every number in digits, exactly as it appears in the KPIs or in the evidence of the insights the item cites;
  you may round it to fewer decimals. Never compute a new number (no differences, sums or ratios) and never write
  numbers as words.
- Say what each number measures and against what, in plain words (never the evidence's field names): a position or
  sentiment gap is measured against the best of the brand's own sub-brands, not against the KPIs; a competitor's
  caveat share is the percent of its mentions worded mixed or negative; an engine's top-1 share and citation rate
  are that engine's own.
- An insight says what the facts show and why it matters. A recommendation is one concrete action, with a short title.
"""


# ---------------------------------------------------------------------------
# One group
# ---------------------------------------------------------------------------

def _narrative(prompt: str) -> Any:
    parsed = parse_llm_json(invoke_bedrock(prompt, ModelRole.ANALYSIS, max_tokens=NARRATIVE_MAX_TOKENS))
    if parsed is None:
        raise UnparseableNarrativeError('The model returned no JSON object')
    return parsed


@dataclass(frozen=True)
class GroupRun:
    """One group to write for: its active keywords and the run to read (``None``: each keyword's latest run).

    ``market`` is the market the keywords belong to (``None``: the global market).
    """

    group_id: str
    keywords: list[str]
    run_timestamp: str | None
    market: Market | None = None

    @property
    def market_id(self) -> str:
        return self.market.market_id if self.market is not None else GLOBAL_MARKET_ID

    def outcome(self, **fields: Any) -> dict[str, Any]:
        """The step's report for this group (``market_id`` named only outside the global market)."""
        market = {} if self.market is None else {'market_id': self.market.market_id}
        return {'group_id': self.group_id, **market, **fields}


def _language(run: GroupRun) -> str:
    """The market's language when the narrative can be written in it, else the keywords' language."""
    if run.market is not None and run.market.lang in LANGUAGE_NAMES:
        return run.market.lang
    return keyword_language(run.keywords)


def generate_group_narrative(run: GroupRun, brand_config: Mapping[str, Any]) -> dict[str, Any]:
    """Write, validate and store the narrative of one group; the outcome as the step reports it."""
    keywords, run_timestamp = run.keywords, run.run_timestamp
    brand_config = brand_config_for_market(brand_config, run.market)
    owned_domains = owned_domains_from(brand_config)
    answers = _run_answers(keywords, run_timestamp)
    if not answers:
        return run.outcome(status='skipped', reason='no_answers')
    computed = compute_insights(
        answers, owned_domains, _history(keywords, owned_domains), competitor_domains_from(brand_config),
    )
    if not computed['insights']:
        return run.outcome(status='skipped', reason='no_insights')
    kpis = brand_kpis(answers, owned_domains)
    language = _language(run)
    narrative, dropped = validate_narrative(
        _narrative(narrative_prompt(brand_config, language, kpis, computed['insights'])),
        computed['insights'],
        kpis,
    )
    timestamp = run_timestamp or max(answer.timestamp for answer in answers)
    dynamodb.Table(REPORT_INSIGHTS_TABLE).put_item(Item=convert_floats_to_decimal(narrative_item(
        scope_key=market_scoped_key(group_scope_key(run.group_id), run.market_id),
        run_timestamp=timestamp,
        narrative=narrative,
        model=get_model_id(ModelRole.ANALYSIS),
        language=language,
        dropped=dropped,
        generated_at=get_timestamp(),
    )))
    logger.info('Narrative stored for a group run: %d item(s) kept, %d dropped', sum(map(len, narrative.values())), dropped)
    return run.outcome(status='generated', dropped=dropped)


def _guarded(run: GroupRun, brand_config: Mapping[str, Any]) -> dict[str, Any]:
    if not run.keywords:
        return run.outcome(status='skipped', reason='no_active_keywords')
    try:
        return generate_group_narrative(run, brand_config)
    except Exception:
        logger.exception('Narrative generation failed for one group')
        return run.outcome(status='failed')


def _group_runs(requests: list[tuple[str, str]], run_timestamp: str | None) -> list[GroupRun]:
    """One ``GroupRun`` per requested (group, market) pair, in request order.

    A market that is no longer configured has no keywords left to write for.
    """
    members = _group_keywords(requests)
    markets = _markets_for(requests)
    runs: list[GroupRun] = []
    for group_id, market_id in requests:
        market = markets.get(market_id)
        known = market_id == GLOBAL_MARKET_ID or market is not None
        runs.append(GroupRun(group_id, members[(group_id, market_id)] if known else [], run_timestamp, market))
    return runs


def _summary(outcomes: list[dict[str, Any]], run_timestamp: str | None) -> dict[str, Any]:
    def count(status: str) -> int:
        return sum(outcome['status'] == status for outcome in outcomes)

    return {
        'status': 'completed',
        'run_timestamp': run_timestamp,
        'groups': len(outcomes),
        'generated': count('generated'),
        'skipped': count('skipped'),
        'failed': count('failed'),
        'dropped': sum(outcome.get('dropped', 0) for outcome in outcomes),
    }


def handler(event: Any, context: Any) -> dict[str, Any]:
    """Write the narrative of every requested group; one group's failure never fails the others or the run."""
    requests, run_timestamp = _requests(event)
    if not requests:
        return {'status': 'skipped', 'reason': 'no_complete_groups', 'groups': 0}
    runs = _group_runs(requests, run_timestamp)
    brand_config = get_brand_config(BRAND_CONFIG_TABLE)
    with ThreadPoolExecutor(max_workers=min(GROUP_WORKERS, len(runs))) as pool:
        outcomes = list(pool.map(lambda run: _guarded(run, brand_config), runs))
    return _summary(outcomes, run_timestamp)
