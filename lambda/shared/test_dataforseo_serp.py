"""Tests for shared.dataforseo_serp: the SEO pages' organic SERP panel.

``post_live`` and ``escape_keyword`` are replaced (``recording_post_live_fixture``); no network. The Google AI
Overviews client has its own tests next to it (``search/test_google_ai_overview_search.py``).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from shared.dataforseo_serp import ORGANIC_LIVE_PATH, OrganicItem, organic_serp
from shared.kpi_engine import answers_from_rows, brand_kpis
from testing.dataforseo_endpoint_fixtures import (
    LABS_US,
    TRACKER_OVERVIEW,
    FakePostLive,
    organic_item,
    recording_post_live_fixture,
    serp_result,
    task_result,
)

fake = recording_post_live_fixture()


@pytest.fixture
def organic_task(fake: FakePostLive) -> Callable[[int | None], dict[str, Any]]:
    """Runs ``organic_serp`` (default depth when ``None``) on an empty page; returns the task sent."""
    def run(depth: int | None) -> dict[str, Any]:
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result([])])}
        if depth is None:
            organic_serp('example keyword', LABS_US)
        else:
            organic_serp('example keyword', LABS_US, depth=depth)
        return fake.calls[0].task
    return run


class TestOrganicSerp:
    def test_sends_the_exact_body_with_default_depth_twenty(self, organic_task):
        assert organic_task(None) == {
            'keyword': 'example keyword', 'location_code': 2840, 'language_code': 'en',
            'device': 'desktop', 'os': 'windows', 'depth': 20,
        }

    @pytest.mark.parametrize(('depth', 'sent'), [(5, 10), (50, 50), (150, 100)])
    def test_clamps_depth_between_ten_and_one_hundred(self, organic_task, depth, sent):
        assert organic_task(depth)['depth'] == sent

    def test_treats_no_search_results_as_empty_through_the_client(self, fake):
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([], cost=0.0035, no_results=True)}

        snapshot = organic_serp('example keyword', LABS_US)

        assert fake.calls[0].options['treat_no_results_as_empty'] is True
        assert (snapshot.items, snapshot.item_types, snapshot.check_url, snapshot.cost_usd) == ((), (), None, 0.0035)

    def test_keeps_organic_items_ranked_by_rank_group_then_rank_absolute(self, fake):
        items = [TRACKER_OVERVIEW, organic_item(1, 'example.com', rank_absolute=3),
                 {'type': 'people_also_ask', 'rank_group': 1}, organic_item(None, 'example.org', rank_absolute=7)]
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result(items)])}

        snapshot = organic_serp('example keyword', LABS_US)

        assert snapshot.items == (
            OrganicItem(1, 3, 'https://example.com/page', 'example.com', 'example.com title', 'example.com description'),
            OrganicItem(7, 7, 'https://example.org/page', 'example.org', 'example.org title', 'example.org description'),
        )

    def test_lists_every_item_type_once_in_order_and_reads_check_url(self, fake):
        items = [organic_item(1, 'example.com'), TRACKER_OVERVIEW, organic_item(2, 'example.org')]
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result(items, check_url='https://www.google.com/x')])}

        snapshot = organic_serp('example keyword', LABS_US)

        assert (snapshot.item_types, snapshot.check_url) == (('organic', 'ai_overview'), 'https://www.google.com/x')


def test_excludes_no_answer_rows_from_every_kpi():
    answered = {'provider': 'openai', 'status': 'success', 'keyword': 'best tracker', 'brands': [], 'citations': []}
    no_answer = {**answered, 'status': 'no_answer', 'response': ''}

    with_no_answer = brand_kpis(answers_from_rows([answered, no_answer]))

    assert with_no_answer == brand_kpis(answers_from_rows([answered]))
