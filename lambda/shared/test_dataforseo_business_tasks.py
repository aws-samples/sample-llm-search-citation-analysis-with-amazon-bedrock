"""Queued reviews and updates tasks (``shared.dataforseo_business_tasks``)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from shared import dataforseo_business_tasks as tasks
from shared import dataforseo_tasks
from shared.dataforseo_business import BusinessIdentifier, Near
from shared.dataforseo_client import DataForSeoError
from testing.local_seo_fixtures import CAFE_CID, posted, raw_review, reviews_task_result

TASK = tasks.BusinessTask(identifier=BusinessIdentifier(cid=CAFE_CID), near=None, location_code=2840,
                          language_code='en', depth=20)


@pytest.fixture
def post_tasks(monkeypatch):
    stub = MagicMock(return_value=posted({'business': 'task-9'}, cost=0.00375))
    monkeypatch.setattr(dataforseo_tasks, 'post_tasks', stub)
    return stub


class TestPost:
    def test_posts_reviews_at_high_priority_with_the_pingback_url(self, post_tasks):
        tasks.post_reviews(TASK, pingback_url='https://cb.example/?gate=g&id=$id')

        assert post_tasks.call_args.kwargs == {'priority': 2, 'pingback_url': 'https://cb.example/?gate=g&id=$id'}

    def test_sends_the_native_cid_field_for_reviews(self, post_tasks):
        tasks.post_reviews(TASK, 'lowest_rating')

        assert post_tasks.call_args.args[1] == [{'cid': CAFE_CID, 'location_code': 2840, 'language_code': 'en',
                                                 'depth': 20, 'sort_by': 'lowest_rating', 'tag': 'business'}]

    def test_sends_the_prefixed_keyword_and_coordinate_for_updates(self, post_tasks):
        near_task = tasks.BusinessTask(identifier=BusinessIdentifier(place_id='p-1'), near=Near(1, 2, 1),
                                       location_code=2840, language_code='en', depth=10)

        tasks.post_updates(near_task)

        assert post_tasks.call_args.args[1][0]['keyword'] == 'place_id:p-1'

    def test_answers_the_task_id_and_cost(self, post_tasks):
        assert tasks.post_reviews(TASK) == ('task-9', 0.00375)

    def test_raises_with_the_billed_cost_when_the_task_is_refused(self, monkeypatch):
        monkeypatch.setattr(dataforseo_tasks, 'post_tasks',
                            MagicMock(return_value=posted({}, {'business': 'Invalid Field'}, cost=0.003)))

        with pytest.raises(DataForSeoError, match='Invalid Field') as raised:
            tasks.post_reviews(TASK)

        assert raised.value.cost_usd == 0.003


class TestReviewsResult:
    def test_counts_the_star_histogram_of_the_fetched_reviews(self):
        result = tasks.reviews_result(reviews_task_result(raw_review(5), raw_review(5), raw_review(2)))

        assert result['summary']['histogram'] == {'1': 0, '2': 1, '3': 0, '4': 0, '5': 2}

    def test_reports_the_share_of_reviews_the_owner_answered(self):
        result = tasks.reviews_result(reviews_task_result(raw_review(5, owner_answer='Thanks!'), raw_review(4)))

        assert result['summary']['owner_response_rate'] == 0.5

    def test_has_no_owner_response_rate_without_reviews(self):
        assert tasks.reviews_result(reviews_task_result())['summary']['owner_response_rate'] is None

    def test_reads_the_business_totals_of_the_result(self):
        assert tasks.reviews_result(reviews_task_result())['totals'] == {
            'title': 'Acme Cafe', 'reviews_count': 120, 'rating': 4.6, 'cid': CAFE_CID, 'place_id': 'ChIJexample-cafe',
        }

    def test_drops_review_fields_outside_the_allowlist(self):
        review = tasks.reviews_result(reviews_task_result(raw_review(3)))['reviews'][0]

        assert 'profile_image_url' not in review


def test_reads_update_posts_with_their_links():
    result = tasks.updates_result({'items': [{'author': 'Acme Cafe', 'post_text': 'New menu', 'links': [
        {'title': 'Order', 'url': 'https://example.com/order', 'type': 'link'}]}]})

    assert result['updates'][0]['links'] == [{'title': 'Order', 'url': 'https://example.com/order'}]


def test_collects_reviews_from_the_free_task_get_path(monkeypatch):
    get_task = MagicMock()
    monkeypatch.setattr(dataforseo_tasks, 'get_task', get_task)

    tasks.collect_reviews('task-9')

    get_task.assert_called_once_with('/v3/business_data/google/reviews/task_get', 'task-9')
