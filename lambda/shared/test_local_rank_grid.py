"""Local rank grid points, zoom, matching and summary (``shared.local_rank_grid``, ``shared.dataforseo_local_serp``)."""

from __future__ import annotations

import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared import dataforseo_local_serp as local_serp
from shared.local_rank_grid import GridPoint, grid_points, grid_summary, grid_zoom, point_result, unresolved_point

CID_TARGET = local_serp.BusinessTarget(cid='123')
POINT = GridPoint(index=0, row=0, col=0, latitude=40.0, longitude=-74.0)


class TestPoints:
    def test_lays_out_a_three_by_three_grid_north_row_first(self):
        coordinates = [local_serp.local_coordinate(point.latitude, point.longitude, 13) for point in grid_points(40, -74, 3, 2)]

        assert coordinates == [
            '40.0180874,-74.0234532,13z', '40.0180874,-74,13z', '40.0180874,-73.9765468,13z',
            '40,-74.0234532,13z', '40,-74,13z', '40,-73.9765468,13z',
            '39.9819126,-74.0234532,13z', '39.9819126,-74,13z', '39.9819126,-73.9765468,13z',
        ]

    def test_numbers_points_row_major(self):
        points = grid_points(40, -74, 5, 1)

        assert [(point.index, point.row, point.col) for point in points[5:7]] == [(5, 1, 0), (6, 1, 1)]

    def test_centres_a_seven_by_seven_grid_on_the_coordinate(self):
        centre = grid_points(10, 20, 7, 1)[24]

        assert (centre.latitude, centre.longitude) == (10, 20)

    @given(latitude=st.floats(min_value=-90, max_value=90), spacing=st.floats(min_value=0.25, max_value=10))
    def test_keeps_every_point_finite_at_any_latitude(self, latitude, spacing):
        assert all(math.isfinite(point.longitude) for point in grid_points(latitude, 0, 3, spacing))


class TestZoom:
    def test_derives_zoom_13_for_two_kilometres_at_latitude_40(self):
        assert grid_zoom(40, 2) == 13

    @pytest.mark.parametrize(('latitude', 'spacing', 'zoom'), [(0, 0.25, 16), (89.99, 10, 4), (0, 0.001, 18)])
    def test_clamps_zoom_between_4_and_18(self, latitude, spacing, zoom):
        assert grid_zoom(latitude, spacing) == zoom


class TestMatching:
    ITEMS = (
        {'rank_absolute': 1, 'title': 'Other Cafe', 'cid': '999', 'domain': 'www.example.com'},
        {'rank_absolute': 2, 'title': 'Acme Cafe', 'cid': '123', 'place_id': 'p1', 'domain': 'acme.example.org'},
    )

    def test_prefers_the_cid_over_a_name_that_matches_earlier(self):
        target = local_serp.BusinessTarget(cid='123', name='cafe')

        assert local_serp.match_business(self.ITEMS, target) == self.ITEMS[1]

    def test_matches_a_domain_ignoring_www_and_subdomains(self):
        target = local_serp.BusinessTarget(domains=('example.com',))

        assert local_serp.match_business(self.ITEMS, target) == self.ITEMS[0]

    def test_matches_a_name_case_insensitively_inside_the_title(self):
        assert local_serp.match_business(self.ITEMS, local_serp.BusinessTarget(name='ACME')) == self.ITEMS[1]

    def test_falls_back_to_the_place_id_when_the_cid_is_absent(self):
        target = local_serp.BusinessTarget(cid='000', place_id='p1')

        assert local_serp.match_business(self.ITEMS, target) == self.ITEMS[1]

    def test_ranks_by_rank_group_without_rank_absolute(self):
        assert local_serp.item_rank({'rank_group': 4}) == 4


class TestPointsAndSummary:
    def test_records_rank_count_and_top_result_of_a_collected_point(self):
        result = point_result(POINT, list(TestMatching.ITEMS), CID_TARGET)

        assert (result['rank'], result['results_count'], result['top_result']) == (2, 2, {'title': 'Other Cafe', 'cid': '999'})

    def test_summarises_found_points_and_the_first_matched_business(self):
        found = point_result(POINT, list(TestMatching.ITEMS), CID_TARGET)
        missing = point_result(POINT, [TestMatching.ITEMS[0]], CID_TARGET)
        failed = unresolved_point(POINT, 'failed', 'boom')

        summary = grid_summary([found, missing, failed])

        assert summary == {
            'points_total': 3, 'points_searched': 2, 'points_failed': 1, 'points_found': 1, 'average_rank': 2.0,
            'top3_count': 1, 'top10_count': 1, 'matched_business': {'title': 'Acme Cafe', 'cid': '123', 'place_id': 'p1'},
        }

    def test_has_no_average_rank_when_the_business_is_never_found(self):
        assert grid_summary([unresolved_point(POINT, 'pending')])['average_rank'] is None


class TestLocalSerpBodies:
    SEARCH = local_serp.LocalSearch(keyword='coffee', latitude=40, longitude=-74, language_code='en')

    def test_gives_maps_a_zoom_and_turns_place_cards_off(self):
        body = local_serp.local_body(self.SEARCH)

        assert (body['location_coordinate'], body['search_places'], body['os']) == ('40,-74,12z', False, 'android')

    def test_sends_local_finder_a_plain_coordinate_on_desktop_windows(self):
        search = local_serp.LocalSearch(keyword='coffee', latitude=40, longitude=-74, language_code='en',
                                        search_type='local_finder', device='desktop')

        assert local_serp.local_body(search) == {'keyword': 'coffee', 'location_coordinate': '40,-74', 'language_code': 'en',
                                                 'device': 'desktop', 'os': 'windows', 'depth': 20}

    def test_tags_each_grid_task_with_its_point_index(self):
        bodies = local_serp.grid_task_bodies('coffee', [(1, 2), (3, 4)], 13, 'mobile', 'en', 20)

        assert [(body['tag'], body['location_coordinate']) for body in bodies] == [('0', '1,2,13z'), ('1', '3,4,13z')]
