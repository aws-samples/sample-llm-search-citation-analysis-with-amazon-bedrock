"""
Property tests for the `notes` builder in the keyword-promotion handler.

Covers:
- Property 11: Notes contain exactly the present research-context fields, labeled
  (**Validates: Requirements 4.1, 4.2, 4.3**)

Context:
    `promote-keywords.py` records the research context of a promoted keyword
    (`intent`, `competition`, `source`) into the Active_Keyword `notes` field as
    a labeled, '; '-separated string in a fixed field order. Fields that are
    missing, empty, or whitespace-only count as ABSENT (Req 4.2) and the values
    that are kept are whitespace-stripped.

    The handler file is hyphenated, so it cannot be imported normally: it is
    loaded through `importlib.util.spec_from_file_location` under a unique module
    name (the `_load_router` pattern in `lambda/api/test_routers_404.py`). The
    module resolves its DynamoDB table and builds a `boto3` resource at import
    time, so the table env vars are set and `boto3.resource` is patched before
    the load happens.

Test outcomes:
    - a labeled entry exists for every present research-context field
    - no entry exists for any absent field (missing / empty / whitespace-only)
    - `notes` is '' when none of the three fields are present
    - kept values are stripped of surrounding whitespace
"""

import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# --- Test bootstrap --------------------------------------------------------

# `promote-keywords.py` does `sys.path.insert(0, '/opt/python')` then imports
# from `shared`. Point the layer directory at the front of sys.path so `shared`
# resolves to the layer copy (the copy loaded in Lambda via /opt/python).
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')
if _LAYER_PY not in sys.path:
    sys.path.insert(0, _LAYER_PY)

_API_DIR = os.path.dirname(os.path.abspath(__file__))

_HANDLER_FILE = 'promote-keywords.py'
_MODULE_NAME = 'promote_keywords_under_test'

# Canonical + legacy table env vars read by `resolve_table_env` at module scope.
_TABLE_ENV_VARS = ('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
_TEST_TABLE_NAME = 'test-keywords-table'


def _load_promote_keywords():
    """Load the hyphenated promotion handler as a fresh module."""
    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_API_DIR, _HANDLER_FILE)
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope='module', autouse=True)
def _promote_keywords():
    """Import the handler once with the table env set and `boto3` patched.

    The patch is applied inside a `with` block that wraps the `yield`, so no
    stubbed `boto3` leaks into other test modules in the same session.
    """
    saved = {name: os.environ.get(name) for name in _TABLE_ENV_VARS}
    for name in _TABLE_ENV_VARS:
        os.environ[name] = _TEST_TABLE_NAME

    with patch('boto3.resource', return_value=MagicMock()):
        module = _load_promote_keywords()
        yield module

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    sys.modules.pop(_MODULE_NAME, None)


@pytest.fixture(autouse=True)
def _clean_env():
    """Save, clear, and restore the table env vars around every test."""
    saved = {name: os.environ.get(name) for name in _TABLE_ENV_VARS}
    for name in _TABLE_ENV_VARS:
        os.environ.pop(name, None)

    yield

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value


# --- Strategies -------------------------------------------------------------

# Values that make a research-context field ABSENT per Req 4.2: omitted key
# (None -> the key is dropped), empty string, or whitespace-only.
_ABSENT_VALUES = st.one_of(
    st.none(),
    st.just(''),
    st.sampled_from(['   ', '\t', ' \n ', '\u00a0']),
)

# Values that make a field PRESENT. ':' and ';' are excluded so the rendered
# `notes` string stays unambiguously parseable back into labeled entries.
_PRESENT_VALUES = st.one_of(
    st.sampled_from([
        'commercial', 'informational', 'navigational', 'transactional',
        'high', 'medium', 'low', 'expansion', 'competitor-analysis',
        '  padded value  ',
    ]),
    st.text(
        alphabet=st.characters(min_codepoint=32, max_codepoint=126, exclude_characters=':;'),
        min_size=1,
        max_size=24,
    ).filter(lambda value: bool(value.strip())),
)

# Each field draws (is_present, raw_value); the test builds the research keyword
# from this spec so the expected outcome comes from the generator, not from a
# reimplementation of `build_notes`.
_FIELD_SPECS = st.fixed_dictionaries({
    'intent': st.one_of(
        _ABSENT_VALUES.map(lambda value: (False, value)),
        _PRESENT_VALUES.map(lambda value: (True, value)),
    ),
    'competition': st.one_of(
        _ABSENT_VALUES.map(lambda value: (False, value)),
        _PRESENT_VALUES.map(lambda value: (True, value)),
    ),
    'source': st.one_of(
        _ABSENT_VALUES.map(lambda value: (False, value)),
        _PRESENT_VALUES.map(lambda value: (True, value)),
    ),
})

_ALL_ABSENT_SPECS = st.fixed_dictionaries({
    'intent': _ABSENT_VALUES,
    'competition': _ABSENT_VALUES,
    'source': _ABSENT_VALUES,
})


def _research_keyword(field_specs):
    """Build a research keyword dict from a generated field spec.

    A `None` raw value means the key is omitted entirely; every other value is
    carried through verbatim so whitespace handling is exercised.
    """
    keyword = {'keyword': 'best running shoes'}
    for field, (_present, raw_value) in field_specs.items():
        if raw_value is not None:
            keyword[field] = raw_value
    return keyword


def _entries(notes):
    """Split a rendered `notes` value into its labeled entries."""
    return notes.split('; ') if notes else []


# --- Property tests ---------------------------------------------------------


class TestBuildNotesProperty:
    """
    **Property 11: Notes contain exactly the present research-context fields, labeled**

    For any research keyword, the created item's `notes` field contains a
    labeled entry for each of `intent`, `competition`, and `source` that is
    present, contains no entry for any field that is absent, and is empty when
    none of the three are present. A missing, empty, or whitespace-only value
    counts as absent (Req 4.2); kept values are whitespace-stripped.

    **Validates: Requirements 4.1, 4.2, 4.3**
    """

    @given(field_specs=_FIELD_SPECS)
    @settings(max_examples=100)
    def test_notes_hold_one_labeled_entry_per_present_field_when_subset_present(
        self, _promote_keywords, field_specs
    ):
        research_keyword = _research_keyword(field_specs)
        present = {
            field: raw_value
            for field, (is_present, raw_value) in field_specs.items()
            if is_present
        }
        absent = [field for field, (is_present, _raw) in field_specs.items() if not is_present]

        notes = _promote_keywords.build_notes(research_keyword)

        entries = _entries(notes)
        assert len(entries) == len(present), f'Expected {len(present)} entries in {notes!r}'
        for field, raw_value in present.items():
            expected = f'{field}: {raw_value.strip()}'
            assert expected in entries, f'Missing labeled entry {expected!r} in {notes!r}'
        for field in absent:
            assert not any(entry.startswith(f'{field}: ') for entry in entries), (
                f'Absent field {field!r} was reported in {notes!r}'
            )

    @given(field_specs=_FIELD_SPECS)
    @settings(max_examples=100)
    def test_notes_keep_present_fields_in_source_order_when_subset_present(
        self, _promote_keywords, field_specs
    ):
        research_keyword = _research_keyword(field_specs)
        expected_order = [
            field
            for field in _promote_keywords.NOTES_FIELDS
            if field_specs[field][0]
        ]

        notes = _promote_keywords.build_notes(research_keyword)

        labels = [entry.split(': ', 1)[0] for entry in _entries(notes)]
        assert labels == expected_order, f'Expected field order {expected_order} in {notes!r}'

    @given(absent_values=_ALL_ABSENT_SPECS)
    @settings(max_examples=50)
    def test_notes_are_empty_when_no_research_context_field_is_present(
        self, _promote_keywords, absent_values
    ):
        research_keyword = {'keyword': 'best running shoes'}
        research_keyword.update(
            {field: value for field, value in absent_values.items() if value is not None}
        )

        notes = _promote_keywords.build_notes(research_keyword)

        assert notes == '', f'Expected empty notes, got {notes!r}'


# --- Example tests ----------------------------------------------------------


class TestBuildNotesUnit:
    """Example-based coverage of the documented `notes` rendering."""

    def test_notes_render_all_three_labels_when_every_field_present(self, _promote_keywords):
        research_keyword = {
            'keyword': 'best running shoes',
            'intent': 'commercial',
            'competition': 'high',
            'source': 'expansion',
        }

        notes = _promote_keywords.build_notes(research_keyword)

        assert notes == 'intent: commercial; competition: high; source: expansion', (
            f'Unexpected notes rendering: {notes!r}'
        )

    def test_notes_omit_absent_fields_when_only_intent_present(self, _promote_keywords):
        research_keyword = {'keyword': 'trail shoes', 'intent': 'informational'}

        notes = _promote_keywords.build_notes(research_keyword)

        assert notes == 'intent: informational', f'Unexpected notes rendering: {notes!r}'

    @pytest.mark.parametrize(
        ('raw_value', 'expected'),
        [
            ('  commercial  ', 'source: commercial'),
            ('\tcompetitor\n', 'source: competitor'),
            ('', ''),
            ('    ', ''),
        ],
    )
    def test_notes_strip_or_drop_values_when_value_has_whitespace(
        self, _promote_keywords, raw_value, expected
    ):
        research_keyword = {'keyword': 'running shoes', 'source': raw_value}

        notes = _promote_keywords.build_notes(research_keyword)

        assert notes == expected, f'Unexpected notes rendering: {notes!r}'
