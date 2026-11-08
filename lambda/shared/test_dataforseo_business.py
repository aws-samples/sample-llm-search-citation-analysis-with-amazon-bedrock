"""Business listings, Google Business Profile and Q&A live calls (``shared.dataforseo_business``)."""

from __future__ import annotations

import pytest

from shared import dataforseo_business as business
from testing.dataforseo_fixtures import install_transport, ok_envelope, task_error_envelope
from testing.local_seo_fixtures import CAFE_CID, projected_business, raw_business

NEAR = business.Near(latitude=33.123456789, longitude=-84.987654321, radius_km=5)


class TestCoordinates:
    def test_rounds_to_seven_decimals_with_a_metre_radius_for_business_endpoints(self):
        assert business.business_coordinate(NEAR) == '33.1234568,-84.9876543,5000'

    @pytest.mark.parametrize(('radius_km', 'meters'), [(0.05, 200), (500, 199_999)])
    def test_clamps_the_metre_radius_to_what_business_endpoints_accept(self, radius_km, meters):
        near = business.Near(latitude=1, longitude=2, radius_km=radius_km)

        assert business.business_coordinate(near) == f'1,2,{meters}'

    @pytest.mark.parametrize(('radius_km', 'expected'), [(2.4, '1,2,2'), (0.3, '1,2,1')])
    def test_sends_whole_kilometres_of_at_least_one_to_listings(self, radius_km, expected):
        assert business.listings_coordinate(business.Near(latitude=1, longitude=2, radius_km=radius_km)) == expected

    def test_sends_the_coordinate_alone_when_there_is_one(self):
        assert business.business_location(NEAR, 2840) == {'location_coordinate': '33.1234568,-84.9876543,5000'}

    def test_sends_the_location_code_alone_without_a_coordinate(self):
        assert business.business_location(None, 2840) == {'location_code': 2840}


class TestIdentifier:
    @pytest.mark.parametrize('fields', [{}, {'name': 'Acme', 'cid': '1'}, {'cid': '1', 'place_id': 'p'}])
    def test_refuses_anything_but_exactly_one_identifier(self, fields):
        with pytest.raises(business.IdentifierError, match='exactly one'):
            business.BusinessIdentifier(**fields)

    @pytest.mark.parametrize(('fields', 'keyword'), [
        ({'cid': '42'}, 'cid:42'), ({'place_id': 'abc'}, 'place_id:abc'), ({'name': 'Acme + Co 100%'}, 'Acme %2B Co 100%25'),
    ])
    def test_prefixes_cid_and_place_id_keywords_and_escapes_names(self, fields, keyword):
        assert business.BusinessIdentifier(**fields).keyword == keyword


class TestListings:
    def test_joins_rating_and_review_filters_with_and(self):
        query = business.ListingsQuery(near=NEAR, min_rating=4, min_reviews=10)

        assert business.listings_body(query)['filters'] == [['rating.value', '>=', 4], 'and', ['rating.votes_count', '>=', 10]]

    def test_sends_a_single_filter_bare(self):
        assert business.listings_body(business.ListingsQuery(near=NEAR, min_rating=4))['filters'] == ['rating.value', '>=', 4]

    @pytest.mark.parametrize(('sort_by', 'order_by'), [('rating', ['rating.value,desc']), ('reviews', ['rating.votes_count,desc'])])
    def test_orders_by_rating_or_reviews(self, sort_by, order_by):
        assert business.listings_body(business.ListingsQuery(near=NEAR, sort_by=sort_by))['order_by'] == order_by

    def test_sends_no_ordering_for_relevance(self):
        assert 'order_by' not in business.listings_body(business.ListingsQuery(near=NEAR))

    def test_projects_listing_rows_to_the_allowlist(self, monkeypatch):
        install_transport(monkeypatch, ok_envelope([raw_business(description='Roastery', check_url='https://maps.example')], cost=0.0192))

        rows, cost = business.search_listings(business.ListingsQuery(near=NEAR, title='cafe'))

        assert (rows, cost) == ([{**projected_business(), 'description': 'Roastery', 'check_url': 'https://maps.example'}], 0.0192)

    def test_answers_no_rows_when_dataforseo_finds_no_results(self, monkeypatch):
        install_transport(monkeypatch, task_error_envelope(40501, 'No Search Results.', cost=0.012))

        assert business.search_listings(business.ListingsQuery(near=NEAR)) == ([], 0.012)


def test_reads_categories_from_the_result_list_itself(monkeypatch):
    install_transport(monkeypatch, ok_envelope(result=[{'category_name': 'cafe', 'business_count': 900}, {'business_count': 3}]))

    assert business.listing_categories() == [{'category': 'cafe', 'business_count': 900}]


class TestProfile:
    def test_merges_the_check_url_of_the_result_into_the_profile(self, monkeypatch):
        install_transport(monkeypatch, ok_envelope([raw_business()], cost=0.0054, check_url='https://www.google.com/maps?cid=1'))

        profile, _cost = business.business_profile(business.BusinessIdentifier(cid=CAFE_CID), None, 2840, 'en')

        assert profile is not None
        assert profile['check_url'] == 'https://www.google.com/maps?cid=1'

    def test_answers_none_when_no_profile_matches(self, monkeypatch):
        install_transport(monkeypatch, task_error_envelope(40501, 'No Search Results.', cost=0.0054))

        assert business.business_profile(business.BusinessIdentifier(name='Nobody'), None, 2840, 'en')[0] is None

    def test_formats_opening_hours_and_closed_days(self):
        work_time = {'work_hours': {'timetable': {
            'monday': [{'open': {'hour': 9, 'minute': 0}, 'close': {'hour': 17, 'minute': 30}}], 'sunday': None,
        }, 'current_status': 'open'}}

        assert business.timetable(work_time) == {'monday': ['09:00-17:30'], 'sunday': []}

    def test_counts_missing_stars_of_the_rating_distribution_as_zero(self):
        assert business.rating_distribution({'5': 10, '1': 2}) == {'1': 2, '2': 0, '3': 0, '4': 0, '5': 10}


class TestQuestions:
    def test_flattens_answered_and_unanswered_questions_of_every_result(self, monkeypatch):
        answered = {'question_id': 'q1', 'question_text': 'Open late?', 'items': [{'answer_id': 'a1', 'answer_text': 'Yes'}]}
        unanswered = {'question_id': 'q2', 'original_question_text': 'Parking?'}
        install_transport(monkeypatch, ok_envelope(result=[{'items': [answered], 'items_without_answers': [unanswered]}]))

        questions, _cost = business.business_questions(business.BusinessIdentifier(cid='1'), NEAR, 'en', 20)

        assert [(question['question_text'], len(question['answers'])) for question in questions] == [('Open late?', 1), ('Parking?', 0)]

    def test_answers_no_questions_when_google_has_no_q_and_a(self, monkeypatch):
        install_transport(monkeypatch, task_error_envelope(40501, 'No Search Results.', cost=0.0054))

        assert business.business_questions(business.BusinessIdentifier(cid='1'), NEAR, 'en', 20)[0] == []

    def test_sends_the_prefixed_keyword_and_the_metre_coordinate(self, monkeypatch):
        transport = install_transport(monkeypatch, ok_envelope(result=[]))

        business.business_questions(business.BusinessIdentifier(cid='42'), NEAR, 'en', 20)

        assert transport.calls[0].task == {'keyword': 'cid:42', 'location_coordinate': '33.1234568,-84.9876543,5000',
                                           'language_code': 'en', 'depth': 20}
