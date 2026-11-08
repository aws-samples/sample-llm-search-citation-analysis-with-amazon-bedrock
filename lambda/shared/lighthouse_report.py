"""The compact summary of one Lighthouse report: four category scores, the page-speed metrics and the top failed audits.

A raw Lighthouse report is 1 to 10 MB; the summary is a few kilobytes and is what the dashboard reads. The full
report is kept separately (``shared.lighthouse_runs``).

* **Scores**: ``round(score * 100)`` of the ``performance``, ``accessibility``, ``best-practices`` and ``seo``
  categories (the request names the third one ``best_practices``; the report keys it ``best-practices``).
* **Metrics**: ``numericValue`` of the metric audits (milliseconds, CLS unitless). A lab run has no user
  interaction, so ``interaction-to-next-paint`` is often absent and reads ``None``.
* **Failed audits**: the audits each category references, skipping metric audits (``numeric``), diagnostic
  tables and passes (no score, a score of 90 or more, or a mode that is not scored). Severity is ``critical``
  when the estimated saving is at least 300 ms or 150,000 bytes or a graded audit scores below 50, ``warning``
  from 100 ms / 50,000 bytes or below 90, else ``info``. A pass/fail (``binary``) audit always scores 0 when it
  fails, so its score alone makes it a ``warning``, never ``critical``. They are ordered by severity, then by saving, and the
  first ``MAX_FAILED_AUDITS`` are kept.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

#: Report category keys and the snake_case names the summary uses.
CATEGORIES: tuple[tuple[str, str], ...] = (
    ('performance', 'performance'),
    ('accessibility', 'accessibility'),
    ('best-practices', 'best_practices'),
    ('seo', 'seo'),
)

#: Summary metric name -> audit id.
METRIC_AUDITS: tuple[tuple[str, str], ...] = (
    ('lcp_ms', 'largest-contentful-paint'),
    ('cls', 'cumulative-layout-shift'),
    ('inp_ms', 'interaction-to-next-paint'),
    ('ttfb_ms', 'server-response-time'),
    ('fcp_ms', 'first-contentful-paint'),
    ('tbt_ms', 'total-blocking-time'),
    ('speed_index_ms', 'speed-index'),
)

#: Audits that are tables of facts about the page, not checks it can fail.
DIAGNOSTIC_AUDITS = frozenset({
    'largest-contentful-paint-element', 'layout-shifts', 'diagnostics', 'metrics', 'network-requests',
    'network-rtt', 'network-server-latency', 'main-thread-tasks', 'screenshot-thumbnails', 'final-screenshot',
    'script-treemap-data', 'resource-summary',
})
UNSCORED_MODES = frozenset({'notApplicable', 'informative', 'manual', 'error'})
PASS_SCORE = 90
MAX_FAILED_AUDITS = 10
MAX_DESCRIPTION_CHARS = 400
_SEVERITY_ORDER = {'critical': 0, 'warning': 1, 'info': 2}


class EmptyReportError(ValueError):
    """The report carries no category score: nothing was measured (the call is still billed)."""


def _record(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


def score_percent(score: object) -> int | None:
    """A 0..1 Lighthouse score as a 0..100 integer, or ``None`` when there is none."""
    value = _number(score)
    return None if value is None else round(value * 100)


def _text(value: object, limit: int | None = None) -> str | None:
    if not isinstance(value, str):
        return None
    return value if limit is None else value[:limit]


def category_scores(categories: Mapping[str, Any]) -> dict[str, int | None]:
    return {name: score_percent(_record(categories.get(key)).get('score')) for key, name in CATEGORIES}


def metrics(audits: Mapping[str, Any]) -> dict[str, float | None]:
    return {name: _number(_record(audits.get(audit_id)).get('numericValue')) for name, audit_id in METRIC_AUDITS}


def severity(score: int | None, savings_ms: float | None, savings_bytes: float | None, *, binary: bool = False) -> str:
    ms, size = savings_ms or 0.0, savings_bytes or 0.0
    if ms >= 300 or size >= 150_000 or (not binary and score is not None and score < 50):
        return 'critical'
    if ms >= 100 or size >= 50_000 or (score is not None and score < PASS_SCORE):
        return 'warning'
    return 'info'


def _failed_audit(category: str, audit_id: str, audit: Mapping[str, Any]) -> dict[str, Any] | None:
    mode = audit.get('scoreDisplayMode')
    score = score_percent(audit.get('score'))
    if mode == 'numeric' or audit_id in DIAGNOSTIC_AUDITS or mode in UNSCORED_MODES:
        return None
    if score is None or score >= PASS_SCORE:
        return None
    details = _record(audit.get('details'))
    savings_ms = _number(details.get('overallSavingsMs'))
    savings_bytes = _number(details.get('overallSavingsBytes'))
    return {
        'id': audit_id,
        'category': category,
        'title': _text(audit.get('title')) or audit_id,
        'description': _text(audit.get('description'), MAX_DESCRIPTION_CHARS) or '',
        'display_value': _text(audit.get('displayValue')),
        'score': score,
        'savings_ms': savings_ms,
        'savings_bytes': savings_bytes,
        'severity': severity(score, savings_ms, savings_bytes, binary=mode == 'binary'),
    }


def _sort_key(audit: Mapping[str, Any]) -> tuple[int, float, float]:
    return (_SEVERITY_ORDER[audit['severity']], -(audit['savings_ms'] or 0.0), -(audit['savings_bytes'] or 0.0))


def failed_audits(audits: Mapping[str, Any], categories: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The worst ``MAX_FAILED_AUDITS`` failed audits; an audit two categories share is listed once."""
    found: dict[str, dict[str, Any]] = {}
    for key, name in CATEGORIES:
        refs = _record(categories.get(key)).get('auditRefs')
        for ref in refs if isinstance(refs, list) else []:
            audit_id = _record(ref).get('id')
            if not isinstance(audit_id, str) or audit_id in found:
                continue
            failed = _failed_audit(name, audit_id, _record(audits.get(audit_id)))
            if failed is not None:
                found[audit_id] = failed
    return sorted(found.values(), key=_sort_key)[:MAX_FAILED_AUDITS]


def report_summary(report: Mapping[str, Any], url: str) -> dict[str, Any]:
    """The summary of ``report`` (``result[0]`` of the live Lighthouse task); raises ``EmptyReportError``."""
    categories = _record(report.get('categories'))
    audits = _record(report.get('audits'))
    scores = category_scores(categories)
    final_url = _text(report.get('finalUrl')) or _text(report.get('finalDisplayedUrl')) or url
    if all(score is None for score in scores.values()):
        raise EmptyReportError(f'Lighthouse returned no category scores for {final_url}')
    return {
        'final_url': final_url,
        'lighthouse_version': _text(report.get('lighthouseVersion')),
        'scores': scores,
        'metrics': metrics(audits),
        'failed_audits': failed_audits(audits, categories),
    }
