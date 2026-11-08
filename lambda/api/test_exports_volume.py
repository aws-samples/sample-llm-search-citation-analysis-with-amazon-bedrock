"""Volume tests for GET /api/exports.

A page holds up to ``PAGE_MAX`` (100) summaries, and each carries the export's
params. Params are capped at ``MAX_PARAMS_BYTES`` of JSON (about a URL's query
string), so 100 summaries at the cap, accented text included, stay within one
page budget; a POST over the cap is refused.
"""

from __future__ import annotations

from collections.abc import Iterator
from types import ModuleType
from typing import Any
from unittest.mock import patch

import pytest

from shared.export_jobs import PAGE_MAX
from shared.response_budget import json_bytes
from testing.events import api_gateway_event, parse_response
from testing.export_fakes import FakeStepFunctions
from testing.export_fixtures import ALICE, ExportHarness, citations_source, export_handler_fixture
from testing.response_size import assert_within_page_budget, long_text

exports_api = export_handler_fixture(__file__, 'exports.py', 'exports_volume_api_handler')
_CLAIMS = {'sub': ALICE.sub, 'email': ALICE.email, 'cognito:groups': 'Users'}
_PARAM_NAMES = ('scope', 'group_id', 'keyword', 'market_id', 'provider', 'query_prompt_id', 'classification', 'brand', 'sort', 'search')


def _params_at_cap(cap: int) -> dict[str, str]:
    """Ten accented params whose JSON takes as many bytes as ``cap`` allows."""
    length = 2_000
    while json_bytes(params := {name: long_text(length) for name in _PARAM_NAMES}) > cap:
        length -= 10
    return params


@pytest.fixture
def harness(exports_api: ModuleType) -> Iterator[ExportHarness]:
    harness = ExportHarness(citations_source(1))
    with (
        patch.object(exports_api, 's3', harness.s3),
        patch.object(exports_api, 'sfn', FakeStepFunctions()),
        patch.object(exports_api, 'exports_table', harness.table),
        patch.object(exports_api, 'export_sources', return_value={harness.source.view: harness.source}),
        patch.object(exports_api, 'utc_now', return_value=harness.deps.now()),
    ):
        yield harness


def _get(module: ModuleType, query: dict[str, str]) -> dict[str, Any]:
    return module.handler(api_gateway_event('GET', '/api/exports', claims=_CLAIMS, query=query), None)


def test_stays_within_page_budget_when_a_page_holds_100_exports_at_the_params_cap(exports_api: ModuleType, harness: ExportHarness) -> None:
    params = _params_at_cap(exports_api.MAX_PARAMS_BYTES)
    for _ in range(PAGE_MAX):
        # Finished, so a hundred fit beside the running limit.
        harness.set_status(harness.queue('xlsx', params=params), 'ready')

    response = _get(exports_api, {'limit': str(PAGE_MAX)})

    assert len(parse_response(response)[1]['exports']) == PAGE_MAX
    assert_within_page_budget(response)


@pytest.mark.usefixtures('harness')
def test_refuses_params_over_the_cap(exports_api: ModuleType) -> None:
    params = {name: long_text(2_000) for name in _PARAM_NAMES}
    body = {'view': 'citations', 'params': params, 'format': 'csv'}

    status, answer = parse_response(exports_api.handler(api_gateway_event('POST', '/api/exports', claims=_CLAIMS, body=body), None))

    assert (status, answer['error']) == (400, f'params may take at most {exports_api.MAX_PARAMS_BYTES} bytes as JSON')
