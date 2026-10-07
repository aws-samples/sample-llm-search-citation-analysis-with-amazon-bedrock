"""
Tests for competitor domains in manage-brand-config.py.

Brand config carries ``competitor_domains: {competitor name: [domain, ...]}``.
``_save_config`` normalises each domain like ``first_party_domains`` and
refuses, with a 400 naming the field, a value that is not a map of tracked
competitors to at most ten hostnames, or that lists more than fifty
competitors. ``find_competitors`` asks the model for each competitor's
domains and returns them, normalised, as suggestions.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest
import test_manage_brand_config_fixtures as brand_config_fixtures

from testing.events import api_gateway_event, parse_response

_mod = brand_config_fixtures.load_brand_config_module('manage_brand_config_competitor_domains_under_test')

_COMPETITORS = ['Borealis Air', 'Cielo Wings']


@pytest.fixture
def saved(monkeypatch) -> MagicMock:
    """Stand-in for the DynamoDB write; echoes the config it is given."""
    stub = MagicMock(side_effect=lambda config: config)
    monkeypatch.setattr(_mod, 'save_config', stub)
    return stub


def post_config(extra: dict[str, Any]) -> tuple[int, Any]:
    """``(status, body)`` of an admin POST /api/brand-config tracking ``_COMPETITORS``, with ``extra`` in the body."""
    body = {'industry': 'general', 'tracked_brands': {'first_party': ['Aurora Airways'], 'competitors': _COMPETITORS}, **extra}
    event = api_gateway_event('POST', '/api/brand-config', body=body, claims={'cognito:groups': _mod.ADMIN_GROUP})
    return parse_response(_mod.handler(event, None))


class TestSave:
    def test_saves_domains_normalised_like_owned_domains_without_repeats(self, saved) -> None:
        post_config({'competitor_domains': {'Borealis Air': ['https://www.Borealis-Air.com/', 'borealis-air.com', 'fly.borealis.example.:443']}})

        assert saved.call_args.args[0]['competitor_domains'] == {'Borealis Air': ['borealis-air.com', 'fly.borealis.example']}

    def test_saves_an_empty_map_when_the_body_has_no_competitor_domains(self, saved) -> None:
        status, _body = post_config({})

        assert (status, saved.call_args.args[0]['competitor_domains']) == (200, {})

    def test_drops_a_competitor_whose_domain_list_is_empty(self, saved) -> None:
        post_config({'competitor_domains': {'Borealis Air': [], 'Cielo Wings': ['cielo-wings.example']}})

        assert saved.call_args.args[0]['competitor_domains'] == {'Cielo Wings': ['cielo-wings.example']}

    def test_accepts_ten_domains_for_one_competitor(self, saved) -> None:
        domains = [f'site{index}.borealis.example' for index in range(10)]

        status, _body = post_config({'competitor_domains': {'Borealis Air': domains}})

        assert (status, saved.call_args.args[0]['competitor_domains']['Borealis Air']) == (200, domains)

    def test_counts_repeated_domains_once_against_the_ten_domain_cap(self, saved) -> None:
        domains = [f'site{index}.borealis.example' for index in range(10)] + ['www.site0.borealis.example']

        status, _body = post_config({'competitor_domains': {'Borealis Air': domains}})

        assert status == 200


class TestRefusal:
    @pytest.mark.parametrize(('competitor_domains', 'error'), [
        pytest.param(
            ['borealis-air.com'],
            'competitor_domains must map competitor names to lists of domains',
            id='not-a-map',
        ),
        pytest.param(
            {'Nimbus Jet': ['nimbus.example']},
            "competitor_domains names 'Nimbus Jet', which is not a tracked competitor",
            id='unknown-competitor',
        ),
        pytest.param(
            {'Borealis Air': 'borealis-air.com'},
            "competitor_domains for 'Borealis Air' must be a list of domains",
            id='domains-not-a-list',
        ),
        pytest.param(
            {'Borealis Air': ['borealis air.com']},
            "competitor_domains for 'Borealis Air' contains a value that is not a domain",
            id='domain-with-a-space',
        ),
        pytest.param(
            {'Borealis Air': ['   ']},
            "competitor_domains for 'Borealis Air' contains a value that is not a domain",
            id='blank-domain',
        ),
        pytest.param(
            {'Borealis Air': [7]},
            "competitor_domains for 'Borealis Air' contains a value that is not a domain",
            id='non-text-domain',
        ),
        pytest.param(
            {'Borealis Air': [f'site{index}.borealis.example' for index in range(11)]},
            "competitor_domains for 'Borealis Air' lists more than 10 domains",
            id='eleven-domains',
        ),
    ])
    def test_rejects_invalid_competitor_domains_naming_the_field(self, saved, competitor_domains, error) -> None:
        status, body = post_config({'competitor_domains': competitor_domains})

        assert (status, body) == (400, {'error': error, 'field': 'competitor_domains'})
        saved.assert_not_called()

    def test_rejects_more_than_fifty_competitors(self, saved) -> None:
        many = {f'Rival {index}': ['rival.example'] for index in range(51)}

        status, body = post_config({'competitor_domains': many})

        assert (status, body['error']) == (400, 'competitor_domains lists more than 50 competitors')


def stored_competitor_domains(monkeypatch, stored: dict[str, Any]) -> object:
    """The ``competitor_domains`` GET /api/brand-config answers when ``stored`` is the saved config."""
    monkeypatch.setattr(_mod, 'get_config', lambda: stored)
    return parse_response(_mod._get_config(api_gateway_event('GET', '/api/brand-config'), None))[1]['competitor_domains']


def suggested_details(monkeypatch, competitors: list[object]) -> list[Any]:
    """The ``competitor_details`` find_competitors returns when the model names ``competitors``."""
    brand_config_fixtures.capture_prompts(monkeypatch, _mod, answer=json.dumps({'competitors': competitors}))
    return _mod.find_competitors(['Aurora Airways'], 'general', [])['competitor_details']


class TestRead:
    @pytest.mark.parametrize(('stored', 'expected'), [
        pytest.param({'config_id': 'default'}, {}, id='saved-before-competitor-domains'),
        pytest.param(
            {'config_id': 'default', 'competitor_domains': {'Borealis Air': ['borealis-air.com']}},
            {'Borealis Air': ['borealis-air.com']},
            id='stored-domains',
        ),
    ])
    def test_reads_the_stored_competitor_domains_or_an_empty_map(self, monkeypatch, stored, expected) -> None:
        assert stored_competitor_domains(monkeypatch, stored) == expected

    def test_defaults_carry_an_empty_competitor_domains_map(self) -> None:
        assert _mod._default_config()['competitor_domains'] == {}


class TestSuggestions:
    def test_returns_each_competitors_domains_normalised(self, monkeypatch) -> None:
        entry = {'name': 'Borealis Air', 'reason': 'same routes', 'domains': ['https://www.Borealis-Air.com/', 'borealis-air.com']}

        assert suggested_details(monkeypatch, [entry]) == [{'name': 'Borealis Air', 'reason': 'same routes', 'domains': ['borealis-air.com']}]

    @pytest.mark.parametrize(('entry', 'expected'), [
        pytest.param({'name': 'Borealis Air'}, [], id='no-domains-key'),
        pytest.param({'name': 'Borealis Air', 'domains': 'borealis-air.com'}, [], id='domains-not-a-list'),
        pytest.param({'name': 'Borealis Air', 'domains': ['not a domain', 7, '']}, [], id='no-hostnames'),
        pytest.param(
            {'name': 'Borealis Air', 'domains': [f'site{index}.borealis.example' for index in range(12)]},
            [f'site{index}.borealis.example' for index in range(10)],
            id='at-most-ten',
        ),
    ])
    def test_suggests_only_usable_hostnames_up_to_ten(self, monkeypatch, entry, expected) -> None:
        assert suggested_details(monkeypatch, [entry])[0]['domains'] == expected

    @pytest.mark.parametrize('line', [
        '      "domains": ["competitor-website.com"]\n',
        'Use an empty list when you are not sure of a domain; never guess one.',
        "FIRST-PARTY BRANDS (the user's brands): <brand>Aurora Airways</brand>",
    ])
    def test_asks_for_domains_with_the_first_party_brands_still_wrapped(self, monkeypatch, line: str) -> None:
        prompts = brand_config_fixtures.capture_prompts(monkeypatch, _mod)

        _mod.find_competitors(['Aurora Airways'], 'general', [])

        assert line in prompts[0]
