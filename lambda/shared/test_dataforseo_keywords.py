"""Tests for shared.dataforseo_keywords (+ dataforseo_labs, dataforseo_google_ads, dataforseo_keyword_rows).

Covers research, the shared row mappers and keyword metrics, including the design choices that every
requested keyword gets a metric row and that a clickstream volume of 0 is kept. ``post_live`` is replaced by
``FakePostLive``; no network.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from typing import Any
from unittest.mock import patch

import pytest

from shared import dataforseo_client
from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_google_ads import KEYWORDS_FOR_KEYWORDS_PATH, SEARCH_VOLUME_PATH, ads_acceptable
from shared.dataforseo_keyword_rows import KeywordMetric, KeywordRow, MonthlySearch, int_or_none, normalize_intent
from shared.dataforseo_keywords import interleave_rows, keyword_metrics, research_keywords
from shared.dataforseo_labs import IDEAS_PATH, OVERVIEW_PATH, RELATED_PATH, SUGGESTIONS_PATH
from testing.dataforseo_endpoint_fixtures import (
    ADS_IS,
    LABS_US,
    FakePostLive,
    Outcome,
    ads_item,
    dataforseo_error,
    labs_item,
    labs_items,
    labs_task,
    task_result,
)

_SIBLINGS = ('respite care', 'elder care', 'adult day care', 'care home', 'home care')


@pytest.fixture
def fake() -> Iterator[FakePostLive]:
    """A recording ``post_live``; tests fill ``by_path`` / ``sequence``."""
    post_live = FakePostLive()
    with patch.object(dataforseo_client, 'post_live', post_live):
        yield post_live


@pytest.fixture
def blend(fake: FakePostLive) -> FakePostLive:
    """``fake`` answering suggestions with five non-seed rows and ideas with none: no related fallback."""
    fake.by_path = {SUGGESTIONS_PATH: labs_task(labs_items(*_SIBLINGS)), IDEAS_PATH: labs_task([])}
    return fake


@pytest.fixture
def research_error(fake: FakePostLive) -> Callable[[Mapping[str, Outcome]], DataForSeoError]:
    """Runs an auto research against ``by_path`` and hands back the error it raised."""
    def run(by_path: Mapping[str, Outcome]) -> DataForSeoError:
        fake.by_path = by_path
        with pytest.raises(DataForSeoError) as raised:
            research_keywords('caregiving', LABS_US)
        return raised.value
    return run


@pytest.fixture
def ideas_row(fake: FakePostLive) -> Callable[[dict[str, Any]], KeywordRow]:
    """Maps one Labs item through an ``ideas`` research and returns its row."""
    def run(item: dict[str, Any]) -> KeywordRow:
        fake.by_path = {IDEAS_PATH: labs_task([item])}
        return research_keywords('caregiving', LABS_US, mode='ideas').rows[0]
    return run


def _row(keyword: str) -> KeywordRow:
    return KeywordRow(keyword=keyword, search_volume=1000, trend=(), keyword_difficulty=20, cpc=1.5,
                      competition=0.4, intent='informational')


class TestInterleaveRows:
    def test_alternates_sources_dedupes_by_keyword_and_stops_at_the_limit(self):
        rows = interleave_rows([_row(k) for k in 'abc'], [_row(k) for k in 'xay'], 4)

        assert [row.keyword for row in rows] == ['a', 'x', 'b', 'c']

    def test_drains_the_longer_source_when_the_other_runs_out(self):
        rows = interleave_rows([_row('a')], [_row(k) for k in 'xyz'], 10)

        assert [row.keyword for row in rows] == ['a', 'x', 'y', 'z']


class TestAutoResearch:
    def test_calls_suggestions_and_ideas_at_half_the_limit_when_market_is_labs(self, blend):
        research_keywords('caregiving', LABS_US, limit=150)

        assert sorted(blend.paths()) == sorted([SUGGESTIONS_PATH, IDEAS_PATH])
        assert {call.task['limit'] for call in blend.calls} == {75}

    def test_rounds_the_half_limit_up_when_limit_is_odd(self, blend):
        research_keywords('caregiving', LABS_US, limit=5)

        assert blend.task_for(IDEAS_PATH)['limit'] == 3

    def test_sends_the_exact_suggestions_body(self, blend):
        research_keywords('Caregiving ', LABS_US)

        assert blend.task_for(SUGGESTIONS_PATH) == {
            'keyword': 'caregiving', 'location_code': 2840, 'language_code': 'en', 'limit': 75,
            'include_clickstream_data': False, 'include_serp_info': False, 'include_seed_keyword': True,
            'ignore_synonyms': True, 'exact_match': False,
        }

    def test_sends_the_exact_ideas_body(self, blend):
        research_keywords('caregiving', LABS_US)

        assert blend.task_for(IDEAS_PATH) == {
            'keywords': ['caregiving'], 'location_code': 2840, 'language_code': 'en', 'limit': 75,
            'include_clickstream_data': False, 'include_serp_info': False, 'ignore_synonyms': True,
            'closely_variants': False,
        }

    def test_returns_interleaved_blend_without_fallback_when_five_non_seed_rows(self, fake):
        fake.by_path = {
            SUGGESTIONS_PATH: labs_task(labs_items('caregiving', 'respite care', 'elder care'), cost=0.021),
            IDEAS_PATH: labs_task(labs_items('caregiver', 'care home', 'elder care', 'home care'), cost=0.03),
        }

        result = research_keywords('caregiving', LABS_US)

        assert [row.keyword for row in result.rows] == [
            'caregiving', 'caregiver', 'respite care', 'care home', 'elder care', 'home care',
        ]
        assert (result.source, result.used_fallback) == ('blended', False)
        assert result.cost_usd == pytest.approx(0.051)
        assert RELATED_PATH not in fake.paths()

    def test_reads_related_at_the_full_limit_when_the_blend_is_thin(self, fake):
        related = [{'keyword_data': item} for item in labs_items('caregiver', 'care home', 'home care')]
        fake.by_path = {
            SUGGESTIONS_PATH: labs_task(labs_items('caregiving', 'respite care')),
            IDEAS_PATH: labs_task(labs_items('elder care')),
            RELATED_PATH: labs_task(related, cost=0.03),
        }

        result = research_keywords('caregiving', LABS_US, limit=150)

        assert [row.keyword for row in result.rows] == [
            'caregiving', 'caregiver', 'elder care', 'care home', 'respite care', 'home care',
        ]
        assert (result.source, result.used_fallback) == ('blended', True)
        assert result.cost_usd == pytest.approx(0.07)

    def test_sends_the_exact_related_body_when_falling_back(self, fake):
        fake.by_path = {
            SUGGESTIONS_PATH: labs_task([]), IDEAS_PATH: labs_task([]), RELATED_PATH: labs_task([]),
        }

        research_keywords('caregiving', LABS_US, limit=300, group_keywords=True, clickstream=True)

        assert fake.task_for(RELATED_PATH) == {
            'keyword': 'caregiving', 'location_code': 2840, 'language_code': 'en', 'limit': 300, 'depth': 3,
            'ignore_synonyms': False, 'include_clickstream_data': True, 'include_serp_info': False,
        }

    @pytest.mark.parametrize(('group_keywords', 'ignore_synonyms'), [(False, True), (True, False)])
    def test_ignore_synonyms_is_the_inverse_of_group_keywords(self, blend, group_keywords, ignore_synonyms):
        research_keywords('caregiving', LABS_US, group_keywords=group_keywords)

        assert {call.task['ignore_synonyms'] for call in blend.calls} == {ignore_synonyms}

    @pytest.mark.parametrize('clickstream', [False, True])
    def test_include_clickstream_data_follows_the_clickstream_option(self, blend, clickstream):
        research_keywords('caregiving', LABS_US, clickstream=clickstream)

        assert {call.task['include_clickstream_data'] for call in blend.calls} == {clickstream}

    def test_raises_the_suggestions_failure_with_the_ideas_cost_after_ideas_completes(self, fake, research_error):
        error = research_error({
            SUGGESTIONS_PATH: dataforseo_error('UPSTREAM_UNAVAILABLE', 50000),
            IDEAS_PATH: labs_task(labs_items(*_SIBLINGS), cost=0.021),
        })

        assert (error.code, error.cost_usd) == ('UPSTREAM_UNAVAILABLE', pytest.approx(0.021))
        assert IDEAS_PATH in fake.paths()

    def test_raises_the_ideas_failure_with_the_suggestions_cost(self, research_error):
        error = research_error({
            SUGGESTIONS_PATH: labs_task(labs_items(*_SIBLINGS), cost=0.021),
            IDEAS_PATH: dataforseo_error('INTERNAL_ERROR', 40501, cost=0.012),
        })

        assert (error.code, error.cost_usd) == ('INTERNAL_ERROR', pytest.approx(0.033))

    def test_raises_the_related_failure_with_the_blend_cost(self, research_error):
        error = research_error({
            SUGGESTIONS_PATH: labs_task([], cost=0.012), IDEAS_PATH: labs_task([], cost=0.012),
            RELATED_PATH: dataforseo_error('RATE_LIMITED', 429),
        })

        assert (error.code, error.cost_usd) == ('RATE_LIMITED', pytest.approx(0.024))


class TestManualAndAdsResearch:
    @pytest.mark.parametrize(('mode', 'path'), [
        ('suggestions', SUGGESTIONS_PATH), ('ideas', IDEAS_PATH), ('related', RELATED_PATH),
    ])
    def test_manual_mode_calls_one_endpoint_at_the_full_limit(self, fake, mode, path):
        fake.by_path = {path: labs_task([])}

        result = research_keywords('caregiving', LABS_US, mode=mode, limit=500)

        assert (fake.paths(), fake.calls[0].task['limit'], result.source) == ([path], 500, mode)

    def test_related_rows_are_unwrapped_from_keyword_data(self, fake):
        fake.by_path = {RELATED_PATH: labs_task([{'keyword_data': labs_item('Care Home')}, {'keyword_data': None}])}

        result = research_keywords('caregiving', LABS_US, mode='related')

        assert [row.keyword for row in result.rows] == ['care home']

    def test_rejects_an_unknown_mode_before_any_call(self, fake):
        with pytest.raises(ValueError, match='unknown research mode'):
            research_keywords('caregiving', LABS_US, mode='phrase')

        assert fake.calls == []

    def test_rejects_a_blank_seed_before_any_call(self, fake):
        with pytest.raises(ValueError, match='seed keyword is empty'):
            research_keywords('   ', LABS_US)

        assert fake.calls == []

    def test_google_ads_market_sends_the_exact_keywords_for_keywords_body(self, fake):
        fake.by_path = {KEYWORDS_FOR_KEYWORDS_PATH: task_result([], cost=0.09)}

        research_keywords('Northern Lights Tour', ADS_IS, mode='ideas', group_keywords=True, clickstream=True)

        assert (fake.paths(), fake.calls[0].task) == ([KEYWORDS_FOR_KEYWORDS_PATH], {
            'keywords': ['northern lights tour'], 'location_code': 2352, 'language_code': 'is',
            'sort_by': 'search_volume',
        })

    def test_google_ads_research_truncates_items_to_the_limit(self, fake):
        items = [ads_item(f'tour {index}') for index in range(200)]
        fake.by_path = {KEYWORDS_FOR_KEYWORDS_PATH: task_result(items, cost=0.09)}

        result = research_keywords('tour', ADS_IS, limit=150)

        assert (len(result.rows), result.source, result.cost_usd) == (150, 'google_ads', 0.09)

    def test_google_ads_rows_have_no_difficulty_unknown_intent_and_a_ratio_competition(self, fake):
        fake.by_path = {KEYWORDS_FOR_KEYWORDS_PATH: task_result([ads_item('tour')])}

        row = research_keywords('tour', ADS_IS).rows[0]

        assert (row.keyword_difficulty, row.intent, row.competition, row.cpc) == (None, 'unknown', 0.42, 2.54)

    def test_google_ads_rows_dedupe_case_variants_and_skip_items_without_keyword(self, fake):
        items = [ads_item('northern lights tour', 320, cpc=None, competition_index=None, monthly_searches=None),
                 ads_item('Northern Lights Tour', 320), ads_item(None)]
        fake.by_path = {KEYWORDS_FOR_KEYWORDS_PATH: task_result(items)}

        rows = research_keywords('tour', ADS_IS).rows

        assert rows == (KeywordRow(keyword='northern lights tour', search_volume=320, trend=(), keyword_difficulty=None,
                                   cpc=None, competition=None, intent='unknown'),)


class TestLabsRowMapping:
    def test_keeps_a_clickstream_volume_of_zero_when_the_clickstream_block_has_one(self, ideas_row):
        row = ideas_row(labs_item('caregiving', 5000, keyword_info_normalized_with_clickstream={
            'search_volume': 0, 'monthly_searches': [{'year': 2026, 'month': 7, 'search_volume': 0}],
        }))

        assert (row.search_volume, row.trend) == (0, (MonthlySearch(2026, 7, 0),))

    def test_reads_the_google_ads_block_when_the_clickstream_volume_is_null(self, ideas_row):
        row = ideas_row(labs_item('caregiving', 5000, keyword_info_normalized_with_clickstream={'search_volume': None}))

        assert row.search_volume == 5000

    def test_takes_cpc_and_competition_from_keyword_info_even_with_clickstream(self, ideas_row):
        row = ideas_row(labs_item('caregiving', keyword_info_normalized_with_clickstream={'search_volume': 10, 'cpc': 9.9}))

        assert (row.search_volume, row.cpc, row.competition) == (10, 1.5, 0.4)

    def test_keeps_a_null_keyword_difficulty_null(self, ideas_row):
        row = ideas_row(labs_item('caregiving', keyword_properties={'keyword_difficulty': None}, search_intent_info=None))

        assert (row.keyword_difficulty, row.intent) == (None, 'unknown')

    def test_lowercases_and_dedupes_keywords_and_skips_items_without_one(self, fake):
        fake.by_path = {IDEAS_PATH: labs_task([labs_item(' Care Home'), labs_item('care home'), {'keyword': None}])}

        rows = research_keywords('caregiving', LABS_US, mode='ideas').rows

        assert [row.keyword for row in rows] == ['care home']

    @pytest.mark.parametrize(('raw', 'intent'), [
        ('informational', 'informational'), ('Commercial', 'commercial'), ('transactional', 'transactional'),
        ('navigational', 'navigational'), ('local', 'unknown'), (None, 'unknown'), ('', 'unknown'),
    ])
    def test_normalizes_main_intent_to_the_five_app_intents(self, raw, intent):
        assert normalize_intent(raw) == intent

    @pytest.mark.parametrize(('raw', 'number'), [
        (42, 42), (7.9, 7), (True, None), ('5', None), (None, None), (float('nan'), None), (float('inf'), None),
    ])
    def test_reads_wire_integers_and_treats_bools_strings_and_non_finite_as_missing(self, raw, number):
        assert int_or_none(raw) == number


class TestKeywordMetrics:
    def test_prefers_clickstream_volume_and_trend_and_keeps_the_raw_intent_when_labs(self, fake):
        item = labs_item('best crm', 1000, keyword_info={
            'search_volume': 1000, 'cpc': 3.2, 'competition': 0.5, 'competition_level': 'MEDIUM',
            'monthly_searches': [{'year': 2026, 'month': 1, 'search_volume': 1000}],
        }, keyword_info_normalized_with_clickstream={
            'search_volume': 880, 'monthly_searches': [{'year': 2026, 'month': 1, 'search_volume': 880}],
        }, keyword_properties={'keyword_difficulty': 42}, search_intent_info={'main_intent': 'commercial'})
        fake.by_path = {OVERVIEW_PATH: labs_task([item], cost=0.0121)}

        rows, cost = keyword_metrics(['best crm'], LABS_US)

        assert rows == [KeywordMetric(
            keyword='best crm', search_volume=880, monthly_searches=(MonthlySearch(2026, 1, 880),),
            keyword_difficulty=42, cpc=3.2, competition=0.5, competition_level='MEDIUM', intent='commercial',
            source='labs',
        )]
        assert cost == 0.0121

    def test_sends_the_exact_keyword_overview_body(self, fake):
        fake.by_path = {OVERVIEW_PATH: labs_task([])}

        keyword_metrics(['Best CRM', 'crm tool'], LABS_US)

        assert fake.calls[0].task == {
            'keywords': ['best crm', 'crm tool'], 'location_code': 2840, 'language_code': 'en',
            'include_clickstream_data': False,
        }

    def test_scales_ads_competition_index_to_a_ratio_and_drops_items_without_keyword(self, fake):
        fake.by_path = {SEARCH_VOLUME_PATH: task_result([ads_item('hotel example town'), ads_item(None)], cost=0.09)}

        rows, _cost = keyword_metrics(['hotel example town'], ADS_IS)

        assert rows == [KeywordMetric(
            keyword='hotel example town', search_volume=1300, monthly_searches=(MonthlySearch(2026, 5, 1300),),
            keyword_difficulty=None, cpc=2.54, competition=0.42, competition_level='HIGH', intent=None,
            source='google_ads',
        )]

    def test_sends_only_ads_acceptable_keywords_and_returns_null_rows_for_the_rest(self, fake):
        fake.by_path = {SEARCH_VOLUME_PATH: task_result([])}

        rows, _cost = keyword_metrics(['hotel example town', 'hotel (cheap)', 'best hotel?'], ADS_IS)

        assert fake.calls[0].task['keywords'] == ['hotel example town']
        assert [(row.keyword, row.search_volume, row.source) for row in rows] == [
            ('hotel example town', None, 'google_ads'), ('hotel (cheap)', None, 'google_ads'),
            ('best hotel?', None, 'google_ads'),
        ]

    def test_makes_no_call_when_no_keyword_is_ads_acceptable(self, fake):
        rows, cost = keyword_metrics(['best hotel?'], ADS_IS)

        assert (fake.calls, [row.keyword for row in rows], cost) == ([], ['best hotel?'], 0.0)

    def test_batches_lists_above_seven_hundred_and_sums_the_cost(self, fake):
        fake.by_path = {OVERVIEW_PATH: lambda _path, task: labs_task(labs_items(*task['keywords']), cost=0.1)}
        keywords = [f'kw-{index}' for index in range(1500)]

        rows, cost = keyword_metrics(keywords, LABS_US)

        assert [len(call.task['keywords']) for call in fake.calls] == [700, 700, 100]
        assert (len(rows), cost) == (1500, pytest.approx(0.3))

    def test_returns_one_row_per_requested_keyword_in_order_when_labs_omits_some(self, fake):
        fake.by_path = {OVERVIEW_PATH: labs_task(labs_items('crm tool', 'best crm'))}

        rows, _cost = keyword_metrics(['best crm', 'crm unknown', 'CRM Tool', 'best crm'], LABS_US)

        assert [(row.keyword, row.search_volume) for row in rows] == [
            ('best crm', 1000), ('crm unknown', None), ('crm tool', 1000),
        ]

    def test_raises_a_later_batch_failure_with_the_earlier_batch_cost(self, fake):
        fake.sequence = [labs_task([], cost=0.1), dataforseo_error('UPSTREAM_UNAVAILABLE', 503)]

        with pytest.raises(DataForSeoError) as raised:
            keyword_metrics([f'kw-{index}' for index in range(701)], LABS_US)

        assert raised.value.cost_usd == pytest.approx(0.1)


class TestAdsAcceptable:
    @pytest.mark.parametrize('keyword', ['hotel example town', 'a' * 80, ' '.join(['word'] * 10), 'café near me'])
    def test_accepts_plain_keywords_within_the_limits(self, keyword):
        assert ads_acceptable(keyword) is True

    @pytest.mark.parametrize('keyword', [
        'a' * 81, ' '.join(['word'] * 11), 'hotel (cheap)', 'best hotel?', '100% cotton', 'a,b', 'tour 🏨',
        'tour ☀', 'x=y', 'tick`',
    ])
    def test_rejects_symbols_emoji_long_text_and_many_words(self, keyword):
        assert ads_acceptable(keyword) is False
