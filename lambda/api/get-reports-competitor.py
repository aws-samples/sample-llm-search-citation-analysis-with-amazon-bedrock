"""
Reports Competitor Rollup API

Per-competitor rollup that powers the Competitor Gap print report and
ad-hoc "where is X eating our lunch" lookups. Combines:

- Outranked keywords: keywords where the competitor's best rank beats
  every first-party brand's best rank.
- Exclusive citation sources: URLs that cite this competitor but no
  first-party brand (a subset of citation gaps, filtered by competitor).
- Outreach targets: the same exclusive sources sorted by an outreach
  lift score so a PR strategist can plan a sprint.

Why this exists rather than client-side composition

The competitor view requires a join across keyword * provider * brand
that the existing /visibility and /citation-gaps endpoints don't surface
directly. Building this client-side would require iterating every
configured competitor and every keyword on the frontend with N+1
visibility/gap calls. Doing it server-side fans out once per request
and caches naturally per analysis run.

Routes

  GET /api/reports/competitor?competitor=<name>
    Returns a single competitor's rollup.

  GET /api/reports/competitor
    Returns the cross-competitor list — every configured competitor's
    rollup at once. Useful for the report's selector dropdown to know
    what's available.

Query params

  competitor (str, optional)  — when omitted, all configured competitors.
  keyword_limit (int, 1-100, default 50) — caps the keyword fan-out.
                                            Above 50 keywords the call
                                            blows past the Lambda
                                            timeout, so we hard-cap.
"""

from __future__ import annotations

import importlib.util
import logging
import math
import os
import sys
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

# Shared layer path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.decorators import api_handler, validate
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

SEARCH_RESULTS_TABLE = os.environ.get('DYNAMODB_TABLE_SEARCH_RESULTS')
KEYWORDS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORDS')


# ----------------------------------------------------------------------
# Sibling helper loader (same lazy pattern as get-reports-overview).
# Lazy so module-level boto3 calls in the sibling files don't fire at
# import time and so unit tests can stub the helpers via the cache.
# ----------------------------------------------------------------------

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_sibling_cache: dict[str, Callable] = {}


def _load_sibling(filename: str, attr: str) -> Callable:
    module_name = filename.replace('-', '_').replace('.py', '_for_competitor')
    spec = importlib.util.spec_from_file_location(
        module_name, os.path.join(_API_DIR, filename)
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load sibling module {filename!r}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    fn = getattr(module, attr, None)
    if fn is None:
        raise AttributeError(f"{filename} has no attribute {attr!r}")
    return fn


def _gap_helper() -> Callable:
    """Lazy-load `analyze_citation_gaps` from get-citation-gaps.py."""
    if 'gap' not in _sibling_cache:
        _sibling_cache['gap'] = _load_sibling(
            'get-citation-gaps.py', 'analyze_citation_gaps'
        )
    return _sibling_cache['gap']


# ----------------------------------------------------------------------
# Keyword discovery + per-keyword rank lookup
# ----------------------------------------------------------------------

def _list_tracked_keywords(limit: int) -> list[str]:
    """
    Pull tracked keywords from the Keywords table when available, else
    fall back to a search-results scan. Same trick `get-historical-trends`
    uses to keep cold-start latency low.
    """
    if KEYWORDS_TABLE:
        table = dynamodb.Table(KEYWORDS_TABLE)
        response = table.scan(ProjectionExpression='keyword', Limit=500)
        names = [
            item.get('keyword', '')
            for item in response.get('Items', [])
            if item.get('keyword')
        ]
    else:
        if not SEARCH_RESULTS_TABLE:
            return []
        table = dynamodb.Table(SEARCH_RESULTS_TABLE)
        response = table.scan(ProjectionExpression='keyword', Limit=500)
        names = [
            item.get('keyword', '')
            for item in response.get('Items', [])
            if item.get('keyword')
        ]
    return list(dict.fromkeys(names))[:limit]


def _latest_brand_ranks(keyword: str) -> dict[str, dict[str, Any]]:
    """
    For a keyword, return the latest snapshot's brand ranks indexed by
    lower-cased brand name. Returns empty dict if no data.
    """
    if not SEARCH_RESULTS_TABLE:
        return {}
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    response = table.query(
        KeyConditionExpression=Key('keyword').eq(keyword)
    )
    items = response.get('Items', [])
    if not items:
        return {}

    latest_ts = max(item.get('timestamp', '') for item in items)
    latest_items = [item for item in items if item.get('timestamp') == latest_ts]

    aggregated: dict[str, dict[str, Any]] = defaultdict(lambda: {
        'best_rank': 999,
        'providers': set(),
        'classification': 'other',
    })
    for item in latest_items:
        provider = item.get('provider', '')
        for brand in item.get('brands', []) or []:
            name = (brand.get('name') or '').strip().lower()
            if not name:
                continue
            try:
                rank = int(brand.get('rank') or 999)
            except (TypeError, ValueError):
                rank = 999
            row = aggregated[name]
            row['best_rank'] = min(row['best_rank'], rank)
            row['providers'].add(provider)
            classification = brand.get('classification')
            if classification:
                row['classification'] = classification

    # Convert sets to sorted lists for stable JSON serialization
    return {
        name: {
            'best_rank': data['best_rank'],
            'providers': sorted(data['providers']),
            'classification': data['classification'],
        }
        for name, data in aggregated.items()
    }


# ----------------------------------------------------------------------
# Rollup composition
# ----------------------------------------------------------------------

def _outreach_lift(citation_count: int, provider_count: int) -> float:
    """
    Lift heuristic for outreach prioritisation. Sources cited by many
    providers + many times have higher lift. We use log scaling on
    citation_count to dampen the very-cited outliers (a single domain
    with 50 citations should not dwarf 5 domains with 10 each).
    """
    return round(provider_count * math.log(max(citation_count, 1) + 1), 2)


def _build_competitor_rollup(
    competitor: str,
    keywords: list[str],
    config: dict[str, Any],
) -> dict[str, Any]:
    """Compose one competitor's rollup."""
    competitor_lc = competitor.lower()
    first_party = [
        b.lower() for b in config.get('tracked_brands', {}).get('first_party', [])
    ]

    outranked: list[dict[str, Any]] = []
    exclusive_sources: list[dict[str, Any]] = []

    for keyword in keywords:
        ranks = _latest_brand_ranks(keyword)
        their = ranks.get(competitor_lc)
        if not their or their['best_rank'] >= 999:
            continue

        our_best = min(
            (ranks[fp]['best_rank'] for fp in first_party if fp in ranks),
            default=999,
        )

        if their['best_rank'] < our_best:
            outranked.append({
                'keyword': keyword,
                'their_best_rank': their['best_rank'],
                'our_best_rank': our_best if our_best < 999 else None,
                'rank_delta': (our_best - their['best_rank'])
                if our_best < 999 else None,
                'providers': their['providers'],
            })

        # Citation gaps for this keyword that name this competitor.
        try:
            gap_payload = _gap_helper()(keyword, config)
        except Exception as exc:
            logger.warning(f'gap helper failed for {keyword}: {exc}')
            gap_payload = {}

        for gap in gap_payload.get('gaps', []) or []:
            named = [b.lower() for b in gap.get('competitor_brands', []) or []]
            if competitor_lc not in named:
                continue
            citation_count = int(gap.get('citation_count', 0) or 0)
            provider_count = int(gap.get('provider_count', 0) or 0)
            exclusive_sources.append({
                'keyword': keyword,
                'url': gap.get('url'),
                'domain': gap.get('domain'),
                'priority': gap.get('priority', 'low'),
                'citation_count': citation_count,
                'provider_count': provider_count,
                'providers': gap.get('providers', []),
                'lift_score': _outreach_lift(citation_count, provider_count),
            })

    # Order outranked keywords by the size of the gap to us — biggest
    # delta first. Order outreach by lift (descending), then priority.
    outranked.sort(
        key=lambda r: (r['rank_delta'] if r['rank_delta'] is not None else -1),
        reverse=True,
    )
    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    exclusive_sources.sort(
        key=lambda s: (-s['lift_score'], priority_order.get(s['priority'], 2)),
    )

    return {
        'competitor': competitor,
        'outranked_keywords': outranked,
        'exclusive_sources': exclusive_sources,
        'outreach_targets': exclusive_sources[:10],
    }


def build_competitor_rollups(
    config: dict[str, Any],
    competitor: str | None,
    keyword_limit: int,
) -> dict[str, Any]:
    """
    Top-level composer. When `competitor` is provided, returns a single
    rollup (and includes that competitor in the `competitors` list so
    the response shape stays uniform). Otherwise iterates every
    configured competitor.
    """
    tracked_brands = config.get('tracked_brands', {})
    configured = [str(b) for b in tracked_brands.get('competitors', []) or []]

    keywords = _list_tracked_keywords(keyword_limit)

    if competitor:
        # Validate that the competitor is configured. Returning a 404 on
        # an unconfigured name is more helpful than silently returning
        # an empty rollup which the UI would then misinterpret.
        if competitor.lower() not in {c.lower() for c in configured}:
            return {
                'error': f'Unknown competitor: {competitor!r}',
                'configured_competitors': configured,
            }
        return {
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'keywords_analyzed': len(keywords),
            'competitor': competitor,
            'rollup': _build_competitor_rollup(competitor, keywords, config),
        }

    rollups = [
        _build_competitor_rollup(c, keywords, config) for c in configured
    ]
    return {
        'generated_at': datetime.utcnow().isoformat() + 'Z',
        'keywords_analyzed': len(keywords),
        'competitors': configured,
        'rollups': rollups,
    }


# ----------------------------------------------------------------------
# Lambda entry point
# ----------------------------------------------------------------------

@api_handler
@validate({
    'competitor': {'type': str, 'max_length': 200},
    'keyword_limit': {'type': int, 'min': 1, 'max': 100, 'default': 50},
})
def handler(
    event: dict[str, Any],
    context: Any,
    competitor: str | None = None,
    keyword_limit: int = 50,
) -> dict[str, Any]:
    """API handler for GET /api/reports/competitor."""
    config = get_brand_config()
    payload = build_competitor_rollups(
        config, competitor=competitor, keyword_limit=keyword_limit,
    )
    if 'error' in payload:
        return validation_error(payload['error'], event, 'competitor')
    return success_response(payload, event)
