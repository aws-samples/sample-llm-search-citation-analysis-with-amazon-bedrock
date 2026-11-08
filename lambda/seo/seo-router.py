"""
SEO API router Lambda (``CitationAnalysis-SeoRouter``, built by ``lib/seo-stack.ts``)

Routes (every one behind the Cognito authorizer of ``CitationAnalysis-SeoApi``):
- POST /api/seo/keywords/metrics, POST /api/seo/keywords/metrics/lookup -> seo-keyword-metrics handler
- POST /api/seo/keywords/research, POST /api/seo/serp -> seo-keywords handler
- GET  /api/seo/account -> seo-account handler (Admin)
- GET  /api/seo/daily-calls -> seo-account handler (the caller's paid calls today and the limit)
- GET  /api/seo/seo-geo -> seo-geo handler
- /api/seo/local/... -> seo-local handler (business listings, local results, local jobs)
- /api/seo/rank-trackers/... -> seo-rank-tracking handler
- /api/seo/domains/..., /api/seo/insights -> seo-domains handler
- /api/seo/backlinks/... -> seo-backlinks handler
- /api/seo/audits/... -> seo-audits handler
- /api/seo/lighthouse/..., /api/seo/indexnow/... -> seo-performance handler

Every billed DataForSEO call of a paid one-off route counts against the user's daily limit, set in Settings
(``shared.seo_spend_limit``): the call that would pass it is not sent and the answer is 429 ``DAILY_LIMIT``.
"""

import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.consolidated_router import route_map_handler
from shared.seo_spend_limit import limited

ROUTE_MAP = {
    # Before its parent so `/keywords/metrics...` never reaches the research handler.
    '/api/seo/keywords/metrics': 'seo-keyword-metrics.py',
    '/api/seo/keywords': 'seo-keywords.py',
    '/api/seo/serp': 'seo-keywords.py',
    '/api/seo/account': 'seo-account.py',
    '/api/seo/daily-calls': 'seo-account.py',
    '/api/seo/seo-geo': 'seo-geo.py',
    '/api/seo/local': 'seo-local.py',
    '/api/seo/rank-trackers': 'seo-rank-tracking.py',
    '/api/seo/domains': 'seo-domains.py',
    '/api/seo/insights': 'seo-domains.py',
    '/api/seo/backlinks': 'seo-backlinks.py',
    '/api/seo/audits': 'seo-audits.py',
    '/api/seo/lighthouse': 'seo-performance.py',
    '/api/seo/indexnow': 'seo-performance.py',
}

handler = limited(route_map_handler(__file__, ROUTE_MAP, __name__))
