"""``/api/markets``: read, replace and localize keywords for the configured markets (2.37.0)."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from boto3.dynamodb.conditions import Attr

from shared.market_keywords import UnparseableSuggestionsError
from shared.market_proposal import InvalidProposalError
from shared.models import BedrockDeadlineError
from shared.request_deadline import Deadline
from testing.admin_authz_fixtures import caller_event, invoke
from testing.dynamodb_stubs import fake_table
from testing.handler_fixtures import handler_fixture
from testing.markets_fixtures import BRAZIL, CHILE, markets_item, valid_market
from testing.module_loader import API_DIR

markets_module = handler_fixture(
    API_DIR, 'manage-markets.py', 'manage_markets_under_test', scope='function',
    env={'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brand-config', 'DYNAMODB_TABLE_KEYWORDS': 'test-keywords', 'CORS_ORIGIN_PARAM': ''},
)

STORED = markets_item(CHILE, BRAZIL)
SUGGESTIONS = [{'market_id': 'cl-es', 'keyword': 'pasajes baratos a santiago'}]
PROPOSED = valid_market({
    'market_id': 'pe-es', 'country': 'PE', 'country_name': 'Peru', 'language': 'es-PE', 'language_name': 'Spanish',
    'currency': 'PEN', 'timezone': 'America/Lima', 'city': 'Lima', 'lat': -12.0464, 'lng': -77.0428,
})


class Call:
    """One request to the handler, with what it read, wrote and asked the model recorded."""

    def __init__(self, module, method: str, body=None, *, groups: str | None = 'Admin', stored: dict | None = STORED,
                 keywords_in_use: list[dict] | None = None, suggest: MagicMock | None = None,
                 propose: MagicMock | None = None, keywords: MagicMock | None = None,
                 deadline: Deadline | None = None) -> None:
        self.brand_config = fake_table(get_item={'Item': stored} if stored else {})
        self.keywords = keywords or fake_table(scan={'Items': keywords_in_use or []})
        self.suggest = suggest or MagicMock(return_value=SUGGESTIONS)
        self.propose = propose or MagicMock(return_value=PROPOSED)
        event = caller_event(method, '/api/markets', groups=groups, body=body, resource='/api/markets')
        budget = deadline or Deadline(25)
        with patch.multiple(module, brand_config_table=self.brand_config, keywords_table=self.keywords,
                            suggest_local_keywords=self.suggest, propose_market=self.propose,
                            current_deadline=MagicMock(return_value=budget)):
            self.status, self.body = invoke(module, event)

    @property
    def saved_item(self) -> dict:
        return self.brand_config.put_item.call_args.kwargs['Item']


def _drop_chile(module, *pages: dict, deadline: Deadline | None = None) -> tuple[Call, MagicMock]:
    """PUT the stored list without Chile, the Keywords scan answering ``pages`` in turn; the call and the scan."""
    keywords = fake_table()
    keywords.scan.side_effect = list(pages)
    return Call(module, 'PUT', {'markets': [BRAZIL]}, keywords=keywords, deadline=deadline), keywords.scan


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

    def test_scans_for_only_the_dropped_markets(self, markets_module):
        scan = Call(markets_module, 'PUT', {'markets': [BRAZIL]}).keywords.scan.call_args.kwargs

        assert (scan['ProjectionExpression'], scan['FilterExpression'].get_expression()) == (
            'market_id', {'operator': 'IN', 'format': '{0} {operator} {1}', 'values': (Attr('market_id'), ['cl-es'])},
        )

    def test_reads_no_keyword_when_the_list_drops_no_market(self, markets_module):
        call = Call(markets_module, 'PUT', {'markets': [BRAZIL, CHILE, PROPOSED.to_json()]})

        assert (call.status, call.keywords.scan.call_count) == (200, 0)

    def test_stops_scanning_once_every_dropped_market_is_found_in_use(self, markets_module):
        call, scan = _drop_chile(markets_module, {'Items': [{'market_id': 'cl-es'}], 'LastEvaluatedKey': {'id': 'k1'}})

        assert (call.status, call.body['market_ids'], scan.call_count) == (409, ['cl-es'], 1)

    def test_checks_a_stored_market_that_no_longer_validates(self, markets_module):
        call = Call(markets_module, 'PUT', {'markets': [BRAZIL]}, stored=markets_item(BRAZIL, {'market_id': 'broken'}),
                    keywords_in_use=[{'market_id': 'broken'}])

        assert (call.status, call.body['market_ids']) == (409, ['broken'])

    def test_answers_503_without_saving_when_the_check_runs_out_of_time(self, markets_module):
        call, _ = _drop_chile(markets_module, {'Items': [], 'LastEvaluatedKey': {'id': 'k1'}}, deadline=Deadline(0, lambda: 1.0))

        assert (call.status, call.body['error']) == (
            503, 'Could not check in time whether keywords still use the removed markets; nothing was saved, try again',
        )
        call.brand_config.put_item.assert_not_called()

    def test_reads_the_next_page_while_the_budget_lasts(self, markets_module):
        call, scan = _drop_chile(markets_module, {'Items': [], 'LastEvaluatedKey': {'id': 'k1'}}, {'Items': [{'market_id': 'cl-es'}]})

        assert (call.status, scan.call_args.kwargs['ExclusiveStartKey']) == (409, {'id': 'k1'})

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

    def test_bounds_the_model_call_by_the_request_deadline(self, markets_module):
        deadline = Deadline(20)
        call = Call(markets_module, 'POST', {'keyword': 'cheap flights', 'market_ids': ['cl-es']}, deadline=deadline)

        assert call.suggest.call_args.kwargs == {'deadline': deadline}


class TestProposeMarket:
    def test_answers_the_proposed_market_and_whether_its_id_is_taken(self, markets_module):
        call = Call(markets_module, 'POST', {'propose': {'country': 'PE', 'language': 'es', 'city': 'Lima'}})

        assert (call.status, call.body) == (200, {'market': PROPOSED.to_json(), 'market_id_taken': False})

    def test_flags_a_proposal_whose_id_a_configured_market_already_uses(self, markets_module):
        chile = valid_market({**CHILE, 'city': 'Valparaíso'})
        call = Call(markets_module, 'POST', {'propose': {'country': 'CL', 'language': 'es'}}, propose=MagicMock(return_value=chile))

        assert call.body['market_id_taken'] is True

    def test_asks_the_model_with_the_normalised_request_and_the_brand_config(self, markets_module):
        brand_config = {'config_id': 'default', 'tracked_brands': {'first_party': ['Altiplano Air'], 'competitors': []}}
        call = Call(markets_module, 'POST', {'propose': {'country': 'pe', 'language': 'ES', 'city': ' Lima '}}, stored=brand_config)

        assert call.propose.call_args.args == ({'country': 'PE', 'language': 'es', 'city': 'Lima'}, brand_config)

    @pytest.mark.parametrize('failure', [InvalidProposalError('timezone is not valid'), TimeoutError('slow')], ids=['invalid', 'call-failed'])
    def test_answers_502_when_the_model_cannot_describe_the_market(self, markets_module, failure):
        call = Call(markets_module, 'POST', {'propose': {'country': 'PE', 'language': 'es'}}, propose=MagicMock(side_effect=failure))

        assert (call.status, call.body) == (502, {'error': 'The model could not describe this market; fill the fields in by hand'})

    @pytest.mark.parametrize(('propose', 'error'), [
        pytest.param('PE', 'propose must be an object with country and language', id='not-an-object'),
        pytest.param({'country': 'PER', 'language': 'es'}, 'propose.country must be an ISO 3166-1 alpha-2 code', id='bad-country'),
        pytest.param({'country': 'PE'}, 'propose.language must be a BCP 47 language tag such as es or pt-BR', id='no-language'),
    ])
    def test_rejects_a_malformed_request_without_calling_the_model(self, markets_module, propose, error):
        call = Call(markets_module, 'POST', {'propose': propose})

        assert (call.status, call.body) == (400, {'error': error, 'field': 'propose'})
        call.propose.assert_not_called()

    def test_bounds_the_proposal_by_the_request_deadline(self, markets_module):
        deadline = Deadline(20)
        call = Call(markets_module, 'POST', {'propose': {'country': 'PE', 'language': 'es'}}, deadline=deadline)

        assert call.propose.call_args.kwargs == {'deadline': deadline}

    def test_a_body_without_propose_still_suggests_keywords(self, markets_module):
        call = Call(markets_module, 'POST', {'keyword': 'cheap flights', 'market_ids': ['cl-es']})

        assert (call.status, 'suggestions' in call.body) == (200, True)
        call.propose.assert_not_called()


class TestModelTimeBudget:
    @pytest.mark.parametrize(('body', 'model_call'), [
        pytest.param({'keyword': 'cheap flights', 'market_ids': ['cl-es']}, 'suggest', id='keyword-suggestions'),
        pytest.param({'propose': {'country': 'PE', 'language': 'es'}}, 'propose', id='market-proposal'),
    ])
    def test_answers_503_try_again_when_the_model_runs_out_of_time(self, markets_module, body, model_call):
        call = Call(markets_module, 'POST', body, **{model_call: MagicMock(side_effect=BedrockDeadlineError('slow'))})

        assert (call.status, call.body) == (503, {'error': 'The AI model did not answer in time; try again'})


class TestAdminGate:
    @pytest.mark.parametrize('method', ['PUT', 'POST'])
    def test_refuses_a_non_admin_without_touching_the_tables_or_the_model(self, markets_module, method):
        call = Call(markets_module, method, {'markets': []}, groups='Users')

        assert call.status == 403
        assert (call.brand_config.method_calls, call.keywords.method_calls, call.suggest.call_count) == ([], [], 0)
