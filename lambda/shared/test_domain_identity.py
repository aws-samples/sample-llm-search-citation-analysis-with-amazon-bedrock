"""Cross-runtime contract tests for canonical domain identity (test-fixtures/domain-identity.json)."""

import json
from pathlib import Path

import pytest

from shared.kpi_engine import normalize_domain
from shared.utils import extract_domain

# `.resolve()` first: see test_keyword_identity.py (sys.path entries make `__file__` unnormalized).
_FIXTURES_PATH = Path(__file__).resolve().parents[2] / 'test-fixtures' / 'domain-identity.json'
_CASES = json.loads(_FIXTURES_PATH.read_text(encoding='utf-8'))['cases']
_HOST_CASES = [case for case in _CASES if case['expected'] is not None]


@pytest.mark.parametrize('case', _CASES, ids=[case['description'] for case in _CASES])
def test_normalize_domain_returns_the_shared_canonical_domain(case):
    assert normalize_domain(case['input']) == case['expected']


@pytest.mark.parametrize('case', _HOST_CASES, ids=[case['description'] for case in _HOST_CASES])
def test_extract_domain_agrees_with_normalize_domain_when_there_is_a_host(case):
    assert extract_domain(case['input']) == case['expected']
