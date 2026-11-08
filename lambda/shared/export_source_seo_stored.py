"""
Export sources of the SEO views read from stored data (2.45.0): S28-S33.

Each replays its SEO route against the SEO router (``seo`` in
``EXPORT_API_FUNCTIONS``, ``CitationAnalysis-SeoRouter``); none of them makes
a paid DataForSEO call. The SEO read routes check no owner (every signed-in
user reads the same SEO data), so the export service's own claims read
what the export's owner sees.

- ``seo-geo``: the SEO vs GEO report of a market (``market_id``) and keyword
  group (``group_id``), one table chosen by ``table``: ``Keywords`` (every
  keyword row, largest volume first) or ``Traffic share``. Stored data, one
  answer (the route reads at most 500 keywords, as the report shows).
- ``seo-rank-tracking``: one tracker's (``tracker_id``) results compared with
  ``period`` ago, in the route's order (best position on the first device).
- ``seo-site-audit``: a finished audit (``audit_id``): its issue types, the
  pages of every issue type (one sheet, issue types in the report's order,
  each paged to its end) and the robots.txt AI crawler access. The report
  opens one issue type's pages at a time; the export holds them all, so one
  file answers "which pages have which issue". An audit still running
  answers ``audit_running`` and fails the export instead of a short file.
- ``seo-lighthouse``: one stored run (``run_id``): the failed audits and the
  page speed metrics of each completed result, narrowed to one page and
  device by ``url`` and ``device`` (the report the button sits in).
- ``seo-local``: one local SEO table chosen by ``table``: ``Businesses`` and
  ``Local results`` replay the GET twins of the paid searches, which read the
  cache only and answer 404 ``NOT_CACHED`` once it expired (the export then
  fails with that message, never pays); ``Rank grid`` reads a stored grid
  job (``job_id``).
- ``seo-keyword-explorer``: the cached ideas of one seed (``GET
  /api/seo/keywords/research``, cache only, 404 ``NOT_CACHED`` when expired)
  with the table's filters and sort, applied by the route.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from shared.audit_issues import ISSUE_TYPES, type_order
from shared.export_contract import ExportSheet
from shared.export_source_routes import SINGLE, Column, Paging, RouteList, RouteSource, columns

ROUTER = 'seo'
#: The SEO vs GEO organic position shown as ``>10`` when a results page was read without your domains in its top 10.
SEO_TOP_POSITION = 10
#: The page speed metrics of a Lighthouse result, in the report's order.
LIGHTHOUSE_METRICS = ('lcp_ms', 'cls', 'inp_ms', 'ttfb_ms', 'fcp_ms', 'tbt_ms')
RANK_DEVICES = ('desktop', 'mobile')
#: Affected pages one audit issues request reads (the route's maximum).
AUDIT_PAGE_SIZE = 200


@dataclass(frozen=True)
class SheetGroupSource(RouteSource):
    """A ``RouteSource`` whose consecutive lists may fill one sheet (each sheet listed once)."""

    @property
    def sheets(self) -> tuple[ExportSheet, ...]:
        return tuple(dict.fromkeys(route_list.export_sheet for route_list in self.lists))


def _stored(sheet: str, column_names: tuple[Column, ...], path: str, items: str, **options: Any) -> RouteList:
    """A list one stored answer holds whole (no paging, no partial flag)."""
    return RouteList(sheet, column_names, ROUTER, path, items, options.pop('paging', SINGLE),
                     partial_flags=options.pop('partial_flags', ()), **options)


# --- S28 SEO vs GEO ------------------------------------------------------------------


def _seo_geo_row(row: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The row as the table shows it: an organic position beyond the read top 10 is ``>10``."""
    beyond = row.get('organic_position') is None and row.get('ai_overview_shown') is not None
    return [{**row, 'organic_position': f'>{SEO_TOP_POSITION}'} if beyond else row]


_SEO_GEO_PATH = '/api/seo/seo-geo'

SEO_GEO = RouteSource(
    'seo-geo',
    (
        _stored(
            'Keywords',
            columns(
                'keyword', 'search_volume', 'organic_position', 'ranked_position', 'organic_position_source',
                'estimated_traffic', 'ai_overview_shown', 'ai_overview_cites_you', 'ai_overview_cited_competitors',
                'ai_mention_rate', 'answers', 'citation_overlap', 'quadrant', 'last_run', 'keyword_id',
            ),
            _SEO_GEO_PATH, 'rows', rows_of=_seo_geo_row,
        ),
        _stored(
            'Traffic share', columns('name', 'owned', 'estimated_traffic', 'traffic_share', 'share_of_voice'),
            _SEO_GEO_PATH, 'traffic_comparison',
        ),
    ),
    params=('market_id', 'group_id'),
    select='table',
    required=('table',),
)


# --- S29 Rank tracking -------------------------------------------------------------


def rank_change(cell: Any) -> int | float | str | None:
    """
    A keyword's move on one device, as the table shows it.

    previous - current, ``new`` without a previous position, ``lost`` without a
    current one, ``None`` when it was not checked or never ranked.
    """
    if not isinstance(cell, Mapping) or cell.get('status') == 'not_checked':
        return None
    position, previous = cell.get('position'), cell.get('previous_position')
    if position is None:
        return None if previous is None else 'lost'
    return 'new' if previous is None else previous - position


def _rank_row(row: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [{**row, **{f'{device}_change': rank_change(row.get(device)) for device in RANK_DEVICES}}]


def _device_columns(device: str) -> tuple[Column, ...]:
    return (
        Column(f'{device}_position', f'{device}.position'),
        Column(f'{device}_previous_position', f'{device}.previous_position'),
        Column(f'{device}_change'),
        Column(f'{device}_url', f'{device}.url'),
        Column(f'{device}_serp_features', f'{device}.serp_features'),
        Column(f'{device}_status', f'{device}.status'),
        Column(f'{device}_checked_at', f'{device}.checked_at'),
    )


RANK_TRACKING = RouteSource(
    'seo-rank-tracking',
    (
        _stored(
            'Rank tracking',
            (*columns('keyword', 'source'), *(column for device in RANK_DEVICES for column in _device_columns(device)),
             *columns('keyword_id')),
            '/api/seo/rank-trackers/{id}/results', 'rows', path_param='tracker_id', forwards=('period',),
            rows_of=_rank_row,
        ),
    ),
    params=('tracker_id', 'period'),
    required=('tracker_id',),
)


# --- S30 Site audit ----------------------------------------------------------------


def issue_detail_text(details: Any) -> str | None:
    """An issue's details in full: ``key: value`` (lists joined with commas), separated by `` · ``."""
    if not isinstance(details, Mapping) or not details:
        return None
    parts = []
    for key, value in details.items():
        shown = ', '.join(str(entry) for entry in value) if isinstance(value, list) else str(value)
        parts.append(f"{str(key).replace('_', ' ')}: {shown}")
    return ' · '.join(parts)


def _affected_pages(issue_type: str) -> RouteList:
    """Every page one issue type affects, paged to its end, each row named after the issue."""
    entry = ISSUE_TYPES[issue_type]
    tag = {'issue': entry.title, 'issue_severity': entry.severity, 'issue_group': entry.group}

    def rows_of(item: Mapping[str, Any]) -> list[Mapping[str, Any]]:
        return [{**item, **tag, 'details_text': issue_detail_text(item.get('details'))}]

    return RouteList(
        'Affected pages',
        columns('issue', 'issue_type', 'severity=issue_severity', 'group=issue_group', 'page_url', 'details=details_text'),
        ROUTER, '/api/seo/audits/{id}/issues', 'items', Paging(limit=AUDIT_PAGE_SIZE),
        fixed={'issue_type': issue_type}, path_param='audit_id', partial_flags=('audit_running',), forwards=(),
        rows_of=rows_of,
    )


SITE_AUDIT = SheetGroupSource(
    'seo-site-audit',
    (
        _stored(
            'Issue types', columns('severity', 'group', 'title', 'pages', 'issues', 'how_to_fix', 'explanation', 'issue_type'),
            '/api/seo/audits/{id}/issues', 'issue_types', path_param='audit_id', partial_flags=('audit_running',),
            forwards=(),
        ),
        *(_affected_pages(issue_type) for issue_type in sorted(ISSUE_TYPES, key=type_order)),
        _stored(
            'AI crawler access', columns('token', 'vendor', 'bot_class', 'access', 'rule', 'line', 'blocked_paths'),
            '/api/seo/audits/{id}', 'audit.ai_readiness.bots', path_param='audit_id', forwards=(), optional=True,
        ),
    ),
    params=('audit_id',),
    required=('audit_id',),
)


# --- S31 Lighthouse ----------------------------------------------------------------


def _completed(result: Mapping[str, Any]) -> bool:
    return result.get('status') == 'completed'


def _opportunities(result: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The failed audits of a completed result, tagged with its page and device."""
    audits = result.get('failed_audits') if _completed(result) else None
    page = {'url': result.get('url'), 'device': result.get('device')}
    return [{**page, **audit} for audit in audits if isinstance(audit, Mapping)] if isinstance(audits, list) else []


def _metrics(result: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The page speed metrics of a completed result, one row each, in the report's order."""
    measured = result.get('metrics') if _completed(result) else None
    if not isinstance(measured, Mapping):
        return []
    page = {'url': result.get('url'), 'device': result.get('device'), 'fetched_at': result.get('fetched_at')}
    return [{**page, 'metric': metric, 'value': measured.get(metric)} for metric in LIGHTHOUSE_METRICS]


_LIGHTHOUSE_PATH = '/api/seo/lighthouse/{id}'
_RESULT_MATCH = {'url': 'url', 'device': 'device'}

LIGHTHOUSE = RouteSource(
    'seo-lighthouse',
    (
        _stored(
            'Metrics', columns('url', 'device', 'metric', 'value', 'fetched_at'),
            _LIGHTHOUSE_PATH, 'run.results', path_param='run_id', forwards=(), rows_of=_metrics, matches=_RESULT_MATCH,
        ),
        _stored(
            'Opportunities',
            columns('url', 'device', 'severity', 'category', 'title', 'savings_ms', 'savings_bytes', 'score',
                    'display_value', 'description', 'id'),
            _LIGHTHOUSE_PATH, 'run.results', path_param='run_id', forwards=(), rows_of=_opportunities,
            matches=_RESULT_MATCH,
        ),
    ),
    params=('run_id', 'url', 'device'),
    required=('run_id',),
)


# --- S32 Local SEO -----------------------------------------------------------------

_BUSINESS_FIELDS = ('rating', 'reviews_count', 'category', 'is_claimed', 'phone', 'url', 'domain', 'address',
                    'latitude', 'longitude', 'cid', 'place_id')
_TARGET = ('name', 'cid', 'place_id', 'domain')
_POINT = ('latitude', 'longitude', 'market_id')


def _local_results(body: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """The results in their order, each marked when it is the business looked for (the route's ``match``)."""
    items = body.get('items')
    match = body.get('match')
    yours = match.get('index') if isinstance(match, Mapping) else None
    if not isinstance(items, list):
        return []
    return [
        {**item, 'rank': _rank_of(item), 'yours': position == yours}
        for position, item in enumerate(items) if isinstance(item, Mapping)
    ]


def _rank_of(item: Mapping[str, Any]) -> Any:
    absolute = item.get('rank_absolute')
    return item.get('rank_group') if absolute is None else absolute


def _grid_point(point: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """A grid point with its row and column counted from 1, and whether the business was found there."""
    row, col = point.get('row'), point.get('col')
    found = point.get('rank') is not None if point.get('status') == 'ready' else None
    return [{
        **point, 'row': row + 1 if isinstance(row, int) else row, 'col': col + 1 if isinstance(col, int) else col,
        'found': found,
    }]


LOCAL = RouteSource(
    'seo-local',
    (
        _stored(
            'Businesses', columns('title', *_BUSINESS_FIELDS),
            '/api/seo/local/businesses', 'businesses',
            forwards=('query', *_POINT, 'radius_km', 'min_rating', 'min_reviews', 'is_claimed', 'sort_by', 'count',
                      'categories'),
        ),
        _stored(
            'Local results', columns('rank', 'title', *_BUSINESS_FIELDS, 'yours'),
            '/api/seo/local/serp', '', rows_of=_local_results,
            forwards=('keyword', *_POINT, *_TARGET, 'zoom', 'search_type', 'device', 'depth'),
        ),
        _stored(
            'Rank grid',
            columns('row', 'col', 'latitude', 'longitude', 'status', 'found', 'rank', 'results_count',
                    'top_result=top_result.title', 'top_result_cid=top_result.cid'),
            '/api/seo/local/jobs/{id}', 'result.points', path_param='job_id', forwards=_TARGET, rows_of=_grid_point,
        ),
    ),
    params=(
        'query', *_POINT, 'radius_km', 'min_rating', 'min_reviews', 'is_claimed', 'sort_by', 'count', 'categories',
        'keyword', *_TARGET, 'zoom', 'search_type', 'device', 'depth', 'job_id',
    ),
    select='table',
    required=('table',),
)


# --- S33 Keyword Explorer ----------------------------------------------------------

KEYWORD_EXPLORER = RouteSource(
    'seo-keyword-explorer',
    (
        _stored(
            'Keywords', columns('keyword', 'search_volume', 'cpc', 'competition', 'keyword_difficulty', 'intent'),
            '/api/seo/keywords/research', 'rows',
        ),
    ),
    params=(
        'keyword', 'market_id', 'mode', 'count', 'group_keywords', 'clickstream', 'include', 'exclude', 'min_volume',
        'max_volume', 'max_difficulty', 'min_cpc', 'max_cpc', 'intents', 'sort', 'direction',
    ),
    required=('keyword',),
)

# --- S36 Domain Overview tables shown from one free answer ---------------------------

#: The view's keywords travel as a JSON list in the export parameters (POST body ``keywords``).
_COMPETITOR_JSON_PARAMS = ('keywords', 'include_subdomains', 'cached_only')

DOMAIN_TABLES = RouteSource(
    'seo-domain-tables',
    (
        # The SERP competitors table: only the answer the view already paid for (cached 12 h), never a new call.
        RouteList(
            'SERP competitors',
            columns('domain', 'visibility', 'avg_position', 'median_position', 'etv', 'keywords_count'),
            ROUTER, '/api/seo/domains/competitors', 'items', SINGLE, method='POST',
            json_params=_COMPETITOR_JSON_PARAMS, fixed={'cached_only': 'true'}, partial_flags=(),
            forwards=('keywords', 'market_id', 'include_subdomains'),
        ),
        _stored(
            'Traffic snapshots',
            columns('snapshot_at', 'organic_keywords', 'estimated_traffic', 'traffic_cost', 'keywords_stored'),
            '/api/seo/domains/snapshots', 'snapshots', forwards=('domain', 'market_id'),
        ),
    ),
    params=('keywords', 'market_id', 'include_subdomains', 'domain'),
    select='table',
    required=('table',),
)

SOURCES_OF_SEO_STORED: tuple[RouteSource, ...] = (
    SEO_GEO, RANK_TRACKING, SITE_AUDIT, LIGHTHOUSE, LOCAL, KEYWORD_EXPLORER, DOMAIN_TABLES,
)
