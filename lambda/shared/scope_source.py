"""
Where a scoped view is computed: live for this request, or from the scope snapshot (design 2.45.0 §2).

One rule for every route, so every view of a scope agrees on where its
figures come from::

    estimated_rows = keywords x (max(1, enabled personas) x engines + plain engines) x runs_needed

(a plain engine, Google AI Overviews, answers each keyword once whatever the personas)

- at most ``LIVE_ROWS_BUDGET`` rows, and always for one ``keyword`` or a
  ``keywords`` (``keyword_ids``, at most 100) scope: **live**, exact and
  complete at request time;
- otherwise **snapshot**: the caller serves the stored build (fresh, or stale
  with a rebuild requested) or, when the build does not hold the view,
  answers 202 from a view job.

The rule is pure; reading the snapshot is ``shared.scope_snapshot_serve``.
"""

from __future__ import annotations

from typing import Final

from shared.config import LLM_PROVIDERS, PLAIN_KEYWORD_PROVIDERS
from shared.scope_params import ReportScope
from shared.snapshot_artifacts import SOURCE_LIVE, SOURCE_SNAPSHOT, ScopeSource

#: The AI engines a run asks once per persona (an upper bound: an engine an administrator disabled
#: only makes the estimate safer), and those it asks once per keyword (``PLAIN_KEYWORD_PROVIDERS``).
PERSONA_ENGINES: Final = sum(provider not in PLAIN_KEYWORD_PROVIDERS for provider in LLM_PROVIDERS)
PLAIN_ENGINES: Final = len(PLAIN_KEYWORD_PROVIDERS)

#: Rows a live request may read: about 100 keywords x 40 answers (10 personas x 4 engines) x 2 runs; the
#: Google AI Overviews answer of each keyword (``PLAIN_ENGINES``) counts on top, so 97 such keywords go live.
LIVE_ROWS_BUDGET: Final = 8_000

#: Runs a latest-run view reads per keyword: the latest and the previous one (``change``).
LATEST_RUNS: Final = 2

#: Scope kinds (``shared.scope_params.ReportScope.kind``) that always go live.
_ALWAYS_LIVE_KINDS = frozenset({'keyword', 'keywords'})


def estimated_rows(keywords: int, personas: int, engines: int, runs_needed: int = LATEST_RUNS, plain_engines: int = 0) -> int:
    """SearchResults rows a live computation of the scope reads (no persona enabled still asks each engine once)."""
    if min(keywords, personas, engines, runs_needed, plain_engines) < 0:
        raise ValueError('scope sizes are never negative')
    return keywords * (max(1, personas) * engines + plain_engines) * runs_needed


def route_scope(
    kind: str, keywords: int, *, personas: int, engines: int, runs_needed: int = LATEST_RUNS, plain_engines: int = 0,
) -> ScopeSource:
    """``'live'`` or ``'snapshot'`` for a scope of ``kind`` covering ``keywords`` active keywords."""
    rows = estimated_rows(keywords, personas, engines, runs_needed, plain_engines)
    if kind in _ALWAYS_LIVE_KINDS or rows <= LIVE_ROWS_BUDGET:
        return SOURCE_LIVE
    return SOURCE_SNAPSHOT


def route_report_scope(report_scope: ReportScope, *, personas: int, engines: int, runs_needed: int = LATEST_RUNS) -> ScopeSource:
    """``route_scope`` for a resolved request scope (its kind and keyword count)."""
    return route_scope(report_scope.kind, len(report_scope.keywords), personas=personas, engines=engines, runs_needed=runs_needed)


__all__ = ['LATEST_RUNS', 'LIVE_ROWS_BUDGET', 'PERSONA_ENGINES', 'PLAIN_ENGINES', 'estimated_rows', 'route_report_scope', 'route_scope']
