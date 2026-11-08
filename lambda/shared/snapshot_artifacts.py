"""
Scope snapshots (design 2.45.0): the artifact-builder protocol and the response contract every scoped view shares.

**Builders.** An ``ArtifactBuilder`` turns the KeywordLatest objects of one
scope into that scope's stored artifacts and answers a request from them:

- ``fold(acc, latest, scope)`` adds one keyword's KeywordLatest object (the
  build streams the keywords; ``acc`` starts as ``None``),
- ``finalize(acc)`` returns ``{artifact key: JSON-serializable object}``,
  keys relative to the scope's directory and without the ``.json.gz``
  suffix (``'latest/_all'``, ``'gaps'``),
- ``serve(artifacts, params)`` builds the 200 body from a stored build, or
  returns ``None`` when the build does not hold that combination (the caller
  then starts a view job and answers 202).

The tracks register builders in ``shared.artifact_registry``; the store, the
pointer and the view jobs are ``shared.scope_snapshot_*`` (track S1).

**Response contract** (design §3), for every scoped response::

    "coverage": {"keywords_total": 5000, "keywords_analyzed": 5000, "complete": true},
    "source": "snapshot" | "live", "as_of": "2026-…" | null, "stale": false, "refreshing": false

a GET whose answer is not stored yet answers ``202`` with ``computing_body``;
list pages carry ``next_token`` cursors: ``{o, b}`` (offset, build id) over
a snapshot, ``{k, r, f}`` (keyword index, row offset, scope fingerprint) over
live keywords. A cursor whose build is gone or whose scope changed answers
``400`` ``{"error", "code": "cursor_expired", "field": "next_token"}``, and the
client restarts the list; a malformed one answers the usual
``CURSOR_ERROR_MESSAGE`` 400.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal, Protocol, TypedDict

from shared.api_response import api_response, validation_error
from shared.cursors import CURSOR_ERROR_MESSAGE, decode_cursor, encode_cursor
from shared.partial_contract import KeywordLatest

# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SnapshotScope:
    """One scope a build covers."""

    scope_dir: str
    """The scope's directory inside a build (named by ``shared.scope_snapshot``, track S1)."""
    kind: Literal['all', 'market', 'group']
    group_id: str | None
    market_id: str | None
    keywords_total: int
    """Active keywords of the scope when the build resolved it."""


class SnapshotArtifacts(Protocol):
    """A stored build of one scope, as ``serve`` reads it (``shared.scope_snapshot_serve``, track S1)."""

    @property
    def build_id(self) -> str:
        """The build the artifacts belong to (snapshot cursors name it)."""
        raise NotImplementedError

    @property
    def built_at(self) -> str:
        """ISO timestamp of the build: the response's ``as_of``."""
        raise NotImplementedError

    @property
    def keywords_total(self) -> int:
        """The scope's keywords the build covers."""
        raise NotImplementedError

    @property
    def stale(self) -> bool:
        """Whether the scope, the brand config or the personas changed since the build."""
        raise NotImplementedError

    @property
    def refreshing(self) -> bool:
        """Whether a rebuild of a stale build was requested."""
        raise NotImplementedError

    @property
    def keywords_behind(self) -> int:
        """The scope's keywords whose newest run the build lacks (a KeywordLatest write failed); 0 for live and job artifacts."""
        raise NotImplementedError

    def load(self, key: str) -> Any | None:
        """The decoded artifact ``key`` (as ``finalize`` named it), or ``None`` when the build has none."""


class ArtifactBuilder[AccT](Protocol):
    """One family of artifacts of a scope snapshot (see the module docstring)."""

    @property
    def name(self) -> str:
        """The builder's name: the route serves and view jobs compute by it."""
        raise NotImplementedError

    def fold(self, acc: AccT | None, latest: KeywordLatest, scope: SnapshotScope) -> AccT:
        """``acc`` with one keyword's KeywordLatest object of ``scope`` added."""
        raise NotImplementedError

    def finalize(self, acc: AccT | None) -> dict[str, Any]:
        """The artifacts ``acc`` becomes, by key relative to the scope directory."""
        raise NotImplementedError

    def serve(self, artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
        """The body ``params`` asks of ``artifacts``; ``None`` when they do not hold it (the route answers with a view job)."""


# ---------------------------------------------------------------------------
# coverage / source / as_of / stale / refreshing
# ---------------------------------------------------------------------------

SOURCE_LIVE: Final = 'live'
SOURCE_SNAPSHOT: Final = 'snapshot'
ScopeSource = Literal['live', 'snapshot']


@dataclass(frozen=True)
class MemoryArtifacts:
    """Artifacts held in memory (``SnapshotArtifacts``): folded for one request, by a view job, or read back from one.

    ``build_id`` names them for cursors (``live-...``, ``job-...``); never stale unless said.
    """

    artifacts: Mapping[str, Any]
    build_id: str
    built_at: str
    keywords_total: int
    stale: bool = False
    refreshing: bool = False
    keywords_behind: int = 0

    def load(self, key: str) -> Any | None:
        return self.artifacts.get(key)


class Coverage(TypedDict):
    keywords_total: int
    keywords_analyzed: int
    complete: bool


class SourceEnvelope(TypedDict):
    source: ScopeSource
    as_of: str | None
    stale: bool
    refreshing: bool


def coverage(keywords_total: int, keywords_analyzed: int) -> Coverage:
    """How many of the scope's keywords the figures include; ``complete`` when every one."""
    if keywords_total < 0 or not 0 <= keywords_analyzed <= keywords_total:
        raise ValueError(f'coverage of {keywords_analyzed} out of {keywords_total} keywords')
    return {'keywords_total': keywords_total, 'keywords_analyzed': keywords_analyzed, 'complete': keywords_analyzed == keywords_total}


def live_envelope() -> SourceEnvelope:
    """A response computed for this request: current by construction."""
    return {'source': SOURCE_LIVE, 'as_of': None, 'stale': False, 'refreshing': False}


def snapshot_envelope(as_of: str, *, stale: bool = False, refreshing: bool = False) -> SourceEnvelope:
    """A response served from the build of ``as_of``; ``stale`` when the scope changed since, ``refreshing`` while a rebuild runs."""
    if refreshing and not stale:
        raise ValueError('only a stale snapshot is refreshing')
    return {'source': SOURCE_SNAPSHOT, 'as_of': as_of, 'stale': stale, 'refreshing': refreshing}


def artifacts_envelope(artifacts: SnapshotArtifacts) -> SourceEnvelope:
    """The envelope of a response served from ``artifacts``."""
    return snapshot_envelope(artifacts.built_at, stale=artifacts.stale, refreshing=artifacts.refreshing)


def keywords_served(artifacts: SnapshotArtifacts, keywords_total: int | None = None) -> int:
    """The scope's keywords (``keywords_total``, else the build's) whose latest run ``artifacts`` hold: all but the build's ``keywords_behind``."""
    total = artifacts.keywords_total if keywords_total is None else keywords_total
    return total - min(max(artifacts.keywords_behind, 0), total)


def artifacts_coverage(artifacts: SnapshotArtifacts, keywords_total: int | None = None) -> Coverage:
    """The coverage of a response served from ``artifacts`` (of ``keywords_total`` keywords when the route counts them itself)."""
    total = artifacts.keywords_total if keywords_total is None else keywords_total
    return coverage(total, keywords_served(artifacts, total))


def with_scope_contract(body: Mapping[str, Any], scope_coverage: Coverage, envelope: SourceEnvelope) -> dict[str, Any]:
    """``body`` with the common scoped-response fields (they replace any of the same name)."""
    return {**body, 'coverage': scope_coverage, **envelope}


# ---------------------------------------------------------------------------
# 202 computing / failed view jobs
# ---------------------------------------------------------------------------

STATUS_COMPUTING = 'computing'
STATUS_FAILED = 'failed'

#: The first poll interval the client is told (it backs off from 2 s to 10 s).
DEFAULT_RETRY_AFTER_MS = 2000


def computing_body(job_id: str, started_at: str, retry_after_ms: int = DEFAULT_RETRY_AFTER_MS) -> dict[str, Any]:
    """The 202 body of a GET whose answer a view job is computing: repeat the same GET to poll."""
    if not job_id or retry_after_ms <= 0:
        raise ValueError('a computing body needs a job id and a positive retry interval')
    return {'status': STATUS_COMPUTING, 'job': {'id': job_id, 'started_at': started_at}, 'retry_after_ms': retry_after_ms}


def computing_response(job_id: str, started_at: str, event: dict[str, Any] | None = None, retry_after_ms: int = DEFAULT_RETRY_AFTER_MS) -> dict[str, Any]:
    """``computing_body`` as an API Gateway ``202`` response."""
    return api_response(202, computing_body(job_id, started_at, retry_after_ms), event)


def failed_job_body(message: str) -> dict[str, Any]:
    """The 200 body answered once for a view job that failed (the next GET starts it again)."""
    return {'status': STATUS_FAILED, 'message': message}


# ---------------------------------------------------------------------------
# Cursors
# ---------------------------------------------------------------------------

CURSOR_EXPIRED_CODE = 'cursor_expired'
CURSOR_EXPIRED_MESSAGE = 'The list changed since this page was read; start again from the first page'
_CURSOR_FIELD = 'next_token'


@dataclass(frozen=True)
class SnapshotCursor:
    """A position in a list stored in one build."""

    offset: int
    build_id: str


@dataclass(frozen=True)
class KeywordCursor:
    """A position in a list read live keyword by keyword: the next keyword and the rows of it already returned."""

    keyword_index: int
    row_offset: int
    fingerprint: str


def _is_count(value: object) -> bool:
    # bool is an int subclass; True must not read as 1.
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _is_label(value: object) -> bool:
    return isinstance(value, str) and bool(value)


def encode_snapshot_cursor(offset: int, total: int, build_id: str) -> str | None:
    """The token of the page at ``offset`` of a stored list of ``total`` items, or ``None`` past its end."""
    return encode_cursor({'o': offset, 'b': build_id}) if offset < total else None


def decode_snapshot_cursor(token: str) -> SnapshotCursor | None:
    """The position an ``encode_snapshot_cursor`` token carries, or ``None`` when it is malformed."""
    decoded = decode_cursor(token, ('o', 'b'))
    if decoded is None or not _is_count(decoded['o']) or not _is_label(decoded['b']):
        return None
    return SnapshotCursor(offset=decoded['o'], build_id=decoded['b'])


def encode_keyword_cursor(cursor: KeywordCursor, keywords_total: int) -> str | None:
    """The token of ``cursor`` over a scope of ``keywords_total`` keywords, or ``None`` once every keyword is read."""
    if cursor.keyword_index >= keywords_total:
        return None
    return encode_cursor({'k': cursor.keyword_index, 'r': cursor.row_offset, 'f': cursor.fingerprint})


def decode_keyword_cursor(token: str) -> KeywordCursor | None:
    """The position an ``encode_keyword_cursor`` token carries, or ``None`` when it is malformed."""
    decoded = decode_cursor(token, ('k', 'r', 'f'))
    if decoded is None or not (_is_count(decoded['k']) and _is_count(decoded['r']) and _is_label(decoded['f'])):
        return None
    return KeywordCursor(keyword_index=decoded['k'], row_offset=decoded['r'], fingerprint=decoded['f'])


def cursor_expired_body() -> dict[str, str]:
    """The 400 body of a cursor whose build is gone or whose scope changed."""
    return {'error': CURSOR_EXPIRED_MESSAGE, 'code': CURSOR_EXPIRED_CODE, 'field': _CURSOR_FIELD}


def cursor_expired_response(event: dict[str, Any] | None = None) -> dict[str, Any]:
    """``cursor_expired_body`` as an API Gateway ``400`` response."""
    return api_response(400, cursor_expired_body(), event)


def _malformed_cursor(event: dict[str, Any] | None) -> dict[str, Any]:
    return validation_error(CURSOR_ERROR_MESSAGE, event, field=_CURSOR_FIELD)


def snapshot_page_start(
    token: str | None, current_build: str, kept_builds: Collection[str], event: dict[str, Any] | None = None,
) -> tuple[SnapshotCursor | None, dict[str, Any] | None]:
    """Where a snapshot list page starts: ``(cursor, None)`` or ``(None, 400 response)``.

    No token starts at offset 0 of ``current_build``. A token of a build that is
    neither ``current_build`` nor one of ``kept_builds`` (the builds the store
    still holds) is ``cursor_expired``: a list never mixes two builds.
    """
    if token is None:
        return SnapshotCursor(offset=0, build_id=current_build), None
    cursor = decode_snapshot_cursor(token)
    if cursor is None:
        return None, _malformed_cursor(event)
    if cursor.build_id != current_build and cursor.build_id not in kept_builds:
        return None, cursor_expired_response(event)
    return cursor, None


def keyword_page_start(
    token: str | None, fingerprint: str, event: dict[str, Any] | None = None,
) -> tuple[KeywordCursor | None, dict[str, Any] | None]:
    """Where a live keyword-major page starts: ``(cursor, None)`` or ``(None, 400 response)``.

    No token starts at the first keyword. A token minted for another keyword
    set (``fingerprint`` of the scope's keywords now) is ``cursor_expired``.
    """
    if token is None:
        return KeywordCursor(keyword_index=0, row_offset=0, fingerprint=fingerprint), None
    cursor = decode_keyword_cursor(token)
    if cursor is None:
        return None, _malformed_cursor(event)
    if cursor.fingerprint != fingerprint:
        return None, cursor_expired_response(event)
    return cursor, None


__all__ = [
    'CURSOR_EXPIRED_CODE',
    'DEFAULT_RETRY_AFTER_MS',
    'SOURCE_LIVE',
    'SOURCE_SNAPSHOT',
    'STATUS_COMPUTING',
    'STATUS_FAILED',
    'ArtifactBuilder',
    'Coverage',
    'KeywordCursor',
    'MemoryArtifacts',
    'ScopeSource',
    'SnapshotArtifacts',
    'SnapshotCursor',
    'SnapshotScope',
    'SourceEnvelope',
    'artifacts_coverage',
    'artifacts_envelope',
    'computing_body',
    'computing_response',
    'coverage',
    'cursor_expired_body',
    'cursor_expired_response',
    'decode_keyword_cursor',
    'decode_snapshot_cursor',
    'encode_keyword_cursor',
    'encode_snapshot_cursor',
    'failed_job_body',
    'keyword_page_start',
    'keywords_served',
    'live_envelope',
    'snapshot_envelope',
    'snapshot_page_start',
    'with_scope_contract',
]
