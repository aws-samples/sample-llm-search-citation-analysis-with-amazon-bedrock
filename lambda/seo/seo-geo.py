"""
SEO vs GEO API: ``GET /api/seo/seo-geo?market_id=<id>&group_id=<id>`` (metrics defined in ``docs/seo-metrics.md``).

Makes no DataForSEO call: ``seo_geo_data`` loads the keywords, their latest Google AI Overviews runs, their
search volumes and the market's latest domain snapshots, and the rules in ``shared.seo_geo`` /
``shared.seo_geo_traffic`` build the rows and the estimated-traffic comparison.
"""

import sys
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from seo_geo_data import SCOPE_QUERY_SCHEMA, load_seo_geo, seo_geo_payload
from seo_http import seo_route

from shared.api_response import success_response
from shared.decorators import validate


@validate(SCOPE_QUERY_SCHEMA)
def handle_seo_geo(event: dict[str, Any], _context: Any, *, market_id: str | None, group_id: str | None,
                   **_request: Any) -> dict[str, Any]:
    """GET /api/seo/seo-geo - the SEO vs GEO table of a market (and keyword group)."""
    return success_response(seo_geo_payload(load_seo_geo(market_id, group_id)), event)


handler = seo_route({('GET', '/seo-geo'): handle_seo_geo})
