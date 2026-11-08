"""Support for the KPI handlers' routing tests: scopes of many keywords, and the S1 snapshot functions replaced by fakes."""

from __future__ import annotations

import contextlib
from collections.abc import Generator, Iterable, Mapping
from typing import Any
from unittest.mock import MagicMock, patch

from shared import scope_snapshot_serve
from shared.snapshot_artifacts import computing_response
from testing.search_results_fixtures import search_result_row
from testing.sentiment_examples_fixtures import OLDER_RUN, RUN, stored_brand

#: The id and start of the view job the fake ``view_job_response`` answers.
JOB_ID = 'job-kpi-0001'
JOB_STARTED = '2026-10-05T07:20:11Z'

_ENGINES = ('openai', 'perplexity', 'gemini', 'claude')


def scope_keywords(count: int) -> list[str]:
    """``count`` keyword texts in scope order."""
    return sorted((f'hotel en ciudad {index:04}' for index in range(count)), key=str.casefold)


def keyword_items(keywords: Iterable[str]) -> list[dict[str, Any]]:
    """Active Keywords rows of ``keywords``."""
    return [{'id': f'k{index}', 'keyword': keyword, 'status': 'active'} for index, keyword in enumerate(keywords)]


def two_run_rows(keywords: Iterable[str]) -> dict[str, list[dict[str, Any]]]:
    """Each keyword's answers in ``RUN`` and ``OLDER_RUN``: the first party ranks by keyword, a rival sometimes ahead."""
    rows: dict[str, list[dict[str, Any]]] = {}
    for index, keyword in enumerate(keywords):
        rows[keyword] = [
            search_result_row(
                keyword, engine, [
                    stored_brand('Hotel Sol', 'positive', rank=1 + (index + offset) % 3),
                    stored_brand(f'Rival {index % 7}', 'neutral', classification='competitor', rank=2),
                ],
                timestamp=timestamp, status='success', citations=[f'https://site{index % 5}.com/a', 'https://hotel-sol.com/'],
            )
            for offset, timestamp in enumerate((RUN, OLDER_RUN))
            for engine in _ENGINES[:1 + index % 4]
        ]
    return rows


def fake_view_job() -> MagicMock:
    """A ``view_job_response`` that answers 202 computing."""
    return MagicMock(side_effect=lambda _route, _params, _report_scope, event: computing_response(JOB_ID, JOB_STARTED, event))


@contextlib.contextmanager
def snapshot_store(artifacts: Any | None, view_job: MagicMock | None = None) -> Generator[MagicMock]:
    """``open_snapshot`` answering ``artifacts`` (``None``: no build) and a view job that is not ready: the fake ``view_job_response`` yielded answers for it."""
    job = view_job or fake_view_job()
    with (
        patch.object(scope_snapshot_serve, 'open_snapshot', return_value=artifacts),
        patch.object(scope_snapshot_serve, 'view_job_response', job),
        patch.object(scope_snapshot_serve, 'view_job_artifacts', side_effect=lambda *args: (None, job(*args))),
    ):
        yield job


def without(body: Mapping[str, Any], *names: str) -> dict[str, Any]:
    """``body`` without the fields ``names``."""
    return {name: value for name, value in body.items() if name not in names}
