"""Tests for shared/brand_mention_views.py — the bounded /brand-mentions aggregates and run reads."""

from __future__ import annotations

from typing import Any

import pytest

from shared.brand_mention_views import (
    APPEARANCE_PREVIEW_LIMIT,
    BRAND_LIMIT,
    appearance_rows,
    brand_summary,
    list_runs,
    provider_entry,
    read_run_rows,
)
from testing.search_results_fixtures import search_result_row, search_results_table

RUN_1 = '2026-09-01T06:00:00Z'
RUN_2 = '2026-09-08T06:00:00Z'
RUN_3 = '2026-09-15T06:00:00Z'


def _brand(name: str, classification: str = 'competitor', rank: int = 1, sentiment: str | None = 'positive') -> dict[str, Any]:
    return {'name': name, 'classification': classification, 'rank': rank, 'mention_count': 1, 'sentiment': sentiment}


def _row(
    provider: str, brands: list[dict[str, Any]], timestamp: str = RUN_3, keyword: str = 'hotel spa', response: str = '',
) -> dict[str, Any]:
    return search_result_row(keyword, provider, brands, timestamp=timestamp, metadata={'model': f'{provider}-m'}, response=response)


class TestListRuns:
    def test_lists_runs_newest_first_from_the_latest(self):
        table = search_results_table({'hotel spa': [_row('openai', [], RUN_1), _row('openai', [], RUN_2), _row('gemini', [], RUN_2)]})

        assert list_runs(table, 'hotel spa', RUN_2) == [RUN_2, RUN_1]

    def test_stops_at_max_runs(self):
        table = search_results_table({'hotel spa': [_row('openai', [], ts) for ts in (RUN_1, RUN_2, RUN_3)]})

        assert list_runs(table, 'hotel spa', RUN_3, 2) == [RUN_3, RUN_2]

    def test_lists_nothing_without_a_latest_run(self):
        assert list_runs(search_results_table({}), 'hotel spa', None) == []

    def test_reads_one_row_per_listed_run(self):
        table = search_results_table({'hotel spa': [_row(provider, [], ts) for ts in (RUN_1, RUN_2) for provider in ('a', 'b')]})

        list_runs(table, 'hotel spa', RUN_2)

        assert {call.kwargs['Limit'] for call in table.query.call_args_list} == {1}


class TestReadRunRows:
    @pytest.fixture
    def two_runs(self) -> Any:
        return search_results_table({'hotel spa': [_row('openai', [], RUN_1), _row('gemini', [], RUN_2)]})

    def test_reads_the_latest_run_when_no_timestamp_is_given(self, two_runs):
        timestamp, rows = read_run_rows(two_runs, 'hotel spa', None)

        assert (timestamp, [row['provider'] for row in rows]) == (RUN_2, ['gemini'])

    def test_reads_only_the_requested_run(self, two_runs):
        assert [row['provider'] for row in read_run_rows(two_runs, 'hotel spa', RUN_1)[1]] == ['openai']

    def test_answers_nothing_for_a_keyword_never_analysed(self):
        assert read_run_rows(search_results_table({}), 'hotel spa', None) == (None, [])


class TestBrandSummary:
    def test_drops_the_duplicated_per_classification_lists(self):
        summary = brand_summary([_row('openai', [_brand('Mine', 'first_party')])], None)

        assert sorted(summary) == ['brands', 'brands_truncated', 'matching_brands', 'summary', 'total_unique_brands']

    def test_counts_classifications_of_every_brand_when_filtered(self):
        rows = [_row('openai', [_brand('Mine', 'first_party'), _brand('Rival'), _brand('Other', 'other')])]

        summary = brand_summary(rows, 'competitor')

        assert ([entry['name'] for entry in summary['brands']], summary['summary']) == (
            ['Rival'], {'first_party_count': 1, 'competitor_count': 1, 'other_count': 1},
        )

    def test_caps_the_brand_list_and_reports_the_total(self):
        rows = [_row('openai', [_brand(f'Brand {index}', rank=index) for index in range(BRAND_LIMIT + 5)])]

        summary = brand_summary(rows, None)

        assert (len(summary['brands']), summary['matching_brands'], summary['brands_truncated']) == (BRAND_LIMIT, BRAND_LIMIT + 5, True)

    def test_previews_the_best_ranked_appearances(self):
        rows = [_row(f'p{rank}', [_brand('Rival', rank=rank)]) for rank in (7, 3, 9, 1, 5, 2, 8)]

        brand = brand_summary(rows, None)['brands'][0]

        assert ([appearance['rank'] for appearance in brand['appearances']], brand['appearance_count']) == ([1, 2, 3, 5, 7], 7)
        assert len(brand['appearances']) == APPEARANCE_PREVIEW_LIMIT

    def test_previews_up_to_the_given_limit(self):
        rows = [_row(f'p{rank}', [_brand('Rival', rank=rank)]) for rank in range(1, 9)]

        assert len(brand_summary(rows, None, 8)['brands'][0]['appearances']) == 8

    def test_reports_each_providers_best_rank(self):
        rows = [_row('openai', [_brand('Rival', rank=4)]), _row('openai', [_brand('Rival', rank=2)], keyword='b'),
                _row('gemini', [_brand('Rival', rank=6)])]

        assert brand_summary(rows, None)['brands'][0]['provider_ranks'] == {'openai': 2, 'gemini': 6}

    def test_counts_sentiments_over_every_appearance(self):
        rows = [_row(provider, [_brand('Rival', sentiment=sentiment)])
                for provider, sentiment in (('a', 'positive'), ('b', 'negative'), ('c', 'positive'), ('d', None))]

        assert brand_summary(rows, None)['brands'][0]['sentiment_counts'] == {'positive': 2, 'negative': 1}

    def test_lists_distinct_providers_once(self):
        rows = [_row('openai', [_brand('Rival')]), _row('openai', [_brand('Rival')], keyword='b'), _row('gemini', [_brand('Rival')])]

        assert brand_summary(rows, None)['brands'][0]['providers'] == ['gemini', 'openai']

    def test_keeps_the_aggregate_score_formula(self):
        rows = [_row('openai', [{**_brand('Rival', rank=2), 'mention_count': 3}]), _row('gemini', [_brand('Rival', rank=4)])]

        brand = brand_summary(rows, None)['brands'][0]

        # 2 providers * 10 + (10 - best rank 2) + 4 mentions
        assert brand['aggregate_score'] == 32


class TestAppearanceRows:
    def test_tags_each_appearance_with_its_brand_in_summary_order(self):
        rows = [_row('openai', [_brand('Low', rank=8), _brand('High', 'first_party', rank=1)]), _row('gemini', [_brand('High', 'first_party')])]

        assert [(row['brand'], row['provider']) for row in appearance_rows(rows, None, None)] == [
            ('High', 'openai'), ('High', 'gemini'), ('Low', 'openai'),
        ]

    @pytest.mark.parametrize(('classification', 'brand', 'expected'), [
        pytest.param(None, ' rival ', ['Rival'], id='one-brand-case-insensitively'),
        pytest.param('first_party', None, ['Mine'], id='one-classification'),
    ])
    def test_narrows_the_appearances_to_the_filter(self, classification, brand, expected):
        rows = [_row('openai', [_brand('Rival'), _brand('Mine', 'first_party')])]

        assert [row['brand'] for row in appearance_rows(rows, classification, brand)] == expected

    def test_names_the_persona_of_each_appearance(self):
        row = search_result_row('hotel spa', 'openai', [_brand('Rival')], timestamp=RUN_3, query_prompt_id='familia')

        assert appearance_rows([row], None, None)[0]['query_prompt_id'] == 'familia'


class TestProviderEntry:
    @pytest.mark.parametrize(('length', 'truncated'), [(12_000, False), (12_001, True)])
    def test_cuts_answer_text_above_the_limit(self, length, truncated):
        entry = provider_entry(_row('openai', [], response='a' * length))

        assert (len(entry['full_response']), entry['response_truncated'], entry['response_length']) == (12_000, truncated, length)

    def test_previews_the_first_200_characters(self):
        assert provider_entry(_row('openai', [], response='b' * 300))['response_preview'] == 'b' * 200 + '...'
