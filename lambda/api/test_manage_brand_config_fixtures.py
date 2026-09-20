"""Shared endpoint cases for brand-config industry validation tests."""

from __future__ import annotations

from typing import NamedTuple

from testing.events import api_gateway_event


class BrandIndustryEndpointCase(NamedTuple):
    """One brand operation and its expected explicit-Hotels invocation."""

    pytest_id: str
    path: str
    required_body: dict[str, object]
    function_name: str
    hotels_arguments: tuple[object, ...]


BRAND_INDUSTRY_ENDPOINT_CASES = (
    BrandIndustryEndpointCase(
        pytest_id='expand-brand',
        path='/api/brand-config/expand',
        required_body={'brand_name': 'Acme'},
        function_name='expand_brand',
        hotels_arguments=('Acme', 'hotels', []),
    ),
    BrandIndustryEndpointCase(
        pytest_id='expand-all-brands',
        path='/api/brand-config/expand-all',
        required_body={'existing_brands': ['Acme']},
        function_name='expand_brands',
        hotels_arguments=(['Acme'], 'hotels', 'first_party'),
    ),
    BrandIndustryEndpointCase(
        pytest_id='find-competitors',
        path='/api/brand-config/find-competitors',
        required_body={'first_party_brands': ['Acme']},
        function_name='find_competitors',
        hotels_arguments=(['Acme'], 'hotels', []),
    ),
)


def build_brand_industry_event(
    case: BrandIndustryEndpointCase,
    industry: str,
    admin_group: str,
) -> dict[str, object]:
    """Build an authorized brand-operation request with one industry value."""
    return api_gateway_event(
        'POST',
        case.path,
        body={**case.required_body, 'industry': industry},
        claims={'cognito:groups': admin_group},
        resource=case.path,
    )
