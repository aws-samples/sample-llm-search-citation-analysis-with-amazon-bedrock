"""Lighthouse reports and run stores shared by the page performance suites.

The measured site is the example brand's ``www.example.com``; no test reaches DataForSEO, S3, Step Functions
or a search engine.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import pytest

from shared import lighthouse_runs
from testing.local_seo_fixtures import MemoryCache

PAGE = 'https://www.example.com/'


def failing_audit(audit_id: str, *, score: float | None = 0.4, mode: str = 'binary', savings_ms: float | None = None,
                  savings_bytes: float | None = None) -> dict[str, Any]:
    """One raw Lighthouse audit (title ``Fix <id>``)."""
    details: dict[str, Any] = {}
    if savings_ms is not None:
        details['overallSavingsMs'] = savings_ms
    if savings_bytes is not None:
        details['overallSavingsBytes'] = savings_bytes
    return {'id': audit_id, 'title': f'Fix {audit_id}', 'description': f'Why {audit_id} matters.', 'score': score,
            'scoreDisplayMode': mode, 'displayValue': '1.2 s', 'details': details}


def metric_audit(value: float) -> dict[str, Any]:
    return {'score': 0.8, 'scoreDisplayMode': 'numeric', 'numericValue': value}


def lighthouse_report(*, scores: Mapping[str, float | None] | None = None,
                      audits: Sequence[dict[str, Any]] = (), refs: Mapping[str, Sequence[str]] | None = None,
                      final_url: str = PAGE) -> dict[str, Any]:
    """``result[0]`` of a live Lighthouse task: categories with scores and audit refs, audits with metrics."""
    chosen = {'performance': 0.91, 'accessibility': 0.88, 'best-practices': 0.75, 'seo': 1.0,
              **(scores or {})}
    audit_ids = [audit['id'] for audit in audits]
    category_refs = refs or {'performance': audit_ids}
    categories = {
        key: {'score': score, 'auditRefs': [{'id': audit_id} for audit_id in category_refs.get(key, [])]}
        for key, score in chosen.items()
    }
    raw_audits: dict[str, Any] = {
        'largest-contentful-paint': metric_audit(2100.0),
        'cumulative-layout-shift': metric_audit(0.05),
        'server-response-time': metric_audit(420.0),
        'first-contentful-paint': metric_audit(900.0),
        'total-blocking-time': metric_audit(150.0),
        'speed-index': metric_audit(1800.0),
        **{audit['id']: audit for audit in audits},
    }
    return {'requestedUrl': PAGE, 'finalUrl': final_url, 'lighthouseVersion': '12.6.0',
            'categories': categories, 'audits': raw_audits}


def install_run_cache(monkeypatch: pytest.MonkeyPatch) -> MemoryCache:
    """Point the Lighthouse run store at a fresh ``MemoryCache``."""
    memory = MemoryCache()
    monkeypatch.setattr(lighthouse_runs, 'get_cached', memory.get)
    monkeypatch.setattr(lighthouse_runs, 'put_cached', memory.put)
    return memory


def stored_run(memory: MemoryCache, targets: Sequence[dict[str, str]], **fields: Any) -> dict[str, Any]:
    """A run saved in ``memory`` with ``fields`` replacing the new run's defaults."""
    run = {**lighthouse_runs.new_run('batch', targets, 'admin'), **fields}
    memory.put(lighthouse_runs.RUN_NAMESPACE, lighthouse_runs.RUN_VERSION, {'run_id': run['run_id']}, run, 0)
    return run


def saved_run(memory: MemoryCache, run_id: str) -> dict[str, Any]:
    return memory.get(lighthouse_runs.RUN_NAMESPACE, lighthouse_runs.RUN_VERSION, {'run_id': run_id})
