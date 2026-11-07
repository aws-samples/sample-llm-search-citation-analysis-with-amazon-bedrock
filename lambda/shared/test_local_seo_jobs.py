"""Local SEO job store: receipts and the API view (``shared.local_seo_jobs``)."""

from __future__ import annotations

import pytest

from shared import local_seo_jobs as jobs
from shared.dataforseo_local_serp import BusinessTarget
from testing.local_seo_fixtures import (
    CAFE_CID,
    GRID_REQUEST,
    REVIEWS_REQUEST,
    install_memory_cache,
    receipted_job,
    stored_job,
)

POINTS = {'0': {'status': 'ready', 'results': [{'rank_absolute': 3, 'title': 'Acme Cafe', 'cid': CAFE_CID}]},
          '1': {'status': 'failed', 'message': 'Task failed'}}
OTHER_TARGET = {'cid': None, 'place_id': None, 'domains': ['example.com'], 'name': None}


@pytest.fixture
def memory(monkeypatch):
    return install_memory_cache(monkeypatch)


@pytest.fixture
def grid_view(memory):
    """``grid_view(status, target=None)``: the view of a grid job with ``POINTS`` collected."""
    def view(status, target=None):
        return jobs.job_view(stored_job(memory, 'grid', GRID_REQUEST, status=status, results={'points': POINTS}), target)

    return view


class TestReceipts:
    def test_finds_the_job_an_equal_request_started(self, memory):
        job = receipted_job(memory, 'reviews', REVIEWS_REQUEST, 'collecting')

        assert (jobs.receipt_job('reviews', dict(REVIEWS_REQUEST)) or {}).get('job_id') == job['job_id']

    def test_ignores_the_receipt_of_a_failed_job(self, memory):
        receipted_job(memory, 'reviews', REVIEWS_REQUEST, 'failed')

        assert jobs.receipt_job('reviews', REVIEWS_REQUEST) is None

    def test_reuses_a_grid_receipt_for_a_different_target(self, memory):
        job = receipted_job(memory, 'grid', GRID_REQUEST, 'completed')

        assert (jobs.receipt_job('grid', {**GRID_REQUEST, 'target': OTHER_TARGET}) or {}).get('job_id') == job['job_id']

    def test_does_not_reuse_a_grid_receipt_for_another_spacing(self, memory):
        receipted_job(memory, 'grid', GRID_REQUEST, 'completed')

        assert jobs.receipt_job('grid', {**GRID_REQUEST, 'spacing_km': 1.0}) is None


class TestGridView:
    def test_ranks_collected_points_for_the_started_target(self, grid_view):
        points = grid_view('collecting')['result']['points']

        assert [(point['status'], point['rank']) for point in points[:3]] == [('ready', 3), ('failed', None), ('pending', None)]

    def test_ranks_for_a_target_given_at_read_time(self, grid_view):
        assert grid_view('completed', BusinessTarget(name='nobody'))['result']['points'][0]['rank'] is None

    def test_counts_uncollected_points_of_a_timed_out_grid_as_failed(self, grid_view):
        assert grid_view('timed_out')['result']['summary']['points_failed'] == 8

    def test_reports_grid_progress_as_collected_points(self, grid_view):
        assert grid_view('collecting')['progress'] == {'ready': 2, 'total': 9}


def test_hides_the_target_from_the_view_request(memory):
    job = stored_job(memory, 'grid', GRID_REQUEST)

    assert 'target' not in jobs.job_view(job)['request']


def test_has_no_result_for_a_reviews_job_still_collecting(memory):
    job = stored_job(memory, 'reviews', REVIEWS_REQUEST, status='collecting')

    assert jobs.job_view(job)['result'] is None
