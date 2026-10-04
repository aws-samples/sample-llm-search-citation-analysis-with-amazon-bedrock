"""Shared module loading and endpoint cases for the brand-config tests."""

from __future__ import annotations

import os
from types import ModuleType
from typing import NamedTuple

import pytest

from shared.industry_presets import DEFAULT_INDUSTRY_ID
from testing.events import api_gateway_event
from testing.module_loader import load_handler_module


def load_brand_config_module(module_name: str) -> ModuleType:
    """Load manage-brand-config.py with the table name it reads at import, so it loads without touching AWS."""
    os.environ.setdefault('DYNAMODB_TABLE_BRAND_CONFIG', 'test-brand-config')
    return load_handler_module(os.path.dirname(__file__), 'manage-brand-config.py', module_name)


def capture_prompts(monkeypatch: pytest.MonkeyPatch, module: ModuleType, answer: str = '{}') -> list[str]:
    """Make every Bedrock call in ``module`` answer ``answer``; the returned list collects each prompt sent."""
    prompts: list[str] = []

    def answer_prompt(prompt: str, *_args: object, **_kwargs: object) -> str:
        prompts.append(prompt)
        return answer

    monkeypatch.setattr(module, 'invoke_bedrock', answer_prompt)
    return prompts


class BrandIndustryEndpointCase(NamedTuple):
    """One brand operation and its expected invocation for an explicit Hotels and an omitted industry."""

    pytest_id: str
    path: str
    required_body: dict[str, object]
    function_name: str
    hotels_arguments: tuple[object, ...]
    general_arguments: tuple[object, ...]


BRAND_INDUSTRY_ENDPOINT_CASES = (
    BrandIndustryEndpointCase(
        pytest_id='expand-brand',
        path='/api/brand-config/expand',
        required_body={'brand_name': 'Acme'},
        function_name='expand_brand',
        hotels_arguments=('Acme', 'hotels', []),
        general_arguments=('Acme', DEFAULT_INDUSTRY_ID, []),
    ),
    BrandIndustryEndpointCase(
        pytest_id='expand-all-brands',
        path='/api/brand-config/expand-all',
        required_body={'existing_brands': ['Acme']},
        function_name='expand_brands',
        hotels_arguments=(['Acme'], 'hotels', 'first_party'),
        general_arguments=(['Acme'], DEFAULT_INDUSTRY_ID, 'first_party'),
    ),
    BrandIndustryEndpointCase(
        pytest_id='find-competitors',
        path='/api/brand-config/find-competitors',
        required_body={'first_party_brands': ['Acme']},
        function_name='find_competitors',
        hotels_arguments=(['Acme'], 'hotels', []),
        general_arguments=(['Acme'], DEFAULT_INDUSTRY_ID, []),
    ),
)


def build_brand_industry_event(
    case: BrandIndustryEndpointCase,
    industry: str | None,
    admin_group: str,
) -> dict[str, object]:
    """Build an authorized brand-operation request with one industry value, or none when ``industry`` is ``None``."""
    body = case.required_body if industry is None else {**case.required_body, 'industry': industry}
    return api_gateway_event(
        'POST',
        case.path,
        body=body,
        claims={'cognito:groups': admin_group},
        resource=case.path,
    )
