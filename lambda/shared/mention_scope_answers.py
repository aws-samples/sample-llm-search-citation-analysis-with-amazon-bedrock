"""
How the mention routes answer a multi-keyword scope (track S3, design 2.45.0 §2): the live contract and the large-scope path.

``GET /brand-mentions`` and ``GET /visibility/sentiment-examples`` share it:

- ``live_scope_contract``: a body read live gets ``keywords_truncated`` (the
  time budget left keywords unread), ``truncated`` (the budget cut anything)
  and the scope contract with ``source: live`` and honest ``coverage``;
- ``serve_large_scope``: a scope over ``scope_source.LIVE_ROWS_BUDGET`` is
  answered from its snapshot build (``open_snapshot`` + ``serve_view``),
  checking a keyword cursor against the build first, or from a view job
  (``mention_view_jobs.mention_job_answer``) when the build does not hold
  the view (no build yet, or another run than each keyword's latest).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from shared.api_response import success_response
from shared.artifact_registry import serve_view
from shared.keyword_major_pages import PageRequest, Slot
from shared.mention_view_jobs import job_scope_contract, mention_job_answer
from shared.request_deadline import current_deadline
from shared.scope_params import ReportScope
from shared.scope_snapshot_serve import open_snapshot
from shared.scoped_reports import ScopeRead
from shared.snapshot_artifacts import (
    CURSOR_EXPIRED_CODE,
    SnapshotArtifacts,
    artifacts_envelope,
    coverage,
    cursor_expired_response,
    keyword_page_start,
    live_envelope,
    with_scope_contract,
)


def live_scope_contract(body: Mapping[str, Any], report_scope: ReportScope, loaded: ScopeRead[Any]) -> dict[str, Any]:
    """``body`` read live with ``keywords_truncated``, ``truncated`` and the scope contract (``coverage`` counts the keywords read)."""
    fields = {**body, 'keywords_truncated': bool(loaded.skipped), 'truncated': current_deadline().cut}
    return with_scope_contract(fields, coverage(len(report_scope.keywords), len(loaded.values)), live_envelope())


def live_lists_page[ItemT](
    lists: Sequence[Sequence[ItemT]], next_token: str | None, fingerprint: str, limit: int, event: dict[str, Any],
) -> tuple[PageRequest[ItemT] | None, dict[str, Any] | None]:
    """The page request over per-keyword ``lists`` already read live, or the 400 of a malformed or expired ``next_token``."""
    cursor, rejected = keyword_page_start(next_token, fingerprint, event)
    if cursor is None:
        return None, rejected or cursor_expired_response(event)
    slots = [Slot(position, len(items)) for position, items in enumerate(lists)]
    return PageRequest(slots, cursor, limit, lists.__getitem__, len(lists), budgeted=False), None


def snapshot_scope_contract(body: Mapping[str, Any], report_scope: ReportScope, artifacts: SnapshotArtifacts) -> dict[str, Any]:
    """``body`` served from ``artifacts`` with ``scope`` and the scope contract (``source: snapshot``, ``as_of`` the build)."""
    total = len(report_scope.keywords)
    scoped = {'scope': report_scope.describe(), **body}
    return with_scope_contract(scoped, coverage(total, min(total, artifacts.keywords_total)), artifacts_envelope(artifacts))


@dataclass(frozen=True)
class LargeScopeView:
    """One view of a large scope: its view-job route, its snapshot builder and what ``serve`` needs.

    ``fingerprint(build_id)`` is the keyword-cursor fingerprint of a paged
    view over that build (``None`` for an unpaged one); ``extra`` is added
    to the body (the summary's ``config``).
    """

    route: str
    builder: str
    params: Mapping[str, Any]
    readers: Any
    fingerprint: Callable[[str], str] | None = None
    extra: Mapping[str, Any] = MappingProxyType({})


def serve_large_scope(report_scope: ReportScope, brand_config_updated_at: str | None, view: LargeScopeView, event: dict[str, Any]) -> dict[str, Any]:
    """The view from the scope's build; a view job when the build does not hold it; 400 for a cursor of another build."""
    artifacts = open_snapshot(report_scope, brand_config_updated_at)
    if artifacts is None or view.params.get('timestamp'):
        return mention_job_answer(view.route, view.params, report_scope, event, job_scope_contract(report_scope, view.extra))
    serve_params = {**view.params, 'readers': view.readers}
    if view.fingerprint is not None:
        cursor, rejected = keyword_page_start(view.params.get('next_token'), view.fingerprint(artifacts.build_id), event)
        if rejected is not None:
            return rejected
        serve_params['cursor'] = cursor
    body = serve_view(view.builder, artifacts, serve_params)
    if body is None:
        return mention_job_answer(view.route, view.params, report_scope, event, job_scope_contract(report_scope, view.extra))
    if body.get('code') == CURSOR_EXPIRED_CODE:
        return cursor_expired_response(event)
    return success_response(snapshot_scope_contract({**body, **view.extra}, report_scope, artifacts), event)


__all__ = ['LargeScopeView', 'live_lists_page', 'live_scope_contract', 'serve_large_scope', 'snapshot_scope_contract']
