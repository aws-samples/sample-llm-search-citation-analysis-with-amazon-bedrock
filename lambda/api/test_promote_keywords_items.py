"""
Property tests for Active_Keyword item construction in the promotion handler.

Covers:
- Property 2: Stored keyword text is the trimmed research text
  (**Validates: Requirements 1.2**)
- Property 3: Created items get unique ids and equal UTC timestamps
  (**Validates: Requirements 1.3**)
- Property 8: Status resolution applies to every created item
  (**Validates: Requirements 3.1, 3.2**)
- Property 9: Priority resolution applies to every created item
  (**Validates: Requirements 3.3, 3.4**)

Context:
    `create_items(to_create, status, priority)` in `promote-keywords.py` turns
    the creations produced by `partition_keywords` into Keywords_Table items. It
    mirrors the item shape of `create_keyword` in `manage-keywords.py`, reusing
    that path's `region` / `language` / `category` defaults, which the module
    exposes as `DEFAULT_REGION` / `DEFAULT_LANGUAGE` / `DEFAULT_CATEGORY`.

    `status` and `priority` arrive ALREADY RESOLVED from `validate_request`, so
    the tests resolve them the same way -- an omitted (`None`) or empty value
    becomes `DEFAULT_STATUS` / `DEFAULT_PRIORITY` -- and then assert the resolved
    value reaches every item.

    Timestamps and ids are left real: `create_items` reads `get_timestamp()`
    once per call, so `created_at == updated_at` and the shared value is
    asserted across the whole batch, and `uuid4()` uniqueness is asserted across
    the produced ids. Nothing is patched or frozen.

    The handler file is hyphenated, so it cannot be imported normally: it is
    loaded through `importlib.util.spec_from_file_location` under a unique module
    name (the `_load_router` pattern in `lambda/api/test_routers_404.py`). The
    module resolves its DynamoDB table and builds a `boto3` resource at import
    time, so the table env vars are set and `boto3.resource` is patched before
    the load happens.

Test outcomes:
    - the stored `keyword` equals the trimmed research text with its original
      casing preserved, never the normalized comparison key
    - every created item carries a distinct `id`
    - each item's `created_at` equals its `updated_at`, is shared across the
      batch, and parses as a UTC ISO-8601 timestamp with a trailing 'Z'
    - a supplied status/priority reaches every item; an omitted or empty one
      resolves to the documented default on every item
    - the item field set matches the `create_keyword` shape, including the
      reused region/language/category defaults and the `notes` research context
"""

import importlib.util
import os
import sys
from datetime import UTC, datetime
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
# Distinct from the names used by the other promote-keywords test modules so the
# modules cannot evict each other's copy in the same pytest session.
_MODULE_NAME = 'promote_keywords_items_under_test'

# Canonical + legacy table env vars read by `resolve_table_env` at module scope.
_TABLE_ENV_VARS = ('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
_TEST_TABLE_NAME = 'test-keywords-table'

# The field set produced by `create_keyword` in `manage-keywords.py`.
_ITEM_FIELDS = {
    'id',
    'keyword',
    'status',
    'created_at',
    'updated_at',
    'region',
    'language',
    'category',
    'priority',
    'notes',
}


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

# Mixed-case keyword texts, so "original casing preserved" is a real assertion
# rather than an accident of an all-lowercase vocabulary.
_KEYWORD_TEXTS = st.sampled_from([
    'Best Running Shoes',
    'trail running SHOES',
    'Marathon Training Plan',
    'lightweight Racing Flats',
    'RUNNING shoe Reviews',
])

# `create_items` receives entries that `partition_keywords` has already trimmed
# and de-duplicated, so the generated entries are distinct and trimmed.
_TO_CREATE = st.lists(
    st.one_of(
        _KEYWORD_TEXTS.map(lambda text: {'keyword': text}),
        _KEYWORD_TEXTS.map(
            lambda text: {'keyword': text, 'intent': 'commercial', 'source': 'expansion'}
        ),
    ),
    min_size=1,
    max_size=10,
    unique_by=lambda entry: entry['keyword'],
)

# Index into an allowed-values tuple; resolved with `% len(...)` inside the test
# so this file never assumes how many allowed values exist.
_ALLOWED_INDEX = st.integers(min_value=0, max_value=99)

# The two forms that mean "not supplied" and resolve to the documented defaults.
_OMITTED_OR_EMPTY = st.sampled_from([None, ''])

# Either an allowed-value index (int) or an omitted/empty marker.
_SUPPLIED_VALUE = st.one_of(_ALLOWED_INDEX, _OMITTED_OR_EMPTY)


def _resolve(supplied, allowed_values, default):
    """Resolve a generated draw the way `validate_request` resolves a request."""
    if isinstance(supplied, int):
        return allowed_values[supplied % len(allowed_values)]
    return default


def _assert_utc_wire_timestamp(value):
    """Assert a timestamp is UTC ISO-8601 in the trailing-'Z' wire format."""
    assert value.endswith('Z'), f'Timestamp {value!r} lacks the trailing Z'

    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))

    assert parsed.utcoffset() == UTC.utcoffset(None), f'Timestamp {value!r} is not UTC'


# --- Property tests ---------------------------------------------------------


class TestCreateItemsKeywordTextProperty:
    """
    **Property 2: Stored keyword text is the trimmed research text**

    For any created Active_Keyword, its stored `keyword` value equals the
    corresponding research keyword text with leading and trailing whitespace
    removed and its original casing preserved -- never the lower-cased
    normalization key used for de-duplication.

    **Validates: Requirements 1.2**
    """

    @given(to_create=_TO_CREATE, status=_SUPPLIED_VALUE, priority=_SUPPLIED_VALUE)
    @settings(max_examples=100)
    def test_stored_keyword_equals_the_trimmed_original_text_when_items_are_built(
        self, _promote_keywords, to_create, status, priority
    ):
        resolved_status = _resolve(
            status, _promote_keywords.ALLOWED_STATUSES, _promote_keywords.DEFAULT_STATUS
        )
        resolved_priority = _resolve(
            priority, _promote_keywords.ALLOWED_PRIORITIES, _promote_keywords.DEFAULT_PRIORITY
        )

        items = _promote_keywords.create_items(to_create, resolved_status, resolved_priority)

        assert len(items) == len(to_create), f'Expected {len(to_create)} items, got {len(items)}'
        for entry, item in zip(to_create, items, strict=True):
            assert item['keyword'] == entry['keyword'].strip(), (
                f'Expected trimmed text {entry["keyword"].strip()!r}, got {item["keyword"]!r}'
            )

    @given(to_create=_TO_CREATE)
    @settings(max_examples=50)
    def test_stored_keyword_is_not_the_normalized_key_when_text_has_upper_case(
        self, _promote_keywords, to_create
    ):
        items = _promote_keywords.create_items(
            to_create, _promote_keywords.DEFAULT_STATUS, _promote_keywords.DEFAULT_PRIORITY
        )

        for entry, item in zip(to_create, items, strict=True):
            expected = entry['keyword'].strip()
            assert item['keyword'] == expected, f'Casing changed to {item["keyword"]!r}'
            if expected != _promote_keywords.normalize_keyword(expected):
                assert item['keyword'] != _promote_keywords.normalize_keyword(expected), (
                    f'Stored the normalized key instead of {expected!r}'
                )


class TestCreateItemsIdentityProperty:
    """
    **Property 3: Created items get unique ids and equal UTC timestamps**

    For any successful promotion, every created item has an `id` distinct from
    all other created items, and each item's `created_at` equals its
    `updated_at` and is a UTC ISO-8601 timestamp with the trailing 'Z' wire
    format. All items built in one call share the same timestamp value.

    **Validates: Requirements 1.3**
    """

    @given(to_create=_TO_CREATE)
    @settings(max_examples=100)
    def test_ids_are_unique_when_multiple_items_are_built(self, _promote_keywords, to_create):
        items = _promote_keywords.create_items(
            to_create, _promote_keywords.DEFAULT_STATUS, _promote_keywords.DEFAULT_PRIORITY
        )

        ids = [item['id'] for item in items]
        assert len(set(ids)) == len(ids), f'Duplicate ids in {ids}'
        for item_id in ids:
            assert item_id, 'Created item carries an empty id'

    @given(to_create=_TO_CREATE)
    @settings(max_examples=100)
    def test_created_at_equals_updated_at_in_utc_wire_format_when_items_are_built(
        self, _promote_keywords, to_create
    ):
        items = _promote_keywords.create_items(
            to_create, _promote_keywords.DEFAULT_STATUS, _promote_keywords.DEFAULT_PRIORITY
        )

        for item in items:
            assert item['created_at'] == item['updated_at'], (
                f'created_at {item["created_at"]!r} != updated_at {item["updated_at"]!r}'
            )
            _assert_utc_wire_timestamp(item['created_at'])

    @given(to_create=_TO_CREATE)
    @settings(max_examples=50)
    def test_all_items_share_one_timestamp_when_built_in_a_single_call(
        self, _promote_keywords, to_create
    ):
        items = _promote_keywords.create_items(
            to_create, _promote_keywords.DEFAULT_STATUS, _promote_keywords.DEFAULT_PRIORITY
        )

        timestamps = {item['created_at'] for item in items}
        assert len(timestamps) == 1, f'Expected one shared timestamp, got {timestamps}'


class TestCreateItemsStatusProperty:
    """
    **Property 8: Status resolution applies to every created item**

    For any promotion request, when a valid status (`active` / `inactive` /
    `paused`, matched exactly) is supplied, every created item carries that
    status; when the status is omitted or empty, every created item carries
    `active`.

    **Validates: Requirements 3.1, 3.2**
    """

    @given(to_create=_TO_CREATE, status=_SUPPLIED_VALUE)
    @settings(max_examples=100)
    def test_every_item_carries_the_resolved_status_when_status_is_supplied_or_omitted(
        self, _promote_keywords, to_create, status
    ):
        resolved_status = _resolve(
            status, _promote_keywords.ALLOWED_STATUSES, _promote_keywords.DEFAULT_STATUS
        )

        items = _promote_keywords.create_items(
            to_create, resolved_status, _promote_keywords.DEFAULT_PRIORITY
        )

        for item in items:
            assert item['status'] == resolved_status, (
                f'Expected status {resolved_status!r}, got {item["status"]!r}'
            )


class TestCreateItemsPriorityProperty:
    """
    **Property 9: Priority resolution applies to every created item**

    For any promotion request, when a valid priority (`high` / `normal` / `low`,
    matched exactly) is supplied, every created item carries that priority; when
    the priority is omitted or empty, every created item carries `normal`.

    **Validates: Requirements 3.3, 3.4**
    """

    @given(to_create=_TO_CREATE, priority=_SUPPLIED_VALUE)
    @settings(max_examples=100)
    def test_every_item_carries_the_resolved_priority_when_priority_is_supplied_or_omitted(
        self, _promote_keywords, to_create, priority
    ):
        resolved_priority = _resolve(
            priority, _promote_keywords.ALLOWED_PRIORITIES, _promote_keywords.DEFAULT_PRIORITY
        )

        items = _promote_keywords.create_items(
            to_create, _promote_keywords.DEFAULT_STATUS, resolved_priority
        )

        for item in items:
            assert item['priority'] == resolved_priority, (
                f'Expected priority {resolved_priority!r}, got {item["priority"]!r}'
            )


# --- Example tests ----------------------------------------------------------


class TestCreateItemsUnit:
    """Example-based coverage of the documented Active_Keyword item shape."""

    def test_item_matches_the_create_keyword_field_set_when_context_is_present(
        self, _promote_keywords
    ):
        to_create = [{
            'keyword': 'Best Running Shoes',
            'intent': 'commercial',
            'competition': 'high',
            'source': 'expansion',
        }]

        items = _promote_keywords.create_items(to_create, 'paused', 'high')

        item = items[0]
        assert set(item) == _ITEM_FIELDS, f'Unexpected item fields {sorted(item)}'
        assert item['keyword'] == 'Best Running Shoes', f'Unexpected keyword {item["keyword"]!r}'
        assert item['status'] == 'paused', f'Unexpected status {item["status"]!r}'
        assert item['priority'] == 'high', f'Unexpected priority {item["priority"]!r}'
        assert item['region'] == _promote_keywords.DEFAULT_REGION, 'Unexpected region default'
        assert item['language'] == _promote_keywords.DEFAULT_LANGUAGE, 'Unexpected language default'
        assert item['category'] == _promote_keywords.DEFAULT_CATEGORY, 'Unexpected category default'
        assert item['notes'] == _promote_keywords.build_notes(to_create[0]), (
            f'Unexpected notes {item["notes"]!r}'
        )

    def test_notes_are_empty_when_no_research_context_is_present(self, _promote_keywords):
        to_create = [{'keyword': 'trail running shoes'}]

        items = _promote_keywords.create_items(
            to_create, _promote_keywords.DEFAULT_STATUS, _promote_keywords.DEFAULT_PRIORITY
        )

        assert items[0]['notes'] == '', f'Expected empty notes, got {items[0]["notes"]!r}'

    def test_no_items_are_built_when_nothing_was_accepted(self, _promote_keywords):
        items = _promote_keywords.create_items(
            [], _promote_keywords.DEFAULT_STATUS, _promote_keywords.DEFAULT_PRIORITY
        )

        assert items == [], f'Expected no items, got {items}'

    @pytest.mark.parametrize(
        ('status', 'priority'),
        [
            ('active', 'normal'),
            ('inactive', 'high'),
            ('paused', 'low'),
        ],
    )
    def test_resolved_values_reach_every_item_when_batch_has_several_keywords(
        self, _promote_keywords, status, priority
    ):
        to_create = [
            {'keyword': 'Best Running Shoes'},
            {'keyword': 'Trail Running Shoes'},
            {'keyword': 'Marathon Training Plan'},
        ]

        items = _promote_keywords.create_items(to_create, status, priority)

        assert len(items) == 3, f'Expected three items, got {len(items)}'
        for item in items:
            assert item['status'] == status, f'Unexpected status {item["status"]!r}'
            assert item['priority'] == priority, f'Unexpected priority {item["priority"]!r}'
