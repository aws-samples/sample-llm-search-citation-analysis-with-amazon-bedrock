"""The web track's scoped-response fixtures (``test-fixtures/scope-snapshots/``) agree with ``shared.snapshot_artifacts``.

The dashboard builds its decoders and states against these files; the routes
(tracks S2-S4) return these shapes. This suite keeps the contract parts of
every example exactly what the Python helpers produce.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from shared.snapshot_artifacts import (
    computing_body,
    coverage,
    cursor_expired_body,
    decode_keyword_cursor,
    decode_snapshot_cursor,
    snapshot_envelope,
)

FIXTURES = Path(__file__).resolve().parents[2] / 'test-fixtures' / 'scope-snapshots'
DOCUMENTS = {path.stem: json.loads(path.read_text(encoding='utf-8')) for path in sorted(FIXTURES.glob('*.json'))}
CASES = [(name, case) for name, document in DOCUMENTS.items() for case in document['cases']]
PAGED = [name for name, document in DOCUMENTS.items() if document['paging']]
SCOPED_BODIES = [(name, case) for name, case in CASES if case in {'complete', 'live', 'stale', 'partial', 'page'}]

ROUTES_OF_THE_DESIGN = [
    'brand-mentions', 'brand-mentions-appearances', 'citation-gaps', 'citations', 'content-studio-ideas',
    'group-kpis', 'group-kpis-keywords', 'prompt-insights', 'recommendations', 'reports-competitor',
    'reports-insights', 'reports-overview', 'sentiment-examples', 'stats-market', 'trends', 'visibility',
]


def _body(name: str, case: str) -> dict[str, Any]:
    return DOCUMENTS[name]['cases'][case]['body']


def _path(body: dict[str, Any], dotted: str) -> Any:
    node: Any = body
    for part in dotted.split('.'):
        node = node[part]
    return node


def test_every_route_of_the_design_has_a_fixture() -> None:
    assert sorted(DOCUMENTS) == ROUTES_OF_THE_DESIGN


@pytest.mark.parametrize('name', sorted(DOCUMENTS))
def test_every_route_has_the_common_cases(name: str) -> None:
    assert {'complete', 'live', 'stale', 'computing', 'failed'} <= set(DOCUMENTS[name]['cases'])


@pytest.mark.parametrize('name', PAGED)
def test_every_paged_route_has_a_page_and_a_cursor_expired_case(name: str) -> None:
    assert {'page', 'cursor_expired'} <= set(DOCUMENTS[name]['cases'])


@pytest.mark.parametrize(('name', 'case'), SCOPED_BODIES)
def test_coverage_is_what_the_helper_builds(name: str, case: str) -> None:
    stated = _body(name, case)['coverage']

    assert stated == coverage(stated['keywords_total'], stated['keywords_analyzed'])


@pytest.mark.parametrize(('name', 'case'), SCOPED_BODIES)
def test_envelope_is_live_or_a_valid_snapshot(name: str, case: str) -> None:
    body = _body(name, case)
    envelope = {key: body[key] for key in ('source', 'as_of', 'stale', 'refreshing')}

    expected = (
        {'source': 'live', 'as_of': None, 'stale': False, 'refreshing': False} if body['source'] == 'live'
        else snapshot_envelope(body['as_of'], stale=body['stale'], refreshing=body['refreshing'])
    )
    assert envelope == expected


@pytest.mark.parametrize('name', sorted(DOCUMENTS))
def test_stale_case_is_flagged_and_refreshing(name: str) -> None:
    body = _body(name, 'stale')

    assert (body['source'], body['stale'], body['refreshing']) == ('snapshot', True, True)


COMPUTING = [(name, 'computing') for name in sorted(DOCUMENTS)] + [
    ('group-kpis', 'drivers_computing'),
]


@pytest.mark.parametrize(('name', 'case_name'), COMPUTING)
def test_computing_case_is_the_202_body(name: str, case_name: str) -> None:
    case = DOCUMENTS[name]['cases'][case_name]
    body = case['body']

    assert (case['status'], body) == (202, computing_body(body['job']['id'], body['job']['started_at'], body['retry_after_ms']))


@pytest.mark.parametrize('name', PAGED)
def test_cursor_expired_case_is_the_400_body(name: str) -> None:
    case = DOCUMENTS[name]['cases']['cursor_expired']

    assert (case['status'], case['body']) == (400, cursor_expired_body())


@pytest.mark.parametrize('name', PAGED)
def test_page_tokens_decode_as_the_declared_cursor(name: str) -> None:
    paging = DOCUMENTS[name]['paging']
    decode = decode_snapshot_cursor if paging['cursor'] == 'snapshot' else decode_keyword_cursor
    tokens = [
        _path(_body(name, 'complete'), paging['token']),
        DOCUMENTS[name]['cases']['page']['query']['next_token'],
    ]

    assert [decode(token) is not None for token in tokens] == [True, True]


@pytest.mark.parametrize('name', PAGED)
def test_live_case_of_a_small_scope_has_no_further_page(name: str) -> None:
    assert _path(_body(name, 'live'), DOCUMENTS[name]['paging']['token']) is None


def test_brand_page_holds_only_the_brands_rows_with_a_keyword_cursor() -> None:
    body = _body('brand-mentions-appearances', 'brand_page')

    assert ({row['brand'] for row in body['appearances']}, decode_keyword_cursor(body['next_token']) is not None) == ({body['brand']}, True)
