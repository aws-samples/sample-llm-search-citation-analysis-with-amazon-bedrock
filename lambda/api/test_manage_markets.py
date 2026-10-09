"""``/api/markets``: read, replace and localize keywords for the configured markets (2.37.0)."""

from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from shared.market_keywords import UnparseableSuggestionsError
from testing.admin_authz_fixtures import caller_event, invoke
from testing.dynamodb_stubs import fake_table
from testing.handler_fixtures import handler_fixture
from testing.markets_fixtures import BRAZIL, CHILE, markets_item

markets_module = handler_fixture(
    os.path.dirname(os.path.abspath(__file__)), 'manage-markets.py', 'manage_markets_under_test', scope='function',
    env={'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brand-config', 'DYNAMODB_TABLE_KEYWORDS': 'test-keywords', 'CORS_ORIGIN_PARAM': ''},
)

STORED = markets_item(CHILE, BRAZIL)
SUGGESTIONS = [{'market_id': 'cl-es', 'keyword': 'pasajes baratos a santiago'}]


class Call:
    """One request to the handler, with what it read, wrote and asked the model recorded."""

    def __init__(self, module, method: str, body=None, *, groups: str | None = 'Admin', stored: dict | None = STORED,
                 keywords_in_use: list[dict] | None = None, suggest: MagicMock | None = None) -> None:
        self.brand_config = fake_table(get_item={'Item': stored} if stored else {})
        self.keywords = fake_table(scan={'Items': keywords_in_use or []})
        self.suggest = suggest or MagicMock(return_value=SUGGESTIONS)
        event = caller_event(method, '/api/markets', groups=groups, body=body, resource='/api/markets')
        with patch.multiple(module, brand_config_table=self.brand_config, keywords_table=self.keywords,
                            suggest_local_keywords=self.suggest):
            self.status, self.body = invoke(module, event)

    @property
    def saved_item(self) -> dict:
        return self.brand_config.put_item.call_args.kwargs['Item']


class TestGetMarkets:
    def test_answers_the_market_list_and_its_save_time(self, markets_module):
        call = Call(markets_module, 'GET', groups='Users', stored=markets_item(BRAZIL))

        assert (call.status, call.body) == (200, {'markets': [BRAZIL], 'updated_at': '2026-10-01T09:00:00Z'})

    def test_answers_coordinates_as_numbers(self, markets_module):
        call = Call(markets_module, 'GET', groups=None, stored=markets_item({**CHILE, 'lat': Decimal('-33.45'), 'lng': Decimal('-70.66')}))

        assert (call.body['markets'][0]['lat'], call.body['markets'][0]['lng']) == (-33.45, -70.66)

    def test_answers_an_empty_list_before_any_market_is_saved(self, markets_module):
        call = Call(markets_module, 'GET', stored=None)

        assert call.body == {'markets': [], 'updated_at': None}

    def test_skips_an_invalid_stored_market(self, markets_module):
        call = Call(markets_module, 'GET', stored=markets_item(BRAZIL, {'market_id': 'broken'}))

        assert [market['market_id'] for market in call.body['markets']] == ['br-pt']


class TestPutMarkets:
    def test_saves_the_whole_list_as_the_markets_item(self, markets_module):
        call = Call(markets_module, 'PUT', {'markets': [BRAZIL]}, stored=None)

        assert (call.saved_item['config_id'], call.saved_item['markets']) == ('markets', [BRAZIL])

    def test_stores_coordinates_as_decimals(self, markets_module):
        call = Call(markets_module, 'PUT', {'markets': [CHILE]}, stored=None)

        assert call.saved_item['markets'][0]['lat'] == Decimal('-33.45')

    def test_answers_the_saved_list_and_its_save_time(self, markets_module):
        call = Call(markets_module, 'PUT', {'markets': [BRAZIL, CHILE]}, stored=None)

        assert [market['market_id'] for market in call.body['markets']] == ['br-pt', 'cl-es']
        assert call.body['updated_at'] == call.saved_item['updated_at']

    def test_accepts_an_empty_list_when_no_keyword_uses_a_market(self, markets_module):
        call = Call(markets_module, 'PUT', {'markets': []})

        assert (call.status, call.body['markets']) == (200, [])

    @pytest.mark.parametrize(('body', 'error'), [
        pytest.param({}, 'markets must be a list', id='missing'),
        pytest.param({'markets': [{**BRAZIL, 'country': 'Brazil'}]}, 'Market 1: country is not valid', id='bad-country'),
        pytest.param({'markets': [BRAZIL, BRAZIL]}, "Market 2: market_id 'br-pt' is used twice", id='duplicate'),
        pytest.param({'markets': [{**BRAZIL, 'market_id': 'global'}]}, "Market 1: market_id 'global' is reserved", id='reserved'),
    ])
    def test_rejects_an_invalid_list_on_the_markets_field_without_saving(self, markets_module, body, error):
        call = Call(markets_module, 'PUT', body)

        assert (call.status, call.body) == (400, {'error': error, 'field': 'markets'})
        call.brand_config.put_item.assert_not_called()

    def test_refuses_to_drop_a_market_keywords_still_use(self, markets_module):
        in_use = [{'id': 'k1', 'market_id': 'cl-es'}, {'id': 'k2', 'market_id': 'br-pt'}]

        call = Call(markets_module, 'PUT', {'markets': [BRAZIL]}, keywords_in_use=in_use)

        assert (call.status, call.body) == (409, {
            'error': 'Keywords still use market(s) cl-es; move or delete those keywords first', 'market_ids': ['cl-es'],
        })
        call.brand_config.put_item.assert_not_called()

    def test_scans_only_keywords_that_carry_a_market(self, markets_module):
        scan = Call(markets_module, 'PUT', {'markets': [BRAZIL]}).keywords.scan.call_args.kwargs

        assert (scan['ProjectionExpression'], scan['FilterExpression'].get_expression()['operator']) == ('#id, market_id', 'attribute_exists')

    @pytest.mark.parametrize('method', ['PUT', 'POST'])
    def test_rejects_a_non_object_body(self, markets_module, method):
        call = Call(markets_module, method, [BRAZIL])

        assert (call.status, call.body['field']) == (400, 'body')


class TestSuggestKeywords:
    def test_answers_the_suggestions(self, markets_module):
        call = Call(markets_module, 'POST', {'keyword': 'cheap flights to santiago', 'market_ids': ['cl-es']})

        assert (call.status, call.body) == (200, {'suggestions': SUGGESTIONS})

    def test_asks_for_the_trimmed_keyword_in_the_requested_markets_in_order(self, markets_module):
        call = Call(markets_module, 'POST', {'keyword': ' cheap flights ', 'market_ids': ['br-pt', 'cl-es', 'br-pt']})

        keyword, markets = call.suggest.call_args.args
        assert (keyword, [market.market_id for market in markets]) == ('cheap flights', ['br-pt', 'cl-es'])

    @pytest.mark.parametrize('failure', [UnparseableSuggestionsError('no JSON'), TimeoutError('slow')], ids=['no-json', 'call-failed'])
    def test_answers_502_when_the_model_fails(self, markets_module, failure):
        call = Call(markets_module, 'POST', {'keyword': 'cheap flights', 'market_ids': ['cl-es']}, suggest=MagicMock(side_effect=failure))

        assert (call.status, call.body) == (502, {'error': 'The model could not suggest keywords; try again'})

    @pytest.mark.parametrize(('body', 'field', 'error'), [
        pytest.param({'market_ids': ['cl-es']}, 'keyword', 'Keyword must be a string', id='no-keyword'),
        pytest.param({'keyword': '  ', 'market_ids': ['cl-es']}, 'keyword', 'Keyword must not be empty', id='blank-keyword'),
        pytest.param({'keyword': 'k', 'market_ids': []}, 'market_ids', 'market_ids must be a non-empty array of market ids', id='none'),
        pytest.param({'keyword': 'k', 'market_ids': 'cl-es'}, 'market_ids', 'market_ids must be a non-empty array of market ids', id='string'),
        pytest.param({'keyword': 'k', 'market_ids': ['cl-es', 'fr-fr', 'global']}, 'market_ids', 'Unknown market_ids: fr-fr, global',
                     id='unknown'),
        pytest.param({'keyword': 'k', 'market_ids': [f'm{index:02d}' for index in range(11)]}, 'market_ids',
                     'market_ids accepts at most 10 markets', id='too-many'),
    ])
    def test_rejects_an_invalid_request_without_calling_the_model(self, markets_module, body, field, error):
        call = Call(markets_module, 'POST', body)

        assert (call.status, call.body) == (400, {'error': error, 'field': field})
        call.suggest.assert_not_called()

    def test_counts_a_repeated_market_once_against_the_cap(self, markets_module):
        assert Call(markets_module, 'POST', {'keyword': 'cheap flights', 'market_ids': ['cl-es'] * 11}).status == 200


class TestAdminGate:
    @pytest.mark.parametrize('method', ['PUT', 'POST'])
    def test_refuses_a_non_admin_without_touching_the_tables_or_the_model(self, markets_module, method):
        call = Call(markets_module, method, {'markets': []}, groups='Users')

        assert call.status == 403
        assert (call.brand_config.method_calls, call.keywords.method_calls, call.suggest.call_count) == ([], [], 0)
