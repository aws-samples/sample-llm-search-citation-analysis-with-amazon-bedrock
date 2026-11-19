"""Which stored answers a re-extract covers (``shared.reextract``): the filters, the keywords and the count."""

from __future__ import annotations

import pytest

from shared.brand_names import BRANDS_VERSION
from shared.reextract import (
    InvalidFiltersError,
    ReextractFilters,
    ScopedKeyword,
    count_answers,
    filters_from_body,
    scoped_keywords,
)
from testing.deadlines import spent_deadline
from testing.reextract_fakes import answer_row, answers_table, keyword_item


class TestFiltersFromBody:
    def test_an_empty_body_covers_every_keyword_and_only_outdated_answers(self):
        assert filters_from_body({}) == ReextractFilters()

    def test_keeps_groups_keywords_days_and_the_outdated_switch(self):
        filters = filters_from_body({
            'group_ids': ['g1'], 'keyword_ids': ['k1'], 'since': '2026-09-01', 'until': '2026-09-30', 'only_outdated': False,
        })
        assert filters == ReextractFilters(('g1',), ('k1',), '2026-09-01', '2026-09-30', only_outdated=False)

    def test_an_empty_date_means_no_bound(self):
        assert filters_from_body({'since': '', 'until': None}).since is None

    @pytest.mark.parametrize(('body', 'field'), [
        ({'since': '2026-9-1'}, 'since'),
        ({'until': '2026-02-30'}, 'until'),
        ({'since': 20260901}, 'since'),
        ({'since': '2026-10-02', 'until': '2026-10-01'}, 'since'),
        ({'only_outdated': 'yes'}, 'only_outdated'),
        ({'group_ids': 'g1'}, 'group_ids'),
        ({'keyword_ids': ['']}, 'keyword_ids'),
    ])
    def test_refuses_a_bad_field_and_names_it(self, body, field):
        with pytest.raises(InvalidFiltersError) as raised:
            filters_from_body(body)
        assert raised.value.field == field

    def test_echoes_the_filters_as_the_api_answers_them(self):
        assert filters_from_body({'group_ids': ['g1'], 'since': '2026-09-01'}).as_dict() == {
            'group_ids': ['g1'], 'keyword_ids': [], 'since': '2026-09-01', 'until': None, 'only_outdated': True,
        }


_ACTIVE = [
    keyword_item('hoteles en Lima', group_ids=['g1'], market_id='pe-es'),
    keyword_item('Best hotels', keyword_id='k2'),
    keyword_item('apart hotels', group_ids=['g2']),
]


class TestScopedKeywords:
    def test_no_group_and_no_keyword_covers_every_active_keyword_in_order(self):
        assert [scoped.keyword for scoped in scoped_keywords(ReextractFilters(), _ACTIVE)] == [
            'apart hotels', 'Best hotels', 'hoteles en Lima',
        ]

    def test_groups_and_keyword_ids_add_up(self):
        filters = ReextractFilters(group_ids=('g1',), keyword_ids=('k2',))
        assert [scoped.keyword for scoped in scoped_keywords(filters, _ACTIVE)] == ['Best hotels', 'hoteles en Lima']

    def test_a_keyword_keeps_its_market(self):
        filters = ReextractFilters(group_ids=('g1',))
        assert scoped_keywords(filters, _ACTIVE) == [ScopedKeyword('hoteles en Lima', 'pe-es')]

    def test_a_keyword_in_two_named_groups_is_covered_once(self):
        active = [keyword_item('hotels', group_ids=['g1', 'g2'])]
        assert len(scoped_keywords(ReextractFilters(group_ids=('g1', 'g2')), active)) == 1


_KEYWORD = ScopedKeyword('hotels', 'global')


class TestCountAnswers:
    def test_counts_outdated_answers_and_skips_current_ones(self):
        table = answers_table([
            answer_row('hotels', 'openai'), answer_row('hotels', 'gemini', brands_version=1),
            answer_row('hotels', 'claude', brands_version=BRANDS_VERSION),
        ])
        count = count_answers(table, [_KEYWORD], ReextractFilters(), None)
        assert (count.answers, count.answers_current, count.keywords) == (2, 1, 1)

    def test_without_only_outdated_every_answer_counts_and_none_is_current(self):
        table = answers_table([answer_row('hotels', 'openai'), answer_row('hotels', 'claude', brands_version=BRANDS_VERSION)])
        count = count_answers(table, [_KEYWORD], ReextractFilters(only_outdated=False), None)
        assert (count.answers, count.answers_current) == (2, 0)

    @pytest.mark.parametrize('row', [
        answer_row('hotels', 'brave', provider_type='search'),
        answer_row('hotels', 'openai', status='error'),
        answer_row('hotels', 'gemini', response=''),
    ])
    def test_rows_that_are_not_an_answered_engine_answer_are_not_counted(self, row):
        assert count_answers(answers_table([row]), [_KEYWORD], ReextractFilters(), None).answers == 0

    @pytest.mark.parametrize(('since', 'until', 'expected'), [
        ('2026-10-02', None, 2), (None, '2026-10-02', 2), ('2026-10-02', '2026-10-02', 1), ('2026-10-04', None, 0),
    ])
    def test_counts_only_runs_on_the_days_asked_for_inclusive(self, since, until, expected):
        table = answers_table([answer_row('hotels', day=day) for day in ('2026-10-01', '2026-10-02', '2026-10-03')])
        assert count_answers(table, [_KEYWORD], ReextractFilters(since=since, until=until), None).answers == expected

    def test_a_keyword_without_an_answer_to_redo_is_not_counted_as_a_keyword(self):
        table = answers_table([answer_row('hotels', brands_version=BRANDS_VERSION)])
        assert count_answers(table, [_KEYWORD, ScopedKeyword('motels', 'global')], ReextractFilters(), None).keywords == 0

    def test_a_spent_deadline_answers_a_truncated_count(self):
        table = answers_table([answer_row('hotels')])
        count = count_answers(table, [_KEYWORD], ReextractFilters(), spent_deadline())
        assert (count.answers, count.truncated) == (0, True)
