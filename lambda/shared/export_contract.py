"""
The export service contract (2.45.0): the views it exports, the job shape, the row-source protocol.

Every data view of the dashboard has one "Export all" button that exports the
view's complete data with its current filters. The API (``POST /api/exports``)
queues a job; the ``CitationAnalysis-Export`` state machine runs it in chunks
until the file is complete. Each view reads its rows through an
:class:`ExportRowSource` (registered in ``shared.export_sources``), which
yields every row in the view's order with a cursor pointing after it, so a
chunk that runs out of time resumes exactly where the previous one stopped.
Its generator returns a :class:`RowsEnd`: ``FINISHED`` (no row is left) or
``STOPPED`` (it stopped for time); only ``FINISHED`` completes the file.

``web/src/types/domain/exports.ts`` lists the same view ids;
``test_export_contract.py`` fails when the two drift.
"""

from __future__ import annotations

from collections.abc import Generator, Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Literal, NotRequired, Protocol, TypedDict

from shared.auth import get_caller_claims, get_caller_groups
from shared.request_deadline import Deadline

#: One id per distinct row source of the views matrix (§3, S1-S27); views showing the same rows share an id.
EXPORT_VIEWS: tuple[str, ...] = (
    'brand-appearances',      # S1 brand mention rows (Brand Mentions table, brand drill-down)
    'brand-leaderboard',      # S2 full scope brand leaderboard (Visibility, Benchmark, BV, Sentiment, Exec, Deep Dive)
    'brand-mention-summary',  # S3 brand summary with the mention filters (Brand Mentions brand sheet, BrandChart)
    'brand-trends',           # S4 period x brand (Benchmark brands over time, BV share of voice over time)
    'sources',                # S5 full source table (Visibility sources, Sources report)
    'keyword-visibility',     # S6 /visibility view=keywords rows
    'trend-periods',          # S7 /trends trend_data
    'keyword-trends',         # S8 /trends view=keyword_trends
    'engines',                # S9 /visibility engines with sentiment counts
    'persona-rankings',       # S10 /persona-rankings
    'sentiment-examples',     # S11 sentiment example pages
    'citations',              # S12 citation rollup with filters and market
    'url-breakdown',          # S13 UrlIndex rows of one URL
    'crawl-history',          # S14 CrawledContent of one URL
    'searches',               # S15 SearchResults (Recent Searches, keyword detail, brand responses)
    'citation-gaps',          # S16 every gap of every keyword in scope
    'gap-keyword-summaries',  # S17 citation-gap keyword summaries
    'prompt-insights',        # S18 ranked prompts per type
    'recommendations',        # S19 rule recommendations with saved status
    'competitor-gap',         # S20 outranked keywords + exclusive sources
    'group-kpis',             # S21 group KPI runs, drivers, keyword x run
    'report-insights',        # S22 insight facts
    'content-ideas',          # S23 Content Studio ideas
    'content-history',        # S24 Content Studio history
    'keyword-research',       # S25 keyword research job rows and history
    'alerts',                 # S26 KPI alerts and content changes
    'config-lists',           # S27 keywords, groups, markets, personas, schedules, users (Admin)
    # SEO stack views (2.45.0), replayed against the SEO router (``CitationAnalysis-SeoRouter``):
    'seo-geo',                # S28 SEO vs GEO rows and traffic share (stored, free)
    'seo-rank-tracking',      # S29 a rank tracker's results (stored, free)
    'seo-site-audit',         # S30 a finished site audit's issues, pages and robots access (stored, free)
    'seo-lighthouse',         # S31 one Lighthouse result's opportunities and metrics (stored, free)
    'seo-local',              # S32 a local SEO job's listings, results and grid points (stored, free)
    'seo-keyword-explorer',   # S33 the Keyword Explorer's ideas of one seed (cached answer, free)
    'seo-domain',             # S34 Domain Overview keywords / pages (DataForSEO paged, priced and confirmed)
    'seo-backlinks',          # S35 Backlinks tabs (DataForSEO paged, priced and confirmed)
    'seo-domain-tables',      # S36 Domain Overview SERP competitors (cached answer) and traffic snapshots (stored)
)

type ExportFormat = Literal['csv', 'xlsx']
type ExportStatus = Literal['queued', 'running', 'ready', 'failed', 'cancelled']

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]
#: Opaque, JSON-serializable position AFTER a row; only the source that produced it reads it.
type ExportCursor = dict[str, JsonValue]

#: Running (queued or running) exports one user may have at a time; one more answers 429.
MAX_RUNNING_EXPORTS_PER_USER = 5
#: Days an export item (TTL ``expires_at``) and its file (bucket lifecycle) are kept.
EXPORT_RETENTION_DAYS = 7
#: Lifetime of a presigned download URL.
DOWNLOAD_URL_SECONDS = 900
#: Data rows per XLSX sheet: Excel's 1,048,576-row limit minus the header row.
XLSX_SHEET_ROWS = 1_048_575
#: S3's smallest multipart part (every part but the last).
MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024

#: Prefix of every export file in the keywords bucket.
EXPORT_KEY_PREFIX = 'exports'

# Query parameters that page a list on screen; an export always covers the whole list.
_PAGING_PARAMS = frozenset({'limit', 'offset', 'next_token'})
_PAGING_SUFFIX = '_next_token'


@dataclass(frozen=True)
class ExportSheet:
    """One sheet of an export (CSV: one file, with a ``sheet`` column when the view has more than one)."""

    name: str
    columns: tuple[str, ...]


@dataclass(frozen=True)
class ExportRow:
    """One data row of ``sheet``, and the cursor that resumes the source right after it."""

    sheet: str
    values: tuple[JsonScalar, ...]
    cursor: ExportCursor


@dataclass(frozen=True)
class ExportMark:
    """
    Progress without a row: the source read on to ``cursor`` and found nothing to write.

    A source yields one after a page its filter emptied, so the worker
    checkpoints it and the next chunk does not read those pages again; a
    chunk that yields marks is making progress, not stalling.
    """

    cursor: ExportCursor


class RowsEnd(Enum):
    """How a source's ``rows()`` ended (the generator's return value)."""

    FINISHED = 'finished'
    """Every row was yielded: the file can be closed."""
    STOPPED = 'stopped'
    """The source stopped for time (or the deadline is too close for its next read); the next chunk resumes."""


#: What ``ExportRowSource.rows`` returns: the rows (and progress marks), then how the source ended.
type ExportRows = Generator[ExportRow | ExportMark, None, RowsEnd]


@dataclass(frozen=True)
class Caller:
    """The signed-in user an API request comes from (Cognito claims)."""

    sub: str
    email: str | None
    groups: frozenset[str]
    username: str | None = None
    """The Cognito user name (``cognito:username``): what ``AdminListGroupsForUser`` looks the user up by."""


def caller_from_event(event: object) -> Caller | None:
    """
    The caller of an API Gateway event, or ``None`` when its claims carry no ``sub``.

    Reads the claims the Cognito authorizer attaches, as ``shared.auth`` does;
    a direct invoke without ``requestContext`` has no caller.
    """
    claims = get_caller_claims(event)
    sub = claims.get('sub')
    if not isinstance(sub, str) or not sub.strip():
        return None
    email = claims.get('email')
    username = claims.get('cognito:username')
    return Caller(
        sub=sub.strip(),
        email=email.strip() if isinstance(email, str) and email.strip() else None,
        groups=get_caller_groups(event),
        username=username.strip() if isinstance(username, str) and username.strip() else None,
    )


class ExportRowSource(Protocol):
    """The complete rows of one export view (``shared.export_sources.EXPORT_SOURCES`` registers one per view)."""

    @property
    def view(self) -> str:
        """An ``EXPORT_VIEWS`` id."""
        raise NotImplementedError

    @property
    def sheets(self) -> tuple[ExportSheet, ...]:
        """The sheets the rows belong to, in file order."""
        raise NotImplementedError

    def validate(self, params: Mapping[str, str], caller: Caller) -> str | None:
        """``None`` when ``caller`` may export the view with ``params``, else the 400 message."""

    def rows(self, params: Mapping[str, str], cursor: ExportCursor | None, deadline: Deadline) -> ExportRows:
        """
        Every row in the view's order, starting after ``cursor`` (``None``: from the first).

        May yield an ``ExportMark`` between rows when it read on without
        finding one. Returns ``RowsEnd.FINISHED`` after the last row, or ``RowsEnd.STOPPED``
        when it stops early because ``deadline`` is spent or too close for its
        next read; the worker checkpoints the last row's cursor and the next
        chunk resumes. Never ends without saying which.
        """
        raise NotImplementedError


class ExportSummary(TypedDict):
    """An export as the API answers it (``GET /api/exports``, ``GET /api/exports/{id}``)."""

    export_id: str
    view: str
    params: dict[str, str]
    format: ExportFormat
    status: ExportStatus
    created_at: str
    updated_at: str
    rows: int
    truncated_cells: int
    """XLSX text cells cut to Excel's 32,767 characters (each ends with a visible marker; the CSV keeps them whole)."""
    bytes: int
    filename: str
    notified: bool
    error: NotRequired[str]
    download_url: NotRequired[str]
    download_expires_at: NotRequired[str]


def _is_paging_param(name: str) -> bool:
    return name in _PAGING_PARAMS or name.endswith(_PAGING_SUFFIX)


def export_params(query: Mapping[str, str]) -> dict[str, str]:
    """A view's on-screen query parameters as export ``params``: the same, without the paging ones."""
    return {name: value for name, value in query.items() if not _is_paging_param(name)}


def export_object_key(owner: str, export_id: str, filename: str) -> str:
    """
    ``exports/<owner>/<export_id>/<filename>`` in the keywords bucket.

    Raises:
        ValueError: A part is empty or holds a path separator, ``..`` or a NUL byte.
    """
    for label, part in (('owner', owner), ('export_id', export_id), ('filename', filename)):
        if not part or '/' in part or '\\' in part or '..' in part or '\x00' in part:
            raise ValueError(f'invalid export key {label}: {part!r}')
    return f'{EXPORT_KEY_PREFIX}/{owner}/{export_id}/{filename}'
