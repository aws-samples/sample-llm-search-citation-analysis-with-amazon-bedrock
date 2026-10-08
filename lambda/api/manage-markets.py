"""
Markets API: the countries and languages keywords are asked from (2.37.0).

Routes (behind the ConfigMgmt router, ``/api/markets``):

- ``GET  /api/markets`` (any signed-in user):
  ``{"markets": [Market.to_json(), ...], "updated_at": "<iso>" | null}``.
- ``PUT  /api/markets`` (Admin): body ``{"markets": [...]}`` replaces the whole
  list (``shared.markets.validate_markets``). 400 ``{error, field: "markets"}``
  on a validation error; 409 ``{error, market_ids: [...]}`` when the new list
  drops a market that keywords still use. Answers like ``GET``.
- ``POST /api/markets`` (Admin): body ``{"keyword": "...", "market_ids": [...]}``
  (1-10 configured ids) → ``{"suggestions": [{"market_id", "keyword"}, ...]}``:
  Bedrock proposes the keyword as a local user in each market would type it
  (local wording, not a literal translation; ``shared.market_keywords``), in
  the requested market order. A market the model gave no usable keyword for
  is left out. 502 when the model fails or answers no JSON.

The list is one BrandConfig item (``config_id = 'markets'``).
"""

from __future__ import annotations

import functools
import logging
import sys
from collections.abc import Callable
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr

sys.path.insert(0, '/opt/python')

from shared import auth
from shared.api_response import api_response, validation_error
from shared.decorators import RouteNotHandledError, api_handler, cors_preflight, parse_json_body, route_handler
from shared.dynamodb_batch import collect_all_items
from shared.env_vars import resolve_table_env
from shared.keyword_store import validate_keyword_text
from shared.market_keywords import MAX_SUGGESTION_MARKETS, suggest_local_keywords
from shared.markets import (
    MARKETS_CONFIG_ID,
    Market,
    load_markets,
    markets_by_id,
    markets_from_item,
    markets_item,
    validate_markets,
)
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)

_BODY_NOT_AN_OBJECT = 'Request body must be a JSON object'

dynamodb = boto3.resource('dynamodb')
BRAND_CONFIG_TABLE = resolve_table_env('DYNAMODB_TABLE_BRAND_CONFIG')
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS')
brand_config_table = dynamodb.Table(BRAND_CONFIG_TABLE)
keywords_table = dynamodb.Table(KEYWORDS_TABLE)


def _admin_json_route(route: Callable[[dict[str, Any], Any, dict[str, Any]], dict[str, Any]]) -> Callable[..., dict[str, Any]]:
    """An Admin-only route taking a JSON object body (``route(event, context, body)``).

    The group is checked before the body is parsed, and a body that is not an
    object is answered with a 400 before ``route`` runs.
    """
    @functools.wraps(route)
    def with_object_body(event: dict[str, Any], context: Any, body: Any) -> dict[str, Any]:
        if isinstance(body, dict):
            return route(event, context, body)
        return validation_error(_BODY_NOT_AN_OBJECT, event, 'body')

    return auth.require_group(auth.ADMIN_GROUP)(parse_json_body(with_object_body))


def _markets_response(markets: list[Market], updated_at: Any, event: dict[str, Any]) -> dict[str, Any]:
    return api_response(200, {
        'markets': [market.to_json() for market in markets],
        'updated_at': updated_at if isinstance(updated_at, str) and updated_at else None,
    }, event)


def _get_markets(event: dict[str, Any], context: Any) -> dict[str, Any]:
    item = brand_config_table.get_item(Key={'config_id': MARKETS_CONFIG_ID}).get('Item') or {}
    return _markets_response(markets_from_item(item), item.get('updated_at'), event)


# ---------------------------------------------------------------------------
# PUT: replace the list
# ---------------------------------------------------------------------------

def _market_ids_in_use() -> set[str]:
    """Every ``market_id`` a Keywords row carries (any status: a paused keyword keeps its market)."""
    rows = collect_all_items(
        keywords_table.scan,
        FilterExpression=Attr('market_id').exists(),
        ProjectionExpression='#id, market_id',
        ExpressionAttributeNames={'#id': 'id'},
    )
    return {row['market_id'] for row in rows if isinstance(row.get('market_id'), str) and row['market_id']}


@_admin_json_route
def _put_markets(event: dict[str, Any], context: Any, body: dict[str, Any]) -> dict[str, Any]:
    markets, error = validate_markets(body.get('markets'))
    if markets is None:
        return validation_error(str(error), event, 'markets')

    still_used = sorted(_market_ids_in_use() - {market.market_id for market in markets})
    if still_used:
        return api_response(409, {
            'error': f"Keywords still use market(s) {', '.join(still_used)}; move or delete those keywords first",
            'market_ids': still_used,
        }, event)

    item = markets_item(markets, get_timestamp())
    brand_config_table.put_item(Item=item)
    logger.info('Saved %d market(s)', len(markets))
    return _markets_response(markets, item['updated_at'], event)


# ---------------------------------------------------------------------------
# POST: local keyword suggestions
# ---------------------------------------------------------------------------

def _requested_markets(raw: object) -> tuple[list[Market] | None, str | None]:
    """The configured markets ``raw`` names, deduplicated in request order, or an error."""
    if not isinstance(raw, list) or not raw or not all(isinstance(entry, str) for entry in raw):
        return None, 'market_ids must be a non-empty array of market ids'
    wanted = list(dict.fromkeys(raw))
    if len(wanted) > MAX_SUGGESTION_MARKETS:
        return None, f'market_ids accepts at most {MAX_SUGGESTION_MARKETS} markets'
    configured = markets_by_id(load_markets(brand_config_table))
    unknown = [market_id for market_id in wanted if market_id not in configured]
    if unknown:
        return None, f"Unknown market_ids: {', '.join(unknown)}"
    return [configured[market_id] for market_id in wanted], None


@_admin_json_route
def _suggest_keywords(event: dict[str, Any], context: Any, body: dict[str, Any]) -> dict[str, Any]:
    keyword, error = validate_keyword_text(body.get('keyword'))
    if keyword is None:
        return validation_error(str(error), event, 'keyword')
    markets, error = _requested_markets(body.get('market_ids'))
    if markets is None:
        return validation_error(str(error), event, 'market_ids')
    try:
        suggestions = suggest_local_keywords(keyword, markets)
    except Exception:
        logger.exception('Keyword suggestions failed for %d market(s)', len(markets))
        return api_response(502, {'error': 'The model could not suggest keywords; try again'}, event)
    return api_response(200, {'suggestions': suggestions}, event)


@api_handler
@cors_preflight
@route_handler({
    'GET': _get_markets,
    'PUT': _put_markets,
    'POST': _suggest_keywords,
})
def handler(_event: dict[str, Any], _context: object) -> dict[str, Any]:
    """``/api/markets``: the routes answer every request; reaching this body is a routing bug."""
    raise RouteNotHandledError(__name__)
