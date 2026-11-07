"""The AWS resources rank tracking reaches from the SEO router and the SEO jobs function.

- ``start_execution``: starts ``CitationAnalysis-SeoRankCheck`` (ARN in ``RANK_TRACKING_STATE_MACHINE_ARN``)
  with the run id as the execution name, so one run can never start two executions.
- ``market_codes_for``: the DataForSEO codes of a tracker's market (``global`` = US / English).
- ``keywords_table``: ``CitationAnalysis-Keywords``, for a tracker's keyword group.

Each client is created once per container; tests replace these functions.
"""

from __future__ import annotations

import functools
import json
import os
from typing import Any

import boto3

from shared.dataforseo_locations import MarketCodes, market_codes
from shared.env_vars import resolve_table_env
from shared.markets import GLOBAL_MARKET_ID, load_markets, markets_by_id

__all__ = ['STATE_MACHINE_ENV', 'UnknownMarketError', 'keywords_table', 'market_codes_for', 'start_execution']

STATE_MACHINE_ENV = 'RANK_TRACKING_STATE_MACHINE_ARN'


class UnknownMarketError(ValueError):
    """The tracker names a market that is no longer configured."""


@functools.cache
def _stepfunctions() -> Any:
    return boto3.client('stepfunctions')


@functools.cache
def keywords_table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_KEYWORDS'))


@functools.cache
def _brand_config_table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_BRAND_CONFIG'))


def start_execution(run_id: str, payload: dict[str, Any]) -> None:
    _stepfunctions().start_execution(stateMachineArn=os.environ[STATE_MACHINE_ENV], name=run_id,
                                     input=json.dumps(payload))


def market_codes_for(market_id: str) -> MarketCodes:
    """Raises ``UnknownMarketError`` or ``UnsupportedMarketError`` when the market cannot be checked."""
    if market_id == GLOBAL_MARKET_ID:
        return market_codes(None)
    market = markets_by_id(load_markets(_brand_config_table())).get(market_id)
    if market is None:
        raise UnknownMarketError(market_id)
    return market_codes(market)
