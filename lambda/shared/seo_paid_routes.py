"""The SEO API's paid one-off routes: a signed-in user's request makes billed DataForSEO calls.

Their billed calls count against the user's daily limit (``shared.seo_spend_limit``). The MCP server reads the
same list to tell a lookup that draws on that limit from an Admin's SEO job, which is confirmed on its own.
"""

from __future__ import annotations

#: The paid one-off routes (``POST``), by their path below ``/api/seo``.
PAID_ROUTES = frozenset({
    'keywords/research', 'keywords/metrics', 'serp',
    'domains/overview', 'domains/keywords', 'domains/pages', 'domains/competitors',
    'backlinks/overview', 'backlinks/rows', 'backlinks/referring-domains', 'backlinks/top-pages',
    'local/businesses', 'local/profile', 'local/questions', 'local/serp', 'local/jobs',
    'lighthouse',
})
_PREFIX = '/api/seo/'


def is_paid(method: str, path: str) -> bool:
    """Whether ``method path`` is a paid one-off request."""
    return method == 'POST' and path.startswith(_PREFIX) and path[len(_PREFIX):].rstrip('/') in PAID_ROUTES
