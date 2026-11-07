"""DataForSEO live Lighthouse: one billed audit of one URL on one device.

``POST /v3/on_page/lighthouse/live/json`` with ``[{url, for_mobile, categories}]`` returns the full Lighthouse
report of the page (1 to 10 MB). DataForSEO bills the call when it runs it, so it is posted once and never
retried: a 5xx or a timeout does not prove the run was not charged. The call takes 20 to 60 seconds, longer
than the API allows, so it only runs inside a job step (``lambda/seo-jobs/jobs_performance.py``).

A billed answer that cannot be read (no report, or a report without any category score) raises
``ChargedReportError`` carrying its cost, so the run records what was paid for.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from shared.dataforseo_client import post_live
from shared.lighthouse_report import EmptyReportError, report_summary

LIGHTHOUSE_PATH = '/v3/on_page/lighthouse/live/json'
LIGHTHOUSE_LIVE_USD = 0.005
"""Price of one live Lighthouse run (one URL, one device, all four categories)."""
REQUEST_TIMEOUT_S = 90.0
"""A run usually answers within 60 s; the margin covers reading the multi-megabyte body."""
REQUEST_CATEGORIES = ('performance', 'accessibility', 'best_practices', 'seo')
DEVICES = ('mobile', 'desktop')

Device = Literal['mobile', 'desktop']


class ChargedReportError(Exception):
    """DataForSEO billed the run but its answer holds no usable report."""

    def __init__(self, message: str, cost_usd: float) -> None:
        super().__init__(message)
        self.cost_usd = cost_usd


@dataclass(frozen=True)
class LighthouseRun:
    """One measured page: its compact summary, the full report and what it cost."""

    summary: dict[str, Any]
    report: dict[str, Any]
    task_id: str | None
    cost_usd: float


def lighthouse_task(url: str, device: Device) -> dict[str, Any]:
    return {'url': url, 'for_mobile': device == 'mobile', 'categories': list(REQUEST_CATEGORIES)}


def run_lighthouse(url: str, device: Device) -> LighthouseRun:
    """Measure ``url`` on ``device``; raises ``DataForSeoError`` (refused or failed call) or ``ChargedReportError``."""
    answer = post_live(LIGHTHOUSE_PATH, lighthouse_task(url, device), idempotent=False, timeout_s=REQUEST_TIMEOUT_S)
    report = answer.result[0] if answer.result and isinstance(answer.result[0], dict) else None
    if report is None:
        raise ChargedReportError('DataForSEO returned no Lighthouse report', answer.cost_usd)
    try:
        summary = report_summary(report, url)
    except EmptyReportError as error:
        raise ChargedReportError(str(error), answer.cost_usd) from error
    task_id = answer.task.get('id')
    return LighthouseRun(summary=summary, report=report, task_id=task_id if isinstance(task_id, str) else None,
                         cost_usd=answer.cost_usd)
