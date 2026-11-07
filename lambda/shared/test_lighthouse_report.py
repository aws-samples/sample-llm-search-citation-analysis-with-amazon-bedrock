"""The compact Lighthouse summary (``shared.lighthouse_report``): scores, metrics, failed audits, severity."""

from __future__ import annotations

import pytest

from shared.lighthouse_report import EmptyReportError, report_summary, score_percent, severity
from testing.performance_fixtures import PAGE, failing_audit, lighthouse_report


def _failed_ids(report: dict) -> list[str]:
    return [audit['id'] for audit in report_summary(report, PAGE)['failed_audits']]


def test_scores_read_as_rounded_percentages_with_best_practices_in_snake_case():
    summary = report_summary(lighthouse_report(scores={'performance': 0.456}), PAGE)

    assert summary['scores'] == {'performance': 46, 'accessibility': 88, 'best_practices': 75, 'seo': 100}


def test_metrics_read_the_numeric_values_and_leave_a_missing_inp_none():
    metrics = report_summary(lighthouse_report(), PAGE)['metrics']

    assert metrics == {'lcp_ms': 2100.0, 'cls': 0.05, 'inp_ms': None, 'ttfb_ms': 420.0, 'fcp_ms': 900.0,
                       'tbt_ms': 150.0, 'speed_index_ms': 1800.0}


def test_raises_when_no_category_has_a_score():
    report = lighthouse_report(scores={'performance': None, 'accessibility': None, 'best-practices': None, 'seo': None})

    with pytest.raises(EmptyReportError, match='no category scores'):
        report_summary(report, PAGE)


def test_keeps_a_single_missing_category_as_none():
    assert report_summary(lighthouse_report(scores={'seo': None}), PAGE)['scores']['seo'] is None


@pytest.mark.parametrize('audit', [
    failing_audit('passing', score=0.95),
    failing_audit('no-score', score=None),
    failing_audit('not-applicable', mode='notApplicable'),
    failing_audit('informative', mode='informative'),
    failing_audit('manual', mode='manual'),
    failing_audit('errored', mode='error'),
    failing_audit('metric', mode='numeric'),
    failing_audit('network-requests'),
])
def test_leaves_out_passes_unscored_metric_and_diagnostic_audits(audit):
    assert _failed_ids(lighthouse_report(audits=[audit])) == []


def test_lists_a_failed_audit_with_its_category_and_savings():
    report = lighthouse_report(audits=[failing_audit('render-blocking', score=0.5, savings_ms=350.0)])

    assert report_summary(report, PAGE)['failed_audits'][0] == {
        'id': 'render-blocking', 'category': 'performance', 'title': 'Fix render-blocking',
        'description': 'Why render-blocking matters.', 'display_value': '1.2 s', 'score': 50, 'savings_ms': 350.0,
        'savings_bytes': None, 'severity': 'critical',
    }


def test_orders_failed_audits_by_severity_then_by_time_saved():
    report = lighthouse_report(audits=[
        failing_audit('minor', score=0.85),
        failing_audit('small-saving', score=0.6, savings_ms=320.0),
        failing_audit('big-saving', score=0.6, savings_ms=900.0),
    ])

    assert _failed_ids(report) == ['big-saving', 'small-saving', 'minor']


def test_keeps_the_ten_worst_failed_audits():
    report = lighthouse_report(audits=[failing_audit(f'audit-{index}', savings_ms=float(index)) for index in range(12)])

    assert len(_failed_ids(report)) == 10


def test_lists_an_audit_two_categories_reference_once():
    audit = failing_audit('shared-audit')
    report = lighthouse_report(audits=[audit], refs={'performance': ['shared-audit'], 'seo': ['shared-audit']})

    assert _failed_ids(report) == ['shared-audit']


@pytest.mark.parametrize(('score', 'ms', 'size', 'expected'), [
    (85, 300.0, None, 'critical'),
    (85, None, 150_000.0, 'critical'),
    (49, None, None, 'critical'),
    (85, 100.0, None, 'warning'),
    (95, None, 50_000.0, 'warning'),
    (89, None, None, 'warning'),
    (90, 99.0, 49_999.0, 'info'),
])
def test_severity_follows_the_saving_and_score_thresholds(score, ms, size, expected):
    assert severity(score, ms, size) == expected


@pytest.mark.parametrize(('ms', 'expected'), [(None, 'warning'), (300.0, 'critical')])
def test_failed_pass_fail_audit_is_critical_only_for_a_large_saving(ms, expected):
    assert severity(0, ms, None, binary=True) == expected


def test_failed_binary_audit_without_saving_reads_as_a_warning():
    report = lighthouse_report(audits=[failing_audit('heading-order', score=0.0, mode='binary')])

    assert [audit['severity'] for audit in report_summary(report, PAGE)['failed_audits']] == ['warning']


@pytest.mark.parametrize(('raw', 'expected'), [(0.994, 99), (0, 0), (None, None), (True, None), (float('nan'), None)])
def test_score_percent_reads_only_finite_numbers(raw, expected):
    assert score_percent(raw) == expected
