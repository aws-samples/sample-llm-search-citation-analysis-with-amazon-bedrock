"""
Tests for shared.keyword_signals: Google expansion signals through SerpAPI
(related searches, People Also Ask, autocomplete) shaped as research
candidates.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

_LAMBDA_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)
_LAYER_PY = os.path.join(_LAMBDA_DIR, 'layer', 'python')
if os.path.isdir(_LAYER_PY) and _LAYER_PY not in sys.path:
    sys.path.append(_LAYER_PY)

from shared import keyword_signals

_SEARCH_PAGE = {
    'related_searches': [{'query': 'Hotel Coruña Playa Riazor'}, {'query': 'hoteles baratos coruña'}],
    'related_questions': [{'question': '¿Cuál es la mejor zona para alojarse en Coruña?'}],
}
_AUTOCOMPLETE = {'suggestions': [{'value': 'hotel coruña centro'}, {'value': 'hoteles baratos coruña'}]}


def _serpapi(search=_SEARCH_PAGE, autocomplete=_AUTOCOMPLETE) -> MagicMock:
    return MagicMock(side_effect=lambda params: search if params['engine'] == 'google' else autocomplete)


class TestFetchGoogleSignals:
    def test_collects_related_searches_questions_and_autocomplete_in_order(self):
        with patch.object(keyword_signals, '_serpapi_get', _serpapi()):
            candidates = keyword_signals.fetch_google_signals('key', 'hotel coruña', country='es', language='es')

        assert [(entry['keyword'], entry['source']) for entry in candidates] == [
            ('hotel coruña playa riazor', 'google related searches'),
            ('hoteles baratos coruña', 'google related searches'),
            ('¿cuál es la mejor zona para alojarse en coruña', 'people also ask'),
            ('hotel coruña centro', 'google autocomplete'),
        ]

    def test_candidates_carry_a_neutral_relevance_and_no_judged_intent(self):
        with patch.object(keyword_signals, '_serpapi_get', _serpapi()):
            first = keyword_signals.fetch_google_signals('key', 'hotel coruña')[0]

        assert (first['relevance'], first['intent'], first['competition']) == (5, '', '')

    def test_sends_the_market_and_language_to_both_engines(self):
        get = _serpapi()

        with patch.object(keyword_signals, '_serpapi_get', get):
            keyword_signals.fetch_google_signals('key', 'hotel coruña', country='es', language='gl')

        engines = [(call.args[0]['engine'], call.args[0]['gl'], call.args[0]['hl'], call.args[0]['q']) for call in get.call_args_list]
        assert engines == [('google', 'es', 'gl', 'hotel coruña'), ('google_autocomplete', 'es', 'gl', 'hotel coruña')]

    def test_tolerates_pages_without_the_signal_blocks(self):
        with patch.object(keyword_signals, '_serpapi_get', _serpapi(search={'organic_results': []}, autocomplete={})):
            assert keyword_signals.fetch_google_signals('key', 'hotel coruña') == []

    def test_caps_the_number_of_candidates_per_query(self):
        many = {'suggestions': [{'value': f'suggestion {index}'} for index in range(50)]}

        with patch.object(keyword_signals, '_serpapi_get', _serpapi(search={}, autocomplete=many)):
            candidates = keyword_signals.fetch_google_signals('key', 'q')

        assert len(candidates) == keyword_signals.MAX_SIGNALS_PER_QUERY

    def test_propagates_api_errors_to_the_caller(self):
        class SerpApiError(Exception):
            pass

        with (
            patch.object(keyword_signals, '_serpapi_get', MagicMock(side_effect=SerpApiError('401'))),
            pytest.raises(SerpApiError),
        ):
            keyword_signals.fetch_google_signals('key', 'q')
