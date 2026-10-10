"""Tests for shared.market_proposal: the request check, the prompt, reading the model's market back, the Bedrock call."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from shared import market_proposal
from shared.market_proposal import (
    InvalidProposalError,
    UnparseableProposalError,
    default_market_id,
    market_from_proposal,
    proposal_prompt,
    propose_market,
    validate_proposal_request,
)

CHILE_REQUEST = {'country': 'CL', 'language': 'es', 'city': 'Santiago'}
BRAND_CONFIG = {
    'industry': 'airlines',
    'tracked_brands': {'first_party': ['Altiplano Air'], 'competitors': ['Condor Sur']},
}
MODEL_MARKET = {
    'country_name': 'Chile', 'language': 'es-CL', 'language_name': 'Spanish', 'currency': 'CLP',
    'timezone': 'America/Santiago', 'city': 'Santiago', 'region': 'Región Metropolitana', 'lat': -33.4489, 'lng': -70.6693,
    'name': 'Chile (Spanish)', 'competitors': ['Sky Andes', 'JetPuma'], 'first_party_aliases': ['Altiplano Chile'],
}


class TestValidateProposalRequest:
    def test_normalises_the_country_and_the_language_and_keeps_a_trimmed_city(self):
        request, error = validate_proposal_request({'country': 'cl', 'language': 'ES-cl', 'city': '  Santiago  de Chile '})

        assert (request, error) == ({'country': 'CL', 'language': 'es-cl', 'city': 'Santiago de Chile'}, None)

    def test_leaves_the_city_out_when_blank(self):
        request, _error = validate_proposal_request({'country': 'BR', 'language': 'pt', 'city': '   '})

        assert request == {'country': 'BR', 'language': 'pt'}

    @pytest.mark.parametrize(('raw', 'error'), [
        pytest.param(['CL'], 'propose must be an object with country and language', id='not-an-object'),
        pytest.param({'country': 'CHL', 'language': 'es'}, 'propose.country must be an ISO 3166-1 alpha-2 code', id='three-letter-country'),
        pytest.param({'country': 'CL'}, 'propose.language must be a BCP 47 language tag such as es or pt-BR', id='no-language'),
        pytest.param({'country': 'CL', 'language': 'spanish!'}, 'propose.language must be a BCP 47 language tag such as es or pt-BR',
                     id='bad-language'),
        pytest.param({'country': 'CL', 'language': 'es', 'city': 7}, 'propose.city must be a string', id='city-not-text'),
        pytest.param({'country': 'CL', 'language': 'es', 'city': 'x' * 81}, 'propose.city must be at most 80 characters', id='long-city'),
    ])
    def test_refuses_a_malformed_request(self, raw, error):
        assert validate_proposal_request(raw) == (None, error)


class TestDefaultMarketId:
    @pytest.mark.parametrize(('country', 'language', 'expected'), [
        ('CL', 'es', 'cl-es'),
        ('BR', 'pt-BR', 'br-pt'),
        ('US', 'en-US', 'us-en'),
    ])
    def test_joins_the_lower_case_country_and_primary_language(self, country, language, expected):
        assert default_market_id(country, language) == expected

    def test_never_yields_the_reserved_global_id(self):
        assert default_market_id('glo', 'bal') != 'global'


class TestProposalPrompt:
    def test_names_the_request_and_the_configured_brands(self):
        prompt = proposal_prompt(CHILE_REQUEST, BRAND_CONFIG)

        assert '"city": "Santiago"' in prompt
        assert '"first_party": ["Altiplano Air"]' in prompt
        assert '"competitors": ["Condor Sur"]' in prompt

    def test_wraps_the_request_and_the_brands_as_untrusted_input(self):
        prompt = proposal_prompt(CHILE_REQUEST, BRAND_CONFIG)

        assert prompt.count('<request>') == 1
        assert prompt.count('<brands>') == 1

    def test_copes_with_an_empty_brand_config(self):
        prompt = proposal_prompt({'country': 'BR', 'language': 'pt'}, {})

        assert '"first_party": []' in prompt


class TestMarketFromProposal:
    def test_reads_every_field_of_a_complete_proposal(self):
        market = market_from_proposal(MODEL_MARKET, CHILE_REQUEST)

        assert market.to_json() == {
            'market_id': 'cl-es', 'name': 'Chile (Spanish)', 'country': 'CL', 'country_name': 'Chile', 'language': 'es-CL',
            'language_name': 'Spanish', 'currency': 'CLP', 'timezone': 'America/Santiago', 'city': 'Santiago',
            'region': 'Región Metropolitana', 'lat': -33.4489, 'lng': -70.6693,
            'competitors': ['Sky Andes', 'JetPuma'], 'first_party_aliases': ['Altiplano Chile'],
        }

    def test_the_requests_country_and_city_win_over_the_models(self):
        market = market_from_proposal({**MODEL_MARKET, 'country': 'AR', 'city': 'Valparaíso'}, CHILE_REQUEST)

        assert (market.country, market.city) == ('CL', 'Santiago')

    def test_keeps_the_requested_language_when_the_model_changes_it(self):
        market = market_from_proposal({**MODEL_MARKET, 'language': 'pt-BR'}, CHILE_REQUEST)

        assert market.language == 'es'

    def test_uses_the_models_city_when_the_request_names_none(self):
        market = market_from_proposal(MODEL_MARKET, {'country': 'CL', 'language': 'es'})

        assert market.city == 'Santiago'

    def test_drops_the_optional_fields_when_only_they_fail_to_validate(self):
        market = market_from_proposal({**MODEL_MARKET, 'lat': 123.0, 'competitors': ['x' * 101]}, CHILE_REQUEST)

        assert (market.lat, market.competitors, market.timezone) == (None, (), 'America/Santiago')

    def test_refuses_a_proposal_whose_facts_do_not_validate(self):
        with pytest.raises(InvalidProposalError, match='timezone'):
            market_from_proposal({**MODEL_MARKET, 'timezone': 'CLT'}, CHILE_REQUEST)


class TestProposeMarket:
    def test_asks_the_analysis_role_once_and_returns_the_validated_market(self):
        with patch.object(market_proposal, 'invoke_bedrock', return_value=json.dumps(MODEL_MARKET)) as bedrock:
            market = propose_market(CHILE_REQUEST, BRAND_CONFIG)

        assert (bedrock.call_count, bedrock.call_args.args[1].name, market.currency) == (1, 'ANALYSIS', 'CLP')

    def test_reads_a_fenced_json_answer(self):
        with patch.object(market_proposal, 'invoke_bedrock', return_value=f'```json\n{json.dumps(MODEL_MARKET)}\n```'):
            assert propose_market(CHILE_REQUEST, BRAND_CONFIG).timezone == 'America/Santiago'

    def test_raises_when_the_answer_holds_no_json_object(self):
        with patch.object(market_proposal, 'invoke_bedrock', return_value='Sorry, I cannot help.'), \
             pytest.raises(UnparseableProposalError):
            propose_market(CHILE_REQUEST, BRAND_CONFIG)
