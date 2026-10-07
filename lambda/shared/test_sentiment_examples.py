"""Tests for shared/sentiment_examples.py — the answers behind one sentiment count."""

from __future__ import annotations

from typing import Any

import pytest
from hypothesis import given

from shared.kpi_engine import SENTIMENT_LABELS, answers_from_rows, brand_kpis, engine_breakdown
from shared.sentiment_examples import (
    ANSWER_TEXT_CAP,
    EXAMPLE_ATTRIBUTE_NAMES,
    EXAMPLE_PROJECTION,
    sentiment_examples,
)
from testing.sentiment_examples_fixtures import OLDER_RUN, RUN, STORED_ROWS, stored_answer, stored_brand

SOL_NEGATIVE = stored_brand(
    'Hotel Sol',
    rank=3,
    sentiment_quote='Guests often mention that the rooms at Hotel Sol feel dated.',
    sentiment_reason='The answer warns about dated rooms.',
    ranking_context='mentioned as a cheaper but dated option',
)

#: One answer naming a first-party, a competitor and an other brand, all negative.
EVERY_CLASSIFICATION = [stored_answer('hotel sol spa', 'openai', [
    SOL_NEGATIVE,
    stored_brand('Rival Inn', classification='competitor'),
    stored_brand('Airbnb', classification='other'),
])]


def brands_of(examples: list[dict[str, Any]]) -> list[str]:
    return [example['brand'] for example in examples]


def passages_of(example: dict[str, Any]) -> tuple[Any, ...]:
    """The stored text an example carries next to the answer: quote, reason, ranking context, persona name."""
    return example['quote'], example['reason'], example['ranking_context'], example['persona_name']


def first_negative_example(brands: list[dict[str, Any]], **answer_fields: Any) -> dict[str, Any]:
    """The first negative example of one OpenAI answer to `hotel sol spa` naming `brands`."""
    rows = [stored_answer('hotel sol spa', 'openai', brands, **answer_fields)]
    return sentiment_examples(rows, 'negative')[1][0]


class TestCounts:
    @given(STORED_ROWS)
    def test_totals_match_the_kpi_sentiment_split_of_every_engine_together(self, rows: list[dict[str, Any]]) -> None:
        split = brand_kpis(answers_from_rows(rows))['sentiment_split']

        assert {label: sentiment_examples(rows, label)[0] for label in SENTIMENT_LABELS} == split

    @given(STORED_ROWS)
    def test_totals_match_the_kpi_sentiment_split_of_each_engine(self, rows: list[dict[str, Any]]) -> None:
        by_engine = {row['engine']: row['kpis']['sentiment_split'] for row in engine_breakdown(answers_from_rows(rows))}

        assert {
            engine: {label: sentiment_examples(rows, label, provider=engine)[0] for label in SENTIMENT_LABELS}
            for engine in by_engine
        } == by_engine

    def test_counts_only_first_party_brands(self) -> None:
        assert sentiment_examples(EVERY_CLASSIFICATION, 'negative')[0] == 1

    def test_lists_only_competitor_brands_when_competitor_classification_is_given(self) -> None:
        assert brands_of(sentiment_examples(EVERY_CLASSIFICATION, 'negative', classification='competitor')[1]) == ['Rival Inn']

    @given(STORED_ROWS)
    def test_competitor_totals_match_the_competitor_sightings_of_each_label(self, rows: list[dict[str, Any]]) -> None:
        sightings = [
            sighting for answer in answers_from_rows(rows) for sighting in answer.sightings
            if sighting.classification == 'competitor'
        ]

        assert {label: sentiment_examples(rows, label, classification='competitor')[0] for label in SENTIMENT_LABELS} == {
            label: sum(1 for sighting in sightings if sighting.sentiment == label) for label in SENTIMENT_LABELS
        }

    def test_counts_only_the_requested_label(self) -> None:
        rows = [stored_answer('hotel sol spa', 'openai', [SOL_NEGATIVE, stored_brand('Hotel Mar', 'positive')])]

        assert brands_of(sentiment_examples(rows, 'positive')[1]) == ['Hotel Mar']

    def test_counts_a_label_stored_in_upper_case(self) -> None:
        rows = [stored_answer('hotel sol spa', 'openai', [stored_brand('Hotel Sol', 'Negative')])]

        assert sentiment_examples(rows, 'negative')[0] == 1

    def test_ignores_rows_that_are_not_answers(self) -> None:
        rows = [
            stored_answer('hotel sol spa', 'brave', [SOL_NEGATIVE]),
            stored_answer('hotel sol spa', 'gemini', [SOL_NEGATIVE], status='error'),
        ]

        assert sentiment_examples(rows, 'negative') == (0, [])

    def test_keeps_one_engines_answers_when_a_provider_is_given(self) -> None:
        rows = [stored_answer('hotel sol spa', 'openai', [SOL_NEGATIVE]), stored_answer('hotel sol spa', 'gemini', [SOL_NEGATIVE])]

        total, examples = sentiment_examples(rows, 'negative', provider='gemini')

        assert (total, [example['provider'] for example in examples]) == (1, ['gemini'])


class TestRepeatedBrand:
    def test_counts_a_brand_named_twice_in_one_answer_once(self) -> None:
        rows = [stored_answer('hotel sol spa', 'openai', [SOL_NEGATIVE, stored_brand('hotel sol', rank=1)])]

        assert sentiment_examples(rows, 'negative')[0] == 1

    def test_describes_the_brand_at_its_best_rank(self) -> None:
        example = first_negative_example([
            SOL_NEGATIVE,
            stored_brand('hotel sol', rank=1, sentiment_quote='Hotel Sol is loud.'),
        ])

        assert (example['brand'], example['rank'], example['quote']) == ('hotel sol', 1, 'Hotel Sol is loud.')

    @pytest.mark.parametrize(
        ('first_rank', 'second_rank'),
        [
            pytest.param(2, 2, id='two_share_the_best_rank'),
            pytest.param(None, 'first', id='no_rank_is_known'),
        ],
    )
    def test_describes_the_first_brand_dict_when_ranks_do_not_separate_them(
        self, first_rank: object, second_rank: object
    ) -> None:
        example = first_negative_example([
            stored_brand('Hotel Sol', rank=first_rank, sentiment_quote='First quote.'),
            stored_brand('Hotel Sol', rank=second_rank, sentiment_quote='Second quote.'),
        ])

        assert example['quote'] == 'First quote.'

    def test_counts_the_kept_label_not_the_label_of_a_worse_rank(self) -> None:
        rows = [stored_answer('hotel sol spa', 'openai', [
            stored_brand('Hotel Sol', 'positive', rank=1), stored_brand('Hotel Sol', 'negative', rank=4),
        ])]

        assert (sentiment_examples(rows, 'positive')[0], sentiment_examples(rows, 'negative')[0]) == (1, 0)


class TestExample:
    def test_describes_the_answer_the_brand_and_the_passage(self) -> None:
        rows = [stored_answer(
            'hotel coruna spa', 'openai', [SOL_NEGATIVE],
            query_prompt_id='family', query_prompt_name='Family traveller', response='Full answer text.',
        )]

        assert sentiment_examples(rows, 'negative')[1] == [{
            'keyword': 'hotel coruna spa',
            'provider': 'openai',
            'persona': 'family',
            'persona_name': 'Family traveller',
            'timestamp': RUN,
            'brand': 'Hotel Sol',
            'rank': 3,
            'sentiment': 'negative',
            'quote': 'Guests often mention that the rooms at Hotel Sol feel dated.',
            'reason': 'The answer warns about dated rooms.',
            'ranking_context': 'mentioned as a cheaper but dated option',
            'answer': 'Full answer text.',
            'answer_truncated': False,
        }]

    def test_describes_an_older_row_without_quote_reason_context_or_persona_name(self) -> None:
        assert passages_of(first_negative_example([stored_brand('Hotel Sol')])) == (None, None, None, None)

    def test_reads_the_default_persona_when_the_row_names_none(self) -> None:
        row = stored_answer('hotel sol spa', 'openai', [SOL_NEGATIVE])
        del row['query_prompt_id']

        assert sentiment_examples([row], 'negative')[1][0]['persona'] == 'default'

    @pytest.mark.parametrize('value', ['', '   ', 7, ['text']])
    def test_reads_blank_or_non_text_passages_as_none(self, value: object) -> None:
        example = first_negative_example(
            [stored_brand('Hotel Sol', sentiment_quote=value, sentiment_reason=value, ranking_context=value)],
            query_prompt_name=value,
        )

        assert passages_of(example) == (None, None, None, None)

    def test_strips_the_stored_passages(self) -> None:
        example = first_negative_example(
            [stored_brand('Hotel Sol', sentiment_quote=' Dated rooms. ', sentiment_reason='\nWarns.\n', ranking_context=' cheap ')],
            query_prompt_name=' Family ',
        )

        assert passages_of(example) == ('Dated rooms.', 'Warns.', 'cheap', 'Family')


class TestAnswerText:
    @pytest.mark.parametrize(
        ('response', 'expected'),
        [
            pytest.param('a' * (ANSWER_TEXT_CAP + 1), ('a' * 20_000, True), id='long_answer_cut_at_the_cap'),
            pytest.param('a' * 20_000, ('a' * 20_000, False), id='answer_of_exactly_the_cap_kept'),
            pytest.param(None, ('', False), id='no_text_answers_empty'),
            pytest.param(42, ('', False), id='non_text_answers_empty'),
        ],
    )
    def test_carries_the_answer_text_capped_with_a_truncation_flag(self, response: object, expected: tuple) -> None:
        example = first_negative_example([SOL_NEGATIVE], response=response)

        assert (example['answer'], example['answer_truncated']) == expected


class TestOrder:
    def test_lists_the_newest_run_first(self) -> None:
        rows = [
            stored_answer('a hotel', 'openai', [stored_brand('Older')], timestamp=OLDER_RUN),
            stored_answer('b hotel', 'openai', [stored_brand('Newer')]),
        ]

        assert brands_of(sentiment_examples(rows, 'negative')[1]) == ['Newer', 'Older']

    @pytest.mark.parametrize(
        'rows',
        [
            pytest.param(
                [stored_answer('B hotel', 'openai', [stored_brand('Second')]), stored_answer('a hotel', 'openai', [stored_brand('First')])],
                id='run_by_keyword_ignoring_case',
            ),
            pytest.param(
                [stored_answer('a hotel', 'openai', [stored_brand('Second')]), stored_answer('a hotel', 'gemini', [stored_brand('First')])],
                id='keyword_by_provider',
            ),
        ],
    )
    def test_orders_answers_within_a_run(self, rows: list[dict[str, Any]]) -> None:
        assert brands_of(sentiment_examples(rows, 'negative')[1]) == ['First', 'Second']

    def test_orders_an_answer_by_brand_ignoring_case(self) -> None:
        rows = [stored_answer('a hotel', 'openai', [stored_brand('Beta'), stored_brand('alpha', rank=2)])]

        assert brands_of(sentiment_examples(rows, 'negative')[1]) == ['alpha', 'Beta']


class TestLimit:
    ROWS = [stored_answer(f'hotel {index:02}', 'openai', [stored_brand(f'Brand {index:02}')]) for index in range(25)]

    def test_returns_the_first_limit_examples(self) -> None:
        assert brands_of(sentiment_examples(self.ROWS, 'negative', limit=2)[1]) == ['Brand 00', 'Brand 01']

    def test_counts_every_example_beyond_the_limit(self) -> None:
        assert sentiment_examples(self.ROWS, 'negative', limit=2)[0] == 25

    def test_returns_twenty_examples_by_default(self) -> None:
        assert len(sentiment_examples(self.ROWS, 'negative')[1]) == 20


class TestProjection:
    def test_reads_an_answers_attributes_its_text_and_its_persona_name(self) -> None:
        assert (EXAMPLE_PROJECTION, EXAMPLE_ATTRIBUTE_NAMES) == (
            'keyword, #ts, provider, #st, query_prompt_id, brands, citations, #md.model, #rsp, query_prompt_name',
            {'#ts': 'timestamp', '#st': 'status', '#md': 'metadata', '#rsp': 'response'},
        )
