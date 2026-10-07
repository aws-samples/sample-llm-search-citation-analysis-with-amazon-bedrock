"""Tests for the narrative's language, its validation against the computed insights, and its storage."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared.insights_narrative import (
    detect_language,
    group_scope_key,
    keyword_language,
    load_narrative,
    narrative_item,
    validate_narrative,
    written_numbers,
)
from testing.dynamodb_stubs import fake_table
from testing.report_insights_fixtures import (
    ENGINE_INSIGHT_ID,
    GROUP_KPIS,
    RUN_TIMESTAMP,
    SUBBRAND_INSIGHT_ID,
    engine_insight,
    insight_item,
    model_narrative,
    recommendation_item,
    stored_item,
    subbrand_insight,
)

_INSIGHTS = [engine_insight(), subbrand_insight()]


def _kept_insights(*items: object) -> list[dict]:
    return _kept_against(_INSIGHTS, GROUP_KPIS, *items)


def _kept_against(insights: list[dict], kpis: dict, *items: object) -> list[dict]:
    """The insight items `validate_narrative` keeps out of `items`, checked against `insights` and `kpis`."""
    return validate_narrative(model_narrative(list(items)), insights, kpis)[0]['insights']


class TestLanguage:
    @pytest.mark.parametrize(('keyword', 'language'), [
        ('vuelos baratos a lima', 'es'),
        ('mejor aerolínea de sudamérica', 'es'),
        ('passagens aéreas baratas', 'pt'),
        ('melhor companhia aérea do brasil', 'pt'),
        ('cheap flights to lima', 'en'),
        ('best airline in south america', 'en'),
        ('vols pas cher pour paris', 'fr'),
        ('meilleure compagnie aérienne', 'fr'),
        ('günstige flüge nach berlin', 'de'),
        ('beste fluggesellschaft', 'de'),
    ])
    def test_detects_the_language_of_a_search_keyword(self, keyword: str, language: str) -> None:
        assert detect_language(keyword) == language

    @pytest.mark.parametrize('keyword', ['Aurora', 'tarifas de', '123'])
    def test_detects_no_language_when_no_single_language_leads(self, keyword: str) -> None:
        assert detect_language(keyword) is None

    def test_picks_the_language_most_keywords_are_written_in(self) -> None:
        assert keyword_language(['vuelos baratos a lima', 'mejor aerolínea de sudamérica', 'cheap flights to lima']) == 'es'

    def test_ignores_keywords_whose_language_cannot_be_told(self) -> None:
        assert keyword_language(['Aurora', 'Borealis', 'passagens aéreas baratas']) == 'pt'

    def test_falls_back_to_english_when_no_language_has_a_majority(self) -> None:
        assert keyword_language(['vuelos baratos', 'passagens baratas', 'vols pas cher', 'günstige flüge']) == 'en'

    def test_falls_back_to_english_when_no_keyword_can_be_told(self) -> None:
        assert keyword_language(['Aurora', 'Borealis']) == 'en'

    def test_falls_back_to_english_for_no_keywords(self) -> None:
        assert keyword_language([]) == 'en'


class TestWrittenNumbers:
    def test_reads_integers_decimals_and_percentages(self) -> None:
        assert written_numbers('62.5% of 16 answers, 12,5 points') == ['62.5', '16', '12,5']

    def test_leaves_out_four_digit_years(self) -> None:
        assert written_numbers('In 2026 the share rose to 40%') == ['40']

    def test_leaves_out_the_digits_of_the_top_kpi_names(self) -> None:
        assert written_numbers('The top-1 share and top 3 share stayed at 25') == ['25']


class TestNumberValidation:
    def test_keeps_an_item_whose_numbers_are_in_its_evidence(self) -> None:
        item = insight_item('OpenAI ranks Aurora Airways first in 62.5% of 16 answers.')

        assert _kept_insights(item) == [item]

    def test_keeps_an_item_whose_numbers_are_in_the_kpis(self) -> None:
        item = insight_item('Across 40 answers the mention rate is 72.5%.')

        assert _kept_insights(item) == [item]

    @pytest.mark.parametrize('text', ['Ranked first in 63% of answers.', 'Ranked first in 62,5% of answers.', 'Cited in 12.50%.'])
    def test_keeps_a_number_written_to_another_precision(self, text: str) -> None:
        assert _kept_insights(insight_item(text)) == [insight_item(text)]

    def test_drops_an_item_rounding_a_number_wrongly(self) -> None:
        assert _kept_insights(insight_item('Ranked first in 62% of answers.')) == []

    def test_drops_an_item_stating_a_number_absent_from_the_facts(self) -> None:
        assert _kept_insights(insight_item('OpenAI cites the brand in 50% of answers.')) == []

    def test_drops_an_item_stating_a_computed_difference(self) -> None:
        assert _kept_insights(insight_item('The ranking beats citations by 50 points.')) == []

    def test_drops_an_item_using_evidence_of_an_insight_it_does_not_cite(self) -> None:
        assert _kept_insights(insight_item('Aurora Miles trails by 3.25 places.', ENGINE_INSIGHT_ID)) == []

    def test_keeps_an_item_using_evidence_of_every_insight_it_cites(self) -> None:
        item = insight_item('OpenAI answers 16 times; Aurora Miles trails by 3.25 places.', ENGINE_INSIGHT_ID, SUBBRAND_INSIGHT_ID)

        assert _kept_insights(item) == [item]

    def test_keeps_a_negative_number_whose_magnitude_is_in_the_evidence(self) -> None:
        item = insight_item('Position moved by -1.5.')

        assert _kept_against([engine_insight(position_change=-1.5)], {}, item) == [item]

    def test_keeps_a_year_that_is_in_no_evidence(self) -> None:
        item = insight_item('In 2026 OpenAI ranks the brand first in 62.5% of answers.')

        assert _kept_insights(item) == [item]

    def test_keeps_digits_that_name_the_cited_subject(self) -> None:
        insights = [{**engine_insight(), 'id': 'unstable_keyword:hotel 5 estrellas', 'subject': 'hotel 5 estrellas'}]
        item = insight_item('El keyword hotel 5 estrellas es inestable.', 'unstable_keyword:hotel 5 estrellas')

        assert _kept_against(insights, {}, item) == [item]

    def test_checks_the_numbers_of_a_recommendation_title(self) -> None:
        item = recommendation_item('Publish fare pages.', title='Lift citations to 30%')

        assert validate_narrative(model_narrative(recommendations=[item]), _INSIGHTS, GROUP_KPIS)[0]['recommendations'] == []


class TestIdValidation:
    def test_drops_an_item_citing_an_unknown_insight(self) -> None:
        assert _kept_insights(insight_item('OpenAI answers 16 times.', 'engine_play:claude')) == []

    def test_drops_an_item_citing_no_insight(self) -> None:
        assert _kept_insights({'text': 'OpenAI answers 16 times.', 'insight_ids': []}) == []

    def test_keeps_each_cited_id_once(self) -> None:
        item = insight_item('OpenAI answers 16 times.', ENGINE_INSIGHT_ID, ENGINE_INSIGHT_ID)

        assert _kept_insights(item) == [insight_item('OpenAI answers 16 times.', ENGINE_INSIGHT_ID)]


class TestNarrativeShape:
    def test_counts_every_dropped_item(self) -> None:
        narrative = model_narrative(
            [insight_item('Cited in 99%.'), insight_item('OpenAI answers 16 times.')],
            [recommendation_item('Cite 7 pages.'), recommendation_item('Publish fare pages.')],
        )

        assert validate_narrative(narrative, _INSIGHTS, GROUP_KPIS)[1] == 2

    def test_keeps_at_most_three_insights_and_counts_the_rest_as_dropped(self) -> None:
        items = [insight_item(f'OpenAI answers 16 times ({label}).') for label in 'abcde']

        kept, dropped = validate_narrative(model_narrative(items), _INSIGHTS, GROUP_KPIS)

        assert (len(kept['insights']), dropped) == (3, 2)

    def test_keeps_at_most_six_recommendations(self) -> None:
        items = [recommendation_item(f'Publish fare pages ({label}).') for label in 'abcdefgh']

        assert len(validate_narrative(model_narrative(recommendations=items), _INSIGHTS, GROUP_KPIS)[0]['recommendations']) == 6

    def test_drops_a_recommendation_without_a_title(self) -> None:
        item = {'text': 'Publish fare pages.', 'insight_ids': [ENGINE_INSIGHT_ID]}

        assert validate_narrative(model_narrative(recommendations=[item]), _INSIGHTS, GROUP_KPIS) == (
            {'insights': [], 'recommendations': []}, 1,
        )

    @pytest.mark.parametrize('item', ['text only', {'text': '', 'insight_ids': [ENGINE_INSIGHT_ID]}, {'insight_ids': [ENGINE_INSIGHT_ID]}])
    def test_drops_a_malformed_item(self, item: object) -> None:
        assert _kept_insights(item) == []

    @pytest.mark.parametrize('narrative', [None, [], 'prose', {'insights': 'none'}])
    def test_reads_a_narrative_that_is_not_an_object_of_lists_as_empty(self, narrative: object) -> None:
        assert validate_narrative(narrative, _INSIGHTS, GROUP_KPIS) == ({'insights': [], 'recommendations': []}, 0)


class TestStorage:
    def test_keys_a_group_narrative_by_its_group(self) -> None:
        assert group_scope_key('group-coruna') == 'group#group-coruna'

    def test_builds_the_item_with_the_kpi_snapshot_ttl(self) -> None:
        item = narrative_item(
            scope_key='group#group-coruna',
            run_timestamp=RUN_TIMESTAMP,
            narrative={'insights': [], 'recommendations': []},
            model='model-id',
            language='es',
            dropped=0,
            generated_at='2026-10-07T06:55:00.000000Z',
        )

        assert (item['scope_key'], item['run_timestamp'], item['ttl']) == ('group#group-coruna', RUN_TIMESTAMP, 1822891833)

    def test_reads_the_stored_narrative_of_the_run(self) -> None:
        table = fake_table(get_item={'Item': stored_item(dropped=Decimal('1'))})

        narrative = load_narrative('group#group-coruna', RUN_TIMESTAMP, table=table)

        assert narrative == {
            'run_timestamp': RUN_TIMESTAMP,
            'model': 'global.anthropic.claude-sonnet-4-6',
            'generated_at': '2026-10-07T06:55:00.000000Z',
            'language': 'es',
            'insights': [insight_item('OpenAI ranks Aurora Airways first in 62.5% of answers.')],
            'recommendations': [recommendation_item('Publish fare pages OpenAI can cite.')],
            'dropped': 1,
        }
        table.get_item.assert_called_once_with(Key={'scope_key': 'group#group-coruna', 'run_timestamp': RUN_TIMESTAMP})

    def test_reads_none_when_the_run_has_no_narrative(self) -> None:
        assert load_narrative('group#group-coruna', RUN_TIMESTAMP, table=fake_table(get_item={})) is None

    def test_reads_none_for_a_scope_without_a_run_without_reading(self) -> None:
        table = MagicMock()

        assert load_narrative('group#group-coruna', None, table=table) is None
        table.get_item.assert_not_called()

    def test_reads_none_when_the_read_fails(self) -> None:
        table = MagicMock()
        table.get_item.side_effect = ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'slow'}}, 'GetItem')

        assert load_narrative('group#group-coruna', RUN_TIMESTAMP, table=table) is None

    def test_reads_none_where_the_table_is_not_configured(self) -> None:
        with patch.dict('os.environ', {}, clear=True):
            assert load_narrative('group#group-coruna', RUN_TIMESTAMP) is None

    def test_reads_the_configured_table(self) -> None:
        table = fake_table(get_item={})
        resource = MagicMock()
        resource.Table.return_value = table

        with (
            patch.dict('os.environ', {'DYNAMODB_TABLE_REPORT_INSIGHTS': 'report-insights'}),
            patch('shared.insights_narrative.get_dynamodb_resource', return_value=resource),
        ):
            load_narrative('group#group-coruna', RUN_TIMESTAMP)

        resource.Table.assert_called_once_with('report-insights')
