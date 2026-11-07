"""The live Lighthouse call (``shared.dataforseo_lighthouse``): one billed post, never retried."""

from __future__ import annotations

import pytest

from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_lighthouse import LIGHTHOUSE_PATH, ChargedReportError, run_lighthouse
from testing.dataforseo_fixtures import install_transport, ok_envelope
from testing.performance_fixtures import PAGE, lighthouse_report


@pytest.fixture
def answered(monkeypatch):
    """A transport that answers one complete report billed at the live price."""
    return install_transport(monkeypatch, ok_envelope(result=[lighthouse_report()], cost=0.005))


@pytest.mark.parametrize(('device', 'for_mobile'), [('mobile', True), ('desktop', False)])
def test_posts_the_url_device_and_four_categories(answered, device, for_mobile):
    run_lighthouse(PAGE, device)

    assert answered.calls[0].task == {
        'url': PAGE, 'for_mobile': for_mobile, 'categories': ['performance', 'accessibility', 'best_practices', 'seo'],
    }


def test_calls_the_live_lighthouse_endpoint(answered):
    run_lighthouse(PAGE, 'mobile')

    assert answered.calls[0].url.endswith(LIGHTHOUSE_PATH)


def test_returns_the_summary_the_full_report_and_the_cost(monkeypatch):
    report = lighthouse_report()
    install_transport(monkeypatch, ok_envelope(result=[report], cost=0.005))

    measured = run_lighthouse(PAGE, 'mobile')

    assert (measured.summary['scores']['seo'], measured.report, measured.cost_usd, measured.task_id) == (
        100, report, 0.005, 'task-1')


def test_never_retries_a_server_error(monkeypatch):
    transport = install_transport(monkeypatch, (502, 'Bad Gateway'), ok_envelope(result=[lighthouse_report()]))

    with pytest.raises(DataForSeoError):
        run_lighthouse(PAGE, 'mobile')

    assert len(transport.calls) == 1


def test_a_billed_answer_without_scores_raises_with_its_cost(monkeypatch):
    empty = lighthouse_report(scores={'performance': None, 'accessibility': None, 'best-practices': None, 'seo': None})
    install_transport(monkeypatch, ok_envelope(result=[empty], cost=0.005))

    with pytest.raises(ChargedReportError) as raised:
        run_lighthouse(PAGE, 'mobile')

    assert raised.value.cost_usd == 0.005


def test_a_billed_answer_without_a_report_raises_with_its_cost(monkeypatch):
    install_transport(monkeypatch, ok_envelope(result=[], cost=0.005))

    with pytest.raises(ChargedReportError, match='no Lighthouse report'):
        run_lighthouse(PAGE, 'mobile')
