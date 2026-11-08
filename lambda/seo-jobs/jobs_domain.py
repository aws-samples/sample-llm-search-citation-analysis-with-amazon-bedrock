"""Domain snapshot steps of ``CitationAnalysis-SeoDomainSnapshots`` (run by the SEO jobs Lambda).

* ``domain.snapshot_all``: the targets of one execution, ``[{domain, market_id}]``, from the execution
  input (``input``). An Admin's manual snapshot passes its one target in ``input.targets`` (checked again
  here); a Schedule (Operations > Schedule, created by an Admin) passes none, and the step then
  lists every owned and competitor domain (brand config ``first_party_domains`` and
  ``competitor_domains``; a domain covered by another as its subdomain once) in the global market and every
  configured market DataForSEO Labs serves (Google-Ads-only countries have no Labs data and would be a
  billed failure). Free: reads BrandConfig only. At most ``MAX_TARGETS`` targets, so the list stays far
  below the 256 KiB state limit and a misconfigured brand cannot fan out into hundreds of paid calls.
* ``domain.snapshot_one``: one snapshot (``shared.domain_snapshots.take_snapshot``, two billed Labs calls,
  each sent once). Answers ``{domain, market_id, status, keywords}``.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from functools import cache
from typing import Any

import boto3

from shared.dataforseo_domain_scope import InvalidTargetError, parse_research_target
from shared.dataforseo_locations import UnsupportedMarketError, market_codes
from shared.domain_snapshots import BUCKET_ENV, distinct_domains, take_snapshot
from shared.env_vars import resolve_table_env
from shared.insights_citations import competitor_domains_from
from shared.kpi_engine import owned_domains_from
from shared.markets import GLOBAL_MARKET_ID, Market, load_markets, markets_by_id

logger = logging.getLogger(__name__)

MAX_TARGETS = 40


@cache
def brand_config_table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_BRAND_CONFIG'))


@cache
def snapshots_table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_SEO_DOMAIN_SNAPSHOTS'))


@cache
def s3_client() -> Any:
    return boto3.client('s3')


def _labs_market(market: Market | None) -> bool:
    try:
        return market_codes(market).keyword_data == 'labs'
    except UnsupportedMarketError:
        return False


def _markets() -> dict[str, Market | None]:
    """The global market and every configured market Labs serves."""
    configured = {market.market_id: market for market in load_markets(brand_config_table())}
    return {GLOBAL_MARKET_ID: None, **{key: market for key, market in configured.items() if _labs_market(market)}}


def _brand_domains() -> list[str]:
    config = brand_config_table().get_item(Key={'config_id': 'default'}).get('Item') or {}
    competitors = competitor_domains_from(config)
    return distinct_domains([*owned_domains_from(config), *(domain for domains in competitors.values() for domain in domains)])


def _manual_target(entry: object) -> dict[str, str] | None:
    if not isinstance(entry, dict):
        return None
    try:
        domain = parse_research_target(str(entry.get('domain') or '')).hostname
    except InvalidTargetError:
        return None
    market_id = str(entry.get('market_id') or GLOBAL_MARKET_ID)
    return {'domain': domain, 'market_id': market_id}


def snapshot_all(event: dict[str, Any]) -> dict[str, Any]:
    """The execution's targets (``domain.snapshot_all``)."""
    markets = _markets()
    execution_input = event.get('input')
    requested = execution_input.get('targets') if isinstance(execution_input, dict) else None
    if isinstance(requested, list):
        targets = [target for target in map(_manual_target, requested) if target and target['market_id'] in markets]
    else:
        targets = [{'domain': domain, 'market_id': market_id} for domain in _brand_domains() for market_id in markets]
    if len(targets) > MAX_TARGETS:
        logger.warning('domain snapshots: %d targets, the first %d are taken', len(targets), MAX_TARGETS)
    kept = targets[:MAX_TARGETS]
    return {'targets': kept, 'count': len(kept)}


def snapshot_one(event: dict[str, Any]) -> dict[str, Any]:
    """One snapshot (``domain.snapshot_one``)."""
    domain = parse_research_target(str(event.get('domain') or '')).hostname
    market_id = str(event.get('market_id') or GLOBAL_MARKET_ID)
    market = None if market_id == GLOBAL_MARKET_ID else markets_by_id(load_markets(brand_config_table())).get(market_id)
    if market_id != GLOBAL_MARKET_ID and market is None:
        return {'domain': domain, 'market_id': market_id, 'status': 'unknown_market', 'keywords': 0}
    result = take_snapshot(
        domain, market_id, market_codes(market), table=snapshots_table(), s3=s3_client(), bucket=os.environ[BUCKET_ENV],
    )
    return {'domain': domain, 'market_id': market_id, **result}


STEPS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    'domain.snapshot_all': snapshot_all,
    'domain.snapshot_one': snapshot_one,
}

__all__ = ['STEPS']
