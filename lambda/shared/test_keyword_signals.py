"""
Tests for shared.keyword_signals: Google expansion signals through SerpAPI
(related searches, People Also Ask, autocomplete) shaped as research
candidates. SerpAPI itself is stubbed at ``serpapi_search`` (async submit +
Search Archive, tested in ``test_serpapi.py``).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from shared import keyword_signals
from shared.serpapi import SerpApiError

_SEARCH_PAGE = {
    'related_searches': [{'query': 'Hotel Coruña Playa Riazor'}, {'query': 'hoteles baratos coruña'}],
    'related_questions': [{'question': '¿Cuál es la mejor zona para alojarse en Coruña?'}],
}
_AUTOCOMPLETE = {'suggestions': [{'value': 'hotel coruña centro'}, {'value': 'hoteles baratos coruña'}]}


def _serpapi(search=_SEARCH_PAGE, autocomplete=_AUTOCOMPLETE) -> MagicMock:
    return MagicMock(
        side_effect=lambda api_key, params, **_options: search if params['engine'] == 'google' else autocomplete,
    )


def _serpapi_calls(api_key: str, **fetch_kwargs: str) -> list:
    """The ``serpapi_search`` calls one ``fetch_google_signals(api_key, 'hotel coruña', ...)`` makes."""
    search = _serpapi()
    with patch.object(keyword_signals, 'serpapi_search', search):
        keyword_signals.fetch_google_signals(api_key, 'hotel coruña', **fetch_kwargs)
    return search.call_args_list


class TestFetchGoogleSignals:
    def test_collects_related_searches_questions_and_autocomplete_in_order(self):
        with patch.object(keyword_signals, 'serpapi_search', _serpapi()):
            candidates = keyword_signals.fetch_google_signals('key', 'hotel coruña', country='es', language='es')

        assert [(entry['keyword'], entry['source']) for entry in candidates] == [
            ('hotel coruña playa riazor', 'google related searches'),
            ('hoteles baratos coruña', 'google related searches'),
            ('¿cuál es la mejor zona para alojarse en coruña', 'people also ask'),
            ('hotel coruña centro', 'google autocomplete'),
        ]

    def test_candidates_carry_a_neutral_relevance_and_no_judged_intent(self):
        with patch.object(keyword_signals, 'serpapi_search', _serpapi()):
            first = keyword_signals.fetch_google_signals('key', 'hotel coruña')[0]

        assert (first['relevance'], first['intent'], first['competition']) == (5, '', '')

    def test_sends_the_market_and_language_to_both_engines(self):
        calls = _serpapi_calls('key', country='es', language='gl')

        engines = [(call.args[1]['engine'], call.args[1]['gl'], call.args[1]['hl'], call.args[1]['q']) for call in calls]
        assert engines == [('google', 'es', 'gl', 'hotel coruña'), ('google_autocomplete', 'es', 'gl', 'hotel coruña')]

    def test_passes_the_api_key_separately_from_the_search_parameters(self):
        calls = _serpapi_calls('serp-key')

        assert [(call.args[0], 'api_key' in call.args[1]) for call in calls] == [
            ('serp-key', False), ('serp-key', False),
        ]

    def test_waits_for_each_search_at_most_the_signals_deadline(self):
        calls = _serpapi_calls('key')

        assert [call.kwargs for call in calls] == [
            {'deadline_seconds': keyword_signals.SIGNALS_DEADLINE_SECONDS},
            {'deadline_seconds': keyword_signals.SIGNALS_DEADLINE_SECONDS},
        ]

    def test_asks_google_for_ten_results(self):
        assert _serpapi_calls('key')[0].args[1]['num'] == 10

    def test_tolerates_pages_without_the_signal_blocks(self):
        with patch.object(keyword_signals, 'serpapi_search', _serpapi(search={'organic_results': []}, autocomplete={})):
            assert keyword_signals.fetch_google_signals('key', 'hotel coruña') == []

    def test_caps_the_number_of_candidates_per_query(self):
        many = {'suggestions': [{'value': f'suggestion {index}'} for index in range(50)]}

        with patch.object(keyword_signals, 'serpapi_search', _serpapi(search={}, autocomplete=many)):
            candidates = keyword_signals.fetch_google_signals('key', 'q')

        assert len(candidates) == keyword_signals.MAX_SIGNALS_PER_QUERY

    def test_propagates_api_errors_to_the_caller(self):
        with (
            patch.object(keyword_signals, 'serpapi_search', MagicMock(side_effect=SerpApiError('SerpAPI HTTP 401: bad key'))),
            pytest.raises(SerpApiError, match='HTTP 401'),
        ):
            keyword_signals.fetch_google_signals('key', 'q')
