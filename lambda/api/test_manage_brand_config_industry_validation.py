"""Request-boundary tests for brand-config industry defaults and validation."""

from __future__ import annotations

import os
from typing import get_args
from unittest.mock import MagicMock, call

import pytest
from test_manage_brand_config_fixtures import (
    BRAND_INDUSTRY_ENDPOINT_CASES,
    BrandIndustryEndpointCase,
    build_brand_industry_event,
)

from testing.events import parse_response
from testing.module_loader import load_handler_module

os.environ.setdefault('DYNAMODB_TABLE_BRAND_CONFIG', 'test-brand-config')
_mod = load_handler_module(
    os.path.dirname(__file__),
    'manage-brand-config.py',
    'manage_brand_config_industry_validation_under_test',
)

_CASE_IDS = [case.pytest_id for case in BRAND_INDUSTRY_ENDPOINT_CASES]


@pytest.mark.parametrize('case', BRAND_INDUSTRY_ENDPOINT_CASES, ids=_CASE_IDS)
def test_passes_trimmed_industry_when_body_contains_surrounding_whitespace(
    monkeypatch,
    case: BrandIndustryEndpointCase,
) -> None:
    operation = MagicMock(return_value={})
    monkeypatch.setattr(_mod, case.function_name, operation)
    event = build_brand_industry_event(case, ' hotels ', _mod.ADMIN_GROUP)

    _mod.handler(event, None)

    assert operation.call_args_list == [call(*case.hotels_arguments)]


@pytest.mark.parametrize('case', BRAND_INDUSTRY_ENDPOINT_CASES, ids=_CASE_IDS)
def test_rejects_industry_when_body_value_exceeds_fifty_characters(
    monkeypatch,
    case: BrandIndustryEndpointCase,
) -> None:
    operation = MagicMock(return_value={})
    monkeypatch.setattr(_mod, case.function_name, operation)
    event = build_brand_industry_event(case, 'x' * 51, _mod.ADMIN_GROUP)

    status, payload = parse_response(_mod.handler(event, None))

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

    _mod.expand_brands(['Acme'], industry='general')
    first_party_prompt = model.call_args.args[0]
    _mod.expand_brands(['Rival'], industry='general', brand_type='competitor')
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
