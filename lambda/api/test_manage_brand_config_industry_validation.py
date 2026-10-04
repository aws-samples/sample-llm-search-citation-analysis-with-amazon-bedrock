"""Request-boundary tests for brand-config industry defaults and validation."""

from __future__ import annotations

from typing import get_args
from unittest.mock import MagicMock, call

import pytest
from test_manage_brand_config_fixtures import (
    BRAND_INDUSTRY_ENDPOINT_CASES,
    BrandIndustryEndpointCase,
    build_brand_industry_event,
    load_brand_config_module,
)

from testing.events import parse_response

_mod = load_brand_config_module('manage_brand_config_industry_validation_under_test')

_CASE_IDS = [case.pytest_id for case in BRAND_INDUSTRY_ENDPOINT_CASES]


@pytest.fixture
def operation(monkeypatch, case: BrandIndustryEndpointCase) -> MagicMock:
    """Stand-in for the brand operation ``case`` routes to."""
    stub = MagicMock(return_value={})
    monkeypatch.setattr(_mod, case.function_name, stub)
    return stub


@pytest.mark.parametrize('case', BRAND_INDUSTRY_ENDPOINT_CASES, ids=_CASE_IDS)
def test_passes_trimmed_industry_when_body_contains_surrounding_whitespace(
    operation: MagicMock,
    case: BrandIndustryEndpointCase,
) -> None:
    _mod.handler(build_brand_industry_event(case, ' hotels ', _mod.ADMIN_GROUP), None)

    assert operation.call_args_list == [call(*case.hotels_arguments)]


@pytest.mark.parametrize('case', BRAND_INDUSTRY_ENDPOINT_CASES, ids=_CASE_IDS)
def test_passes_general_when_request_omits_industry(
    operation: MagicMock,
    case: BrandIndustryEndpointCase,
) -> None:
    status, _payload = parse_response(_mod.handler(build_brand_industry_event(case, None, _mod.ADMIN_GROUP), None))

    assert status == 200
    operation.assert_called_once_with(*case.general_arguments)


@pytest.mark.parametrize('case', BRAND_INDUSTRY_ENDPOINT_CASES, ids=_CASE_IDS)
def test_rejects_industry_when_body_value_exceeds_fifty_characters(
    operation: MagicMock,
    case: BrandIndustryEndpointCase,
) -> None:
    status, payload = parse_response(_mod.handler(build_brand_industry_event(case, 'x' * 51, _mod.ADMIN_GROUP), None))

    assert (status, payload) == (400, {
        'error': 'industry too long (max 50 characters)',
        'field': 'industry',
    })
    operation.assert_not_called()


def test_brand_portfolio_type_contains_only_supported_values() -> None:
    assert get_args(_mod.BrandPortfolio) == ('first_party', 'competitor')


def test_uses_distinct_portfolio_rules_when_brand_type_changes(monkeypatch) -> None:
    model = MagicMock(return_value='{"parent_companies": [], "suggestions": [], "notes": ""}')
    monkeypatch.setattr(_mod, 'invoke_bedrock', model)

    _mod.expand_brands(['Acme'], 'general', 'first_party')
    first_party_prompt = model.call_args.args[0]
    _mod.expand_brands(['Rival'], 'general', 'competitor')
    competitor_prompt = model.call_args.args[0]

    assert (
        'FIRST-PARTY BRANDS ALREADY BEING TRACKED (DO NOT INCLUDE THESE IN YOUR RESPONSE):'
        in first_party_prompt.splitlines()
    )
    assert '- Do NOT suggest competitor brands owned by different companies' in first_party_prompt.splitlines()
    assert (
        'COMPETITOR BRANDS ALREADY BEING TRACKED (DO NOT INCLUDE THESE IN YOUR RESPONSE):'
        in competitor_prompt.splitlines()
    )
    assert (
        '- Do NOT suggest tracked first-party brands or unrelated competitor companies'
        in competitor_prompt.splitlines()
    )
