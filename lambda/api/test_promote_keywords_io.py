"""
Mocked-`boto3` tests for the DynamoDB read/write steps of the promotion handler.

Covers:
- Property 6: Existing active keywords are never mutated by promotion
  (**Validates: Requirements 2.2, 2.6**)

Context:
    `load_existing_keyword_keys(table)` and `write_items(table, items)` in
    `promote-keywords.py` are the only functions in the promotion path that touch
    DynamoDB. The reader runs a paginated `scan` projecting just the `keyword`
    attribute (through an `ExpressionAttributeNames` alias, so a reserved-word
    collision is impossible) and returns the normalized comparison keys. The
    writer puts the freshly built items through `batch_writer`.

    No AWS-mocking library is used -- none is declared in
    `lambda/requirements-dev.txt`, and the repository convention is to mock the
    AWS SDK at the import boundary. A `MagicMock` stands in for
    `boto3.resource('dynamodb').Table(...)`: its `scan` returns queued pages and
    its `batch_writer()` context manager records the puts.

    Property 6 is asserted structurally: promotion may only ADD items, so the
    tests check that the recorded calls are `put_item` calls carrying exactly the
    new items and that neither the table nor the batch writer ever sees an
    `update_item` or `delete_item` -- the two operations that could change a
    pre-existing Active_Keyword.

    The handler file is hyphenated, so it cannot be imported normally: it is
    loaded through `importlib.util.spec_from_file_location` under a unique module
    name (the `_load_router` pattern in `lambda/api/test_routers_404.py`). The
    module resolves its DynamoDB table and builds a `boto3` resource at import
    time, so the table env vars are set and `boto3.resource` is patched before
    the load happens.

Test outcomes:
    - `load_existing_keyword_keys` returns the normalized (trimmed, lower-cased)
      keys of every scanned item, collapsing whitespace/case variants
    - pagination is actually followed: a `LastEvaluatedKey` triggers a further
      `scan` carrying it as `ExclusiveStartKey`, and keys from every page appear
      in the result
    - the projection is limited to `keyword` via an alias, so no other attribute
      is read
    - `write_items` issues only `put_item` calls, one per created item, and no
      `update_item` / `delete_item` reaches the table or the batch writer
    - `write_items` opens no writer at all when there is nothing to create
    - a `scan` raising `ClientError` propagates, so the request aborts with zero
      writes (Req 2.6)
"""

import importlib.util
import os
import sys
from unittest.mock import MagicMock, call, patch

import pytest
from botocore.exceptions import ClientError
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
_MODULE_NAME = 'promote_keywords_io_under_test'

# Canonical + legacy table env vars read by `resolve_table_env` at module scope.
_TABLE_ENV_VARS = ('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
_TEST_TABLE_NAME = 'test-keywords-table'

# The mutating operations that would break Property 6 if promotion used them.
_MUTATING_OPERATIONS = ('update_item', 'delete_item')


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


# --- Mock table -------------------------------------------------------------


def _scan_pages(text_pages):
    """Build `scan` responses for the given pages of stored keyword texts.

    Every page but the last carries a `LastEvaluatedKey`, so a reader that
    ignores pagination sees only the first page's keys.
    """
    pages = []
    for index, texts in enumerate(text_pages):
        page = {'Items': [{'keyword': text} for text in texts]}
        if index < len(text_pages) - 1:
            page['LastEvaluatedKey'] = {'id': f'page-{index}-last'}
        pages.append(page)
    return pages


def _mock_table(scan_pages=None, scan_error=None):
    """Build a `MagicMock` standing in for the Keywords_Table resource.

    Returns `(table, batch)` where `batch` is the recorder yielded by
    `table.batch_writer()`, so puts made inside the context manager are
    inspectable.
    """
    table = MagicMock()

    if scan_error is not None:
        table.scan.side_effect = scan_error
    else:
        table.scan.side_effect = list(scan_pages or [{'Items': []}])

    batch = MagicMock()
    table.batch_writer.return_value.__enter__.return_value = batch

    return table, batch


def _mutating_calls(*mocks):
    """Collect any update/delete calls recorded across the given mocks."""
    found = []
    for mock in mocks:
        for operation in _MUTATING_OPERATIONS:
            found.extend(getattr(mock, operation).call_args_list)
    return found


# --- Strategies -------------------------------------------------------------

# A small vocabulary so whitespace/case variants of the same text land on
# different pages and must collapse to one normalized key.
_BASE_TEXTS = st.sampled_from([
    'best running shoes',
    'trail running shoes',
    'marathon training plan',
    'lightweight racing flats',
    'running shoe reviews',
])

_PADDING = st.sampled_from(['', ' ', '  ', '\t', ' \t '])

_CASE_TRANSFORMS = st.sampled_from(['lower', 'upper', 'title', 'capitalize', 'swapcase'])


def _variant(text, case_transform, leading, trailing):
    """Build a whitespace/case variant of a text with the same normalized key."""
    return f'{leading}{getattr(text, case_transform)()}{trailing}'


_STORED_TEXTS = st.builds(_variant, _BASE_TEXTS, _CASE_TRANSFORMS, _PADDING, _PADDING)

# Two or more pages, so every generated case exercises pagination.
_TEXT_PAGES = st.lists(
    st.lists(_STORED_TEXTS, min_size=0, max_size=4),
    min_size=2,
    max_size=4,
)

# Item-shaped inputs for `write_items`, distinct by keyword the way
# `create_items` output is.
_NEW_ITEMS = st.lists(
    _BASE_TEXTS.map(lambda text: {'id': f'id-{text}', 'keyword': text, 'status': 'active'}),
    min_size=1,
    max_size=5,
    unique_by=lambda item: item['keyword'],
)


# --- Property tests ---------------------------------------------------------


class TestPromotionIoProperty:
    """
    **Property 6: Existing active keywords are never mutated by promotion**

    For any promotion request over any set of existing active keywords, every
    pre-existing item in the Keywords Table is unchanged after promotion: the
    read path only scans, and the write path only puts the newly created items.
    No `update_item` or `delete_item` is ever issued. When the read fails, the
    request aborts before any write happens (Req 2.6).

    **Validates: Requirements 2.2, 2.6**
    """

    @given(text_pages=_TEXT_PAGES)
    @settings(max_examples=50)
    def test_scan_returns_normalized_keys_from_every_page_when_results_are_paginated(
        self, _promote_keywords, text_pages
    ):
        table, _batch = _mock_table(scan_pages=_scan_pages(text_pages))
        all_texts = [text for page in text_pages for text in page]
        expected = {
            _promote_keywords.normalize_keyword(text)
            for text in all_texts
            if _promote_keywords.normalize_keyword(text)
        }

        keys = _promote_keywords.load_existing_keyword_keys(table)

        assert keys == expected, f'Expected normalized keys {expected}, got {keys}'
        assert table.scan.call_count == len(text_pages), (
            f'Expected {len(text_pages)} scan calls, got {table.scan.call_count}'
        )

    @given(text_pages=_TEXT_PAGES)
    @settings(max_examples=50)
    def test_each_further_scan_carries_the_previous_last_key_when_pages_remain(
        self, _promote_keywords, text_pages
    ):
        pages = _scan_pages(text_pages)
        table, _batch = _mock_table(scan_pages=pages)

        _promote_keywords.load_existing_keyword_keys(table)

        calls = table.scan.call_args_list
        assert 'ExclusiveStartKey' not in calls[0].kwargs, (
            f'First scan should not paginate, got {calls[0].kwargs}'
        )
        for index, scan_call in enumerate(calls[1:]):
            assert scan_call.kwargs.get('ExclusiveStartKey') == pages[index]['LastEvaluatedKey'], (
                f'Scan {index + 1} did not follow the previous LastEvaluatedKey: {scan_call.kwargs}'
            )

    @given(text_pages=_TEXT_PAGES)
    @settings(max_examples=25)
    def test_scan_projects_only_the_keyword_attribute_through_an_alias(
        self, _promote_keywords, text_pages
    ):
        table, _batch = _mock_table(scan_pages=_scan_pages(text_pages))

        _promote_keywords.load_existing_keyword_keys(table)

        for scan_call in table.scan.call_args_list:
            names = scan_call.kwargs.get('ExpressionAttributeNames')
            projection = scan_call.kwargs.get('ProjectionExpression')
            assert names == {'#kw': 'keyword'}, f'Unexpected attribute names {names}'
            assert projection == '#kw', f'Unexpected projection {projection!r}'

    @given(text_pages=_TEXT_PAGES)
    @settings(max_examples=25)
    def test_reading_existing_keys_never_writes_when_the_table_is_scanned(
        self, _promote_keywords, text_pages
    ):
        table, batch = _mock_table(scan_pages=_scan_pages(text_pages))

        _promote_keywords.load_existing_keyword_keys(table)

        table.batch_writer.assert_not_called()
        table.put_item.assert_not_called()
        assert _mutating_calls(table, batch) == [], 'Reading existing keys issued a mutating call'

    @given(items=_NEW_ITEMS)
    @settings(max_examples=50)
    def test_only_puts_of_the_new_items_are_issued_when_items_are_written(
        self, _promote_keywords, items
    ):
        table, batch = _mock_table()

        _promote_keywords.write_items(table, items)

        table.batch_writer.assert_called_once_with()
        assert batch.put_item.call_args_list == [call(Item=item) for item in items], (
            f'Unexpected puts {batch.put_item.call_args_list}'
        )
        assert _mutating_calls(table, batch) == [], 'Promotion issued a mutating call'

    @given(items=_NEW_ITEMS)
    @settings(max_examples=25)
    def test_pre_existing_items_are_never_addressed_when_items_are_written(
        self, _promote_keywords, items
    ):
        existing_item = {'id': 'pre-existing-id', 'keyword': 'best running shoes'}
        table, batch = _mock_table(scan_pages=_scan_pages([[existing_item['keyword']], []]))
        existing_keys = _promote_keywords.load_existing_keyword_keys(table)
        new_items = [
            item for item in items
            if _promote_keywords.normalize_keyword(item['keyword']) not in existing_keys
        ]

        _promote_keywords.write_items(table, new_items)

        written_ids = [
            put_call.kwargs['Item']['id'] for put_call in batch.put_item.call_args_list
        ]
        assert existing_item['id'] not in written_ids, f'Pre-existing id was written: {written_ids}'
        assert _mutating_calls(table, batch) == [], 'Promotion issued a mutating call'

    def test_scan_failure_propagates_with_zero_writes(self, _promote_keywords):
        error = ClientError(
            {'Error': {'Code': 'ProvisionedThroughputExceededException', 'Message': 'slow down'}},
            'Scan',
        )
        table, batch = _mock_table(scan_error=error)

        with pytest.raises(ClientError):
            _promote_keywords.load_existing_keyword_keys(table)

        table.batch_writer.assert_not_called()
        table.put_item.assert_not_called()
        assert batch.put_item.call_args_list == [], 'A failed read still wrote items'
        assert _mutating_calls(table, batch) == [], 'A failed read issued a mutating call'


# --- Example tests ----------------------------------------------------------


class TestPromotionIoUnit:
    """Example-based coverage of the documented read/write edge cases."""

    def test_no_keys_are_returned_when_the_table_is_empty(self, _promote_keywords):
        table, _batch = _mock_table(scan_pages=[{'Items': []}])

        keys = _promote_keywords.load_existing_keyword_keys(table)

        assert keys == set(), f'Expected no keys, got {keys}'
        assert table.scan.call_count == 1, f'Expected a single scan, got {table.scan.call_count}'

    def test_variants_across_pages_collapse_to_one_key_when_scan_is_paginated(
        self, _promote_keywords
    ):
        pages = _scan_pages([['  Best Running Shoes  '], ['BEST RUNNING SHOES']])
        table, _batch = _mock_table(scan_pages=pages)

        keys = _promote_keywords.load_existing_keyword_keys(table)

        assert keys == {'best running shoes'}, f'Expected one collapsed key, got {keys}'

    def test_blank_stored_keywords_are_ignored_when_keys_are_read(self, _promote_keywords):
        pages = [{'Items': [{'keyword': '   '}, {'keyword': None}, {}, {'keyword': 'seo audit'}]}]
        table, _batch = _mock_table(scan_pages=pages)

        keys = _promote_keywords.load_existing_keyword_keys(table)

        assert keys == {'seo audit'}, f'Expected only the real key, got {keys}'

    def test_no_writer_is_opened_when_there_is_nothing_to_create(self, _promote_keywords):
        table, batch = _mock_table()

        _promote_keywords.write_items(table, [])

        table.batch_writer.assert_not_called()
        assert batch.put_item.call_args_list == [], 'An empty write opened a writer'
