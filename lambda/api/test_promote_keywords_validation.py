"""
Property tests for status/priority validation in the keyword-promotion handler.

Covers:
- Property 10: Invalid status or priority rejects the whole request
  (**Validates: Requirements 3.5**)
- the default-resolution half of the same contract
  (**Validates: Requirements 3.1, 3.2, 3.3, 3.4**)

Context:
    `validate_request` in `promote-keywords.py` is the request-level gate that
    runs before any DynamoDB read or write. It returns a 3-tuple
    `(error, status, priority)`: `(None, resolved_status, resolved_priority)` on
    success and `({'message': ..., 'field': ...}, None, None)` on rejection.

    Status/priority are resolved BEFORE they are checked, so an omitted (`None`)
    or empty (`''`) value is VALID and becomes `DEFAULT_STATUS` / `DEFAULT_PRIORITY`
    (Req 3.2, 3.4). Present values are matched exactly and case-sensitively
    (Req 3.1, 3.3), so a case variant such as 'Active' is invalid. Both fields are
    evaluated, so a request carrying two invalid values names both (Req 3.5).

    The allowed sets and defaults are imported from the module under test — the
    strategies here generate *indices* and *case transforms* and resolve them
    against `ALLOWED_STATUSES` / `ALLOWED_PRIORITIES` inside each test, so no
    allowed value is duplicated in this file.

    The handler file is hyphenated, so it cannot be imported normally: it is
    loaded through `importlib.util.spec_from_file_location` under a unique module
    name (the `_load_router` pattern in `lambda/api/test_routers_404.py`). The
    module resolves its DynamoDB table and builds a `boto3` resource at import
    time, so the table env vars are set and `boto3.resource` is patched before
    the load happens.

Test outcomes:
    - an invalid status and/or priority rejects the whole request, naming each
      offending field and its rejected value
    - a rejected request resolves nothing: both returned values are `None`
    - exact, case-sensitive allowed values resolve through unchanged
    - omitted / empty status resolves to the default status, and omitted / empty
      priority resolves to the default priority
    - case variants of otherwise-valid values are rejected
"""

import importlib.util
import itertools
import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import assume, given, settings
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
# Distinct from the name used by test_promote_keywords_notes.py so the two test
# modules cannot evict each other's copy in the same pytest session.
_MODULE_NAME = 'promote_keywords_validation_under_test'

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

# Keyword payloads that clear every other request gate (present, <= 500 entries,
# trimmed text non-empty and <= 100 chars), so only status/priority decide the
# outcome.
_KEYWORDS = st.lists(
    st.sampled_from([
        'best running shoes',
        '  Trail Running Shoes  ',
        'marathon training plan',
        'lightweight racing flats',
    ]).map(lambda text: {'keyword': text}),
    min_size=1,
    max_size=5,
)

# Index into an allowed-values tuple; resolved with `% len(...)` inside the test
# so this file never assumes how many allowed values exist.
_ALLOWED_INDEX = st.integers(min_value=0, max_value=99)

# The two forms that mean "not supplied" and resolve to the documented defaults.
_OMITTED_OR_EMPTY = st.sampled_from([None, ''])

# Candidate invalid values: plausible-but-wrong vocabulary plus arbitrary text.
# Each test still `assume`s the drawn value is outside the imported allowed set,
# so a lucky draw can never be asserted as a false rejection.
_INVALID_CANDIDATES = st.one_of(
    st.sampled_from([
        'archived',
        'enabled',
        'disabled',
        'urgent',
        'medium',
        'critical',
        'none',
        '0',
        ' active',
        'active ',
        'active,inactive',
    ]),
    st.text(min_size=1, max_size=24),
)

# Case transforms used to build values that differ from an allowed value only by
# case, which the exact, case-sensitive match must reject (Req 3.1, 3.3).
_CASE_TRANSFORMS = st.sampled_from(['upper', 'capitalize', 'title', 'swapcase'])


def _invalid_status(module, value):
    """Assume a drawn value is outside the allowed status set."""
    assume(value != '' and value not in module.ALLOWED_STATUSES)
    return value


def _invalid_priority(module, value):
    """Assume a drawn value is outside the allowed priority set."""
    assume(value != '' and value not in module.ALLOWED_PRIORITIES)
    return value


def _case_variant(allowed_values, index, transform):
    """Build a case variant of an allowed value, assuming it is not itself allowed."""
    original = allowed_values[index % len(allowed_values)]
    variant = getattr(original, transform)()
    assume(variant not in allowed_values)
    return variant


def _assert_rejects(error, status, priority, fields, values):
    """Assert a rejection names every offending field and its rejected value."""
    assert error is not None, 'Expected a rejection, got success'
    assert status is None, f'Rejected request resolved a status: {status!r}'
    assert priority is None, f'Rejected request resolved a priority: {priority!r}'

    message = error['message']
    for field in fields:
        assert field in message, f'Field {field!r} not named in {message!r}'
    for value in values:
        assert value in message, f'Rejected value {value!r} not reported in {message!r}'

    assert error['field'] == ', '.join(fields), f'Unexpected offending field {error["field"]!r}'


# --- Property tests ---------------------------------------------------------


class TestValidateRequestProperty:
    """
    **Property 10: Invalid status or priority rejects the whole request**

    For any status value outside `{active, inactive, paused}` or any priority
    value outside `{high, normal, low}`, the request is rejected with a
    validation error that names each invalid field and its rejected value, and
    nothing is resolved (both returned values are `None`) so no Active_Keyword
    can be created. Values are matched exactly and case-sensitively, so case
    variants are invalid; omitted (`None`) and empty (`''`) values are valid and
    resolve to the documented defaults.

    **Validates: Requirements 3.5**
    (default resolution also **Validates: Requirements 3.1, 3.2, 3.3, 3.4**)
    """

    @given(keywords=_KEYWORDS, raw_status=_INVALID_CANDIDATES, priority_index=_ALLOWED_INDEX)
    @settings(max_examples=100)
    def test_request_is_rejected_when_status_is_invalid(
        self, _promote_keywords, keywords, raw_status, priority_index
    ):
        status = _invalid_status(_promote_keywords, raw_status)
        priorities = _promote_keywords.ALLOWED_PRIORITIES
        priority = priorities[priority_index % len(priorities)]

        error, resolved_status, resolved_priority = _promote_keywords.validate_request(
            keywords, status, priority
        )

        _assert_rejects(error, resolved_status, resolved_priority, ['status'], [status])

    @given(keywords=_KEYWORDS, status_index=_ALLOWED_INDEX, raw_priority=_INVALID_CANDIDATES)
    @settings(max_examples=100)
    def test_request_is_rejected_when_priority_is_invalid(
        self, _promote_keywords, keywords, status_index, raw_priority
    ):
        priority = _invalid_priority(_promote_keywords, raw_priority)
        statuses = _promote_keywords.ALLOWED_STATUSES
        status = statuses[status_index % len(statuses)]

        error, resolved_status, resolved_priority = _promote_keywords.validate_request(
            keywords, status, priority
        )

        _assert_rejects(error, resolved_status, resolved_priority, ['priority'], [priority])

    @given(
        keywords=_KEYWORDS,
        raw_status=_INVALID_CANDIDATES,
        raw_priority=_INVALID_CANDIDATES,
    )
    @settings(max_examples=100)
    def test_both_fields_are_named_when_status_and_priority_are_invalid(
        self, _promote_keywords, keywords, raw_status, raw_priority
    ):
        status = _invalid_status(_promote_keywords, raw_status)
        priority = _invalid_priority(_promote_keywords, raw_priority)

        error, resolved_status, resolved_priority = _promote_keywords.validate_request(
            keywords, status, priority
        )

        _assert_rejects(
            error,
            resolved_status,
            resolved_priority,
            ['status', 'priority'],
            [status, priority],
        )

    @given(
        keywords=_KEYWORDS,
        status_index=_ALLOWED_INDEX,
        transform=_CASE_TRANSFORMS,
        priority_index=_ALLOWED_INDEX,
    )
    @settings(max_examples=100)
    def test_request_is_rejected_when_status_differs_only_by_case(
        self, _promote_keywords, keywords, status_index, transform, priority_index
    ):
        status = _case_variant(_promote_keywords.ALLOWED_STATUSES, status_index, transform)
        priorities = _promote_keywords.ALLOWED_PRIORITIES
        priority = priorities[priority_index % len(priorities)]

        error, resolved_status, resolved_priority = _promote_keywords.validate_request(
            keywords, status, priority
        )

        _assert_rejects(error, resolved_status, resolved_priority, ['status'], [status])

    @given(
        keywords=_KEYWORDS,
        status_index=_ALLOWED_INDEX,
        priority_index=_ALLOWED_INDEX,
        transform=_CASE_TRANSFORMS,
    )
    @settings(max_examples=100)
    def test_request_is_rejected_when_priority_differs_only_by_case(
        self, _promote_keywords, keywords, status_index, priority_index, transform
    ):
        priority = _case_variant(_promote_keywords.ALLOWED_PRIORITIES, priority_index, transform)
        statuses = _promote_keywords.ALLOWED_STATUSES
        status = statuses[status_index % len(statuses)]

        error, resolved_status, resolved_priority = _promote_keywords.validate_request(
            keywords, status, priority
        )

        _assert_rejects(error, resolved_status, resolved_priority, ['priority'], [priority])

    @given(keywords=_KEYWORDS, status_index=_ALLOWED_INDEX, priority_index=_ALLOWED_INDEX)
    @settings(max_examples=100)
    def test_values_resolve_unchanged_when_status_and_priority_are_allowed(
        self, _promote_keywords, keywords, status_index, priority_index
    ):
        statuses = _promote_keywords.ALLOWED_STATUSES
        priorities = _promote_keywords.ALLOWED_PRIORITIES
        status = statuses[status_index % len(statuses)]
        priority = priorities[priority_index % len(priorities)]

        error, resolved_status, resolved_priority = _promote_keywords.validate_request(
            keywords, status, priority
        )

        assert error is None, f'Unexpected rejection: {error!r}'
        assert resolved_status == status, f'Status changed to {resolved_status!r}'
        assert resolved_priority == priority, f'Priority changed to {resolved_priority!r}'

    @given(
        keywords=_KEYWORDS,
        status=st.one_of(_OMITTED_OR_EMPTY, _ALLOWED_INDEX),
        priority=st.one_of(_OMITTED_OR_EMPTY, _ALLOWED_INDEX),
    )
    @settings(max_examples=100)
    def test_defaults_resolve_when_status_or_priority_is_omitted_or_empty(
        self, _promote_keywords, keywords, status, priority
    ):
        statuses = _promote_keywords.ALLOWED_STATUSES
        priorities = _promote_keywords.ALLOWED_PRIORITIES
        # An integer draw selects an allowed value; None / '' stay as-is.
        supplied_status = statuses[status % len(statuses)] if isinstance(status, int) else status
        supplied_priority = (
            priorities[priority % len(priorities)] if isinstance(priority, int) else priority
        )
        expected_status = (
            _promote_keywords.DEFAULT_STATUS if supplied_status in (None, '') else supplied_status
        )
        expected_priority = (
            _promote_keywords.DEFAULT_PRIORITY
            if supplied_priority in (None, '')
            else supplied_priority
        )

        error, resolved_status, resolved_priority = _promote_keywords.validate_request(
            keywords, supplied_status, supplied_priority
        )

        assert error is None, f'Unexpected rejection: {error!r}'
        assert resolved_status == expected_status, f'Expected status {expected_status!r}'
        assert resolved_priority == expected_priority, f'Expected priority {expected_priority!r}'


# --- Example tests ----------------------------------------------------------


class TestValidateRequestUnit:
    """Example-based coverage of the documented status/priority contract."""

    def test_defaults_resolve_when_status_and_priority_are_omitted(self, _promote_keywords):
        keywords = [{'keyword': 'best running shoes'}]

        error, status, priority = _promote_keywords.validate_request(keywords, None, None)

        assert error is None, f'Unexpected rejection: {error!r}'
        assert status == _promote_keywords.DEFAULT_STATUS, f'Unexpected status {status!r}'
        assert priority == _promote_keywords.DEFAULT_PRIORITY, f'Unexpected priority {priority!r}'

    def test_defaults_resolve_when_status_and_priority_are_empty(self, _promote_keywords):
        keywords = [{'keyword': 'best running shoes'}]

        error, status, priority = _promote_keywords.validate_request(keywords, '', '')

        assert error is None, f'Unexpected rejection: {error!r}'
        assert status == _promote_keywords.DEFAULT_STATUS, f'Unexpected status {status!r}'
        assert priority == _promote_keywords.DEFAULT_PRIORITY, f'Unexpected priority {priority!r}'

    def test_every_allowed_combination_resolves_unchanged(self, _promote_keywords):
        keywords = [{'keyword': 'best running shoes'}]
        combinations = itertools.product(
            _promote_keywords.ALLOWED_STATUSES, _promote_keywords.ALLOWED_PRIORITIES
        )

        results = [
            (
                supplied_status,
                supplied_priority,
                _promote_keywords.validate_request(keywords, supplied_status, supplied_priority),
            )
            for supplied_status, supplied_priority in combinations
        ]

        for supplied_status, supplied_priority, (error, status, priority) in results:
            assert error is None, f'Unexpected rejection for {supplied_status}/{supplied_priority}'
            assert status == supplied_status, f'Unexpected status {status!r}'
            assert priority == supplied_priority, f'Unexpected priority {priority!r}'

    @pytest.mark.parametrize(
        ('supplied_status', 'supplied_priority', 'expected_field', 'expected_values'),
        [
            ('Active', None, 'status', ['status', 'Active']),
            ('ACTIVE', '', 'status', ['status', 'ACTIVE']),
            (None, 'High', 'priority', ['priority', 'High']),
            ('', 'NORMAL', 'priority', ['priority', 'NORMAL']),
            ('archived', None, 'status', ['status', 'archived']),
            (None, 'urgent', 'priority', ['priority', 'urgent']),
            ('Active', 'High', 'status, priority', ['status', 'Active', 'priority', 'High']),
            ('archived', 'urgent', 'status, priority', ['status', 'archived', 'priority', 'urgent']),
        ],
    )
    def test_request_is_rejected_when_status_or_priority_is_outside_allowed_set(
        self, _promote_keywords, supplied_status, supplied_priority, expected_field, expected_values
    ):
        keywords = [{'keyword': 'best running shoes'}]

        error, status, priority = _promote_keywords.validate_request(
            keywords, supplied_status, supplied_priority
        )

        assert error is not None, 'Expected a rejection, got success'
        assert status is None, f'Rejected request resolved a status: {status!r}'
        assert priority is None, f'Rejected request resolved a priority: {priority!r}'
        assert error['field'] == expected_field, f'Unexpected offending field {error["field"]!r}'
        for expected in expected_values:
            assert expected in error['message'], (
                f'Expected {expected!r} in {error["message"]!r}'
            )
