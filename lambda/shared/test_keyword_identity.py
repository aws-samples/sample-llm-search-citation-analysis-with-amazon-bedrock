"""Cross-runtime contract tests for canonical keyword identity."""

import json
from pathlib import Path

import pytest

from shared.utils import keyword_id, normalize_keyword

_FIXTURES_PATH = Path(__file__).parents[2] / 'test-fixtures' / 'keyword-identity.json'
_FIXTURES = json.loads(_FIXTURES_PATH.read_text(encoding='utf-8'))


@pytest.mark.parametrize(
    'vector',
    _FIXTURES['valid'],
    ids=[vector['description'] for vector in _FIXTURES['valid']],
)
def test_returns_shared_canonical_key_when_text_is_valid(vector):
    assert normalize_keyword(vector['input']) == vector['expected']


@pytest.mark.parametrize(
    'vector',
    _FIXTURES['boundaryWhitespace'],
    ids=[vector['description'] for vector in _FIXTURES['boundaryWhitespace']],
)
def test_removes_explicit_boundary_character_when_it_surrounds_keyword(vector):
    boundary = chr(vector['codePoint'])

    assert normalize_keyword(f'{boundary}ALPHA{boundary}') == 'alpha'


@pytest.mark.parametrize(
    'vector',
    _FIXTURES['preservedBoundaryControls'],
    ids=[vector['description'] for vector in _FIXTURES['preservedBoundaryControls']],
)
def test_preserves_non_boundary_control_when_it_surrounds_keyword(vector):
    control = chr(vector['codePoint'])

    assert normalize_keyword(f'{control}ALPHA{control}') == f'{control}alpha{control}'


@pytest.mark.parametrize(
    'vector',
    _FIXTURES['invalid'],
    ids=[vector['description'] for vector in _FIXTURES['invalid']],
)
def test_returns_empty_canonical_key_when_text_contains_unpaired_surrogate(vector):
    text = ''.join(chr(code_unit) for code_unit in vector['codeUnits'])

    assert normalize_keyword(text) == ''


def test_returns_stable_uuid_when_keyword_has_canonical_identity():
    assert keyword_id(' \tMiXeD Case\r\n') == 'ed2dbc0a-3b83-5db3-a1d9-da7d060e7cba'


def test_raises_value_error_when_keyword_has_no_canonical_identity():
    with pytest.raises(ValueError, match='non-empty Unicode identity'):
        keyword_id('\ud800')
