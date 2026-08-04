"""
Handler and DynamoDB tests for the keyword-promotion response contract.

Covers:
- Property 4: Response counts match their reported lists
- Property 6: Existing active keywords are never mutated by promotion
- Example coverage of the request-rejection boundaries

`handler(event, context)` orchestrates validate -> read existing keys ->
partition -> build items -> write -> respond, building the success body
`{created, skipped, created_keywords, skipped_keywords}`.

Context:
    Two count rules drive Property 4: `created == len(created_keywords)`, and
    `skipped` is the DUPLICATE-ONLY count (entries whose `reason` is
    `duplicate`), NOT `len(skipped_keywords)` -- that list also carries
    `reason: 'empty'` entries, counted in neither number. So every generated
    request mixes all three cases (existing-duplicate, empty-after-trim, and an
    intra-request repeat), guaranteeing `len(skipped_keywords) > skipped`.
    Intra-request repeats collapse and are reported nowhere, so `created +
    skipped` can be smaller than the request length.

    Property 6 is asserted structurally: promotion may only ADD items, so the
    tests check the recorded calls are `put_item` calls carrying exactly the new
    items and that no `update_item` / `delete_item` is ever issued. A `MagicMock`
    stands in for the Keywords_Table (no AWS-mocking library is declared): its
    `scan` returns queued pages and its `batch_writer()` records the puts. Each
    invocation swaps the module-level `keywords_table` for the mock via
    `patch.object`; the handler is loaded through the `promotion_handler` fixture
    (the `_load_router` pattern from `test_routers_404.py`).
"""

import importlib
import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, call, patch

import pytest
from botocore.exceptions import ClientError
from hypothesis import given, settings
from hypothesis import strategies as st

pytestmark = pytest.mark.usefixtures('table_env_cleared')


# --- Import-boundary bootstrap ----------------------------------------------
#
# `promote-keywords.py` is hyphenated and builds a `boto3` DynamoDB resource at
# import time, so it is loaded fresh via `spec_from_file_location` under a module
# name unique to THIS file (the `_load_router` pattern from `test_routers_404.py`)
# with the layer `shared` on `sys.path`, table env vars set, and `boto3` patched
# BEFORE the load. Every global mutation is undone on teardown; nothing is
# autouse, so the pre-existing tests in this directory are untouched.

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_API_DIR, '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')

_PROMOTE_HANDLER_FILE = 'promote-keywords.py'
_PROMOTE_MODULE_NAME = 'promote_keywords_under_test_handler_io'
_TABLE_ENV_VARS = ('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
_TEST_TABLE_NAME = 'test-keywords-table'


def _load_promotion_handler():
    """Load `promote-keywords.py` fresh under this file's unique module name.

    `shared/__init__.py` re-exports `api_response` as a function, shadowing the
    submodule, so the real module object is bound explicitly -- otherwise the
    handler's `from shared.api_response import ...` resolves to the function.
    """
    if _LAYER_PY not in sys.path:
        sys.path.insert(0, _LAYER_PY)
    sys.modules['shared.api_response'] = importlib.import_module('shared.api_response')
    sys.modules.pop(_PROMOTE_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _PROMOTE_MODULE_NAME, os.path.join(_API_DIR, _PROMOTE_HANDLER_FILE)
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope='module')
def promotion_handler():
    """`promote-keywords.py`, loaded once for this module with `boto3` patched."""
    saved = {name: os.environ.get(name) for name in _TABLE_ENV_VARS}
    for name in _TABLE_ENV_VARS:
        os.environ[name] = _TEST_TABLE_NAME

    with (
        patch('boto3.resource', MagicMock(name='boto3.resource')),
        patch('boto3.client', MagicMock(name='boto3.client')),
    ):
        yield _load_promotion_handler()

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    sys.modules.pop(_PROMOTE_MODULE_NAME, None)


@pytest.fixture
def table_env_cleared():
    """Save, clear, and restore the Keywords table env vars around one test."""
    saved = {name: os.environ.get(name) for name in _TABLE_ENV_VARS}
    for name in _TABLE_ENV_VARS:
        os.environ.pop(name, None)

    yield

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value

# The COMPLETE created item's field set, as `create_items` produces it.
_CREATED_ENTRY_FIELDS = {
    'id', 'keyword', 'status', 'created_at', 'updated_at',
    'region', 'language', 'category', 'priority', 'notes',
}

# The mutating operations that would break Property 6 if promotion used them.
_MUTATING_OPERATIONS = ('update_item', 'delete_item')


# --- Mock table and invocation ---------------------------------------------


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
    """Build a `MagicMock` Keywords_Table, returning `(table, batch)` where
    `batch` records the puts yielded by `table.batch_writer()`.
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


def _invoke(module, table, keywords, status=None, priority=None):
    """Invoke the handler against the mock table and decode its response."""
    body = {'keywords': keywords}
    if status is not None:
        body['status'] = status
    if priority is not None:
        body['priority'] = priority

    event = {
        'httpMethod': 'POST',
        'path': '/api/keywords/promote',
        'headers': {},
        'body': json.dumps(body),
    }

    with patch.object(module, 'keywords_table', table):
        response = module.handler(event, None)

    return response['statusCode'], json.loads(response['body'])


def _supplied(drawn, allowed_values):
    """Turn a drawn status/priority into the value the request should carry.

    An integer selects an allowed value; `None`/`''` pass through as the two
    "not supplied" forms.
    """
    if isinstance(drawn, int):
        return allowed_values[drawn % len(allowed_values)]
    return drawn


# --- Strategies -------------------------------------------------------------

# A small vocabulary so existing keywords and request entries collide often.
_BASE_TEXTS = st.sampled_from([
    'best running shoes',
    'trail running shoes',
    'marathon training plan',
    'lightweight racing flats',
    'running shoe reviews',
    'seo audit checklist',
])

_PADDING = st.sampled_from(['', ' ', '  ', '\t', ' \t '])

_CASE_TRANSFORMS = st.sampled_from(['lower', 'upper', 'title', 'capitalize', 'swapcase'])

# Texts that are empty once trimmed.
_EMPTY_TEXTS = st.sampled_from(['', ' ', '   ', '\t', ' \t\n '])

# Index into an allowed-values tuple, resolved with `% len(...)` in the test.
_ALLOWED_INDEX = st.integers(min_value=0, max_value=99)

# Either an allowed-value index (int) or a "not supplied" marker (None/'').
_SUPPLIED_VALUE = st.one_of(_ALLOWED_INDEX, st.sampled_from([None, '']))

_CONTEXT_FIELDS = st.fixed_dictionaries(
    {},
    optional={
        'intent': st.sampled_from(['commercial', 'informational']),
        'competition': st.sampled_from(['high', 'low']),
        'source': st.sampled_from(['expansion', 'competitor']),
    },
)


def _variant(text, case_transform, leading, trailing):
    """Build a whitespace/case variant of a text with the same normalized key."""
    return f'{leading}{getattr(text, case_transform)()}{trailing}'


def _variants_of(text):
    """A strategy for whitespace/case variants of one concrete text."""
    return st.builds(_variant, st.just(text), _CASE_TRANSFORMS, _PADDING, _PADDING)


@st.composite
def _promotion_scenarios(draw):
    """Draw `(existing_texts, keywords, status, priority)` mixing every skip case.

    Each request is guaranteed to contain an entry duplicating an EXISTING
    keyword (reported and counted in `skipped`), an entry empty after trimming
    (reported but counted in neither number), and an intra-request repeat
    (collapsed, reported nowhere), so every example has
    `len(skipped_keywords) > skipped`. `status`/`priority` are held in their
    drawn form and resolved by `_invoke_scenario`.
    """
    vocabulary = draw(st.lists(_BASE_TEXTS, min_size=2, max_size=4, unique=True))
    existing_text, new_text = vocabulary[0], vocabulary[1]

    entries = [
        {**draw(_CONTEXT_FIELDS), 'keyword': draw(_variants_of(existing_text))},
        {'keyword': draw(_EMPTY_TEXTS)},
        {**draw(_CONTEXT_FIELDS), 'keyword': draw(_variants_of(new_text))},
        {'keyword': draw(_variants_of(new_text))},
    ]
    entries.extend(
        draw(
            st.lists(
                st.one_of(
                    st.builds(
                        lambda text, context: {**context, 'keyword': text},
                        st.one_of(*[_variants_of(text) for text in vocabulary]),
                        _CONTEXT_FIELDS,
                    ),
                    _EMPTY_TEXTS.map(lambda text: {'keyword': text}),
                ),
                max_size=5,
            )
        )
    )

    return (
        [existing_text],
        list(draw(st.permutations(entries))),
        draw(_SUPPLIED_VALUE),
        draw(_SUPPLIED_VALUE),
    )


def _invoke_scenario(module, table, scenario):
    """Invoke the handler for a drawn scenario, resolving status and priority."""
    _existing_texts, keywords, status, priority = scenario

    return _invoke(
        module,
        table,
        keywords,
        _supplied(status, module.ALLOWED_STATUSES),
        _supplied(priority, module.ALLOWED_PRIORITIES),
    )


# Two or more pages of stored keyword texts, so every generated case exercises
# pagination, with whitespace/case variants that must collapse to one key.
_TEXT_PAGES = st.lists(
    st.lists(st.builds(_variant, _BASE_TEXTS, _CASE_TRANSFORMS, _PADDING, _PADDING),
             min_size=0, max_size=4),
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

# Failure codes a `scan` can raise; any of them must abort the request.
_SCAN_ERROR_CODES = st.sampled_from([
    'ProvisionedThroughputExceededException',
    'InternalServerError',
    'ResourceNotFoundException',
    'AccessDeniedException',
])


# --- Property tests ---------------------------------------------------------


class TestPromotionResponseProperty:
    """
    **Property 4: Response counts match their reported lists**

    `created` equals `len(created_keywords)`, and `skipped` equals the count of
    `duplicate`-reason entries in `skipped_keywords` -- not its full length,
    which also holds `empty` entries. Each reported created entry is the complete
    written item.
    """

    @given(scenario=_promotion_scenarios())
    @settings(max_examples=100)
    def test_counts_match_their_reported_lists_when_request_mixes_every_skip_case(
        self, promotion_handler, scenario
    ):
        existing_texts, _keywords, _status, _priority = scenario
        table, batch = _mock_table(scan_pages=_scan_pages([existing_texts]))

        status_code, body = _invoke_scenario(promotion_handler, table, scenario)

        assert status_code == 200, f'Expected 200, got {status_code}: {body}'
        assert body['created'] == len(body['created_keywords']), (
            f'created {body["created"]} != len(created_keywords) {len(body["created_keywords"])}'
        )
        duplicates = [
            entry for entry in body['skipped_keywords']
            if entry['reason'] == promotion_handler.REASON_DUPLICATE
        ]
        assert body['skipped'] == len(duplicates), (
            f'skipped {body["skipped"]} != duplicate-reason count {len(duplicates)} '
            f'in {body["skipped_keywords"]}'
        )
        # Every generated request carries at least one empty-after-trim entry, so
        # the reported list is strictly longer than the duplicate-only count.
        assert len(body['skipped_keywords']) > body['skipped'], (
            f'Expected empty entries beyond the {body["skipped"]} counted duplicates, '
            f'got {body["skipped_keywords"]}'
        )
        assert any(
            entry['reason'] == promotion_handler.REASON_EMPTY
            for entry in body['skipped_keywords']
        ), f'No empty-reason entry reported in {body["skipped_keywords"]}'
        for entry in body['created_keywords']:
            assert set(entry) == _CREATED_ENTRY_FIELDS, f'Unexpected entry shape {entry!r}'
            assert entry['id'], f'Created entry carries an empty id: {entry!r}'
            assert entry['created_at'] == entry['updated_at'], (
                f'Created entry timestamps differ: {entry!r}'
            )
        written = [put_call.kwargs['Item'] for put_call in batch.put_item.call_args_list]
        assert written == body['created_keywords'], (
            f'Written items do not match the reported ones: {written}'
        )


class TestPromotionPersistenceProperty:
    """
    **Property 6: Existing active keywords are never mutated by promotion**

    The read path only scans (following `LastEvaluatedKey`, projecting `keyword`
    through an alias) and the write path only puts new items; no `update_item`
    or `delete_item` is ever issued. A failed read aborts before any write.
    """

    @given(text_pages=_TEXT_PAGES, items=_NEW_ITEMS)
    @settings(max_examples=50)
    def test_reads_only_scan_and_writes_only_put_new_items_when_table_is_paginated(
        self, promotion_handler, text_pages, items
    ):
        pages = _scan_pages(text_pages)
        table, batch = _mock_table(scan_pages=pages)
        all_texts = [text for page in text_pages for text in page]
        expected_keys = {
            promotion_handler.normalize_keyword(text)
            for text in all_texts
            if promotion_handler.normalize_keyword(text)
        }

        existing_keys = promotion_handler.load_existing_keyword_keys(table)

        assert existing_keys == expected_keys, (
            f'Expected normalized keys {expected_keys}, got {existing_keys}'
        )
        scan_calls = table.scan.call_args_list
        assert len(scan_calls) == len(pages), (
            f'Expected {len(pages)} scan calls, got {len(scan_calls)}'
        )
        assert 'ExclusiveStartKey' not in scan_calls[0].kwargs, (
            f'First scan should not paginate, got {scan_calls[0].kwargs}'
        )
        for scan_call in scan_calls:
            assert scan_call.kwargs.get('ExpressionAttributeNames') == {'#kw': 'keyword'}, (
                f'Unexpected attribute names {scan_call.kwargs}'
            )
            assert scan_call.kwargs.get('ProjectionExpression') == '#kw', (
                f'Unexpected projection {scan_call.kwargs}'
            )
        for index, scan_call in enumerate(scan_calls[1:]):
            assert scan_call.kwargs.get('ExclusiveStartKey') == pages[index]['LastEvaluatedKey'], (
                f'Scan {index + 1} did not follow the previous LastEvaluatedKey: {scan_call.kwargs}'
            )
        table.batch_writer.assert_not_called()
        assert _mutating_calls(table, batch) == [], 'Reading existing keys issued a mutating call'

        new_items = [
            item for item in items
            if promotion_handler.normalize_keyword(item['keyword']) not in existing_keys
        ]
        promotion_handler.write_items(table, new_items)

        if new_items:
            table.batch_writer.assert_called_once_with()
        assert batch.put_item.call_args_list == [call(Item=item) for item in new_items], (
            f'Unexpected puts {batch.put_item.call_args_list}'
        )
        table.put_item.assert_not_called()
        assert _mutating_calls(table, batch) == [], 'Promotion issued a mutating call'

    @given(scan_error_code=_SCAN_ERROR_CODES)
    @settings(max_examples=10)
    def test_read_failure_propagates_with_zero_writes_when_scan_raises(
        self, promotion_handler, scan_error_code
    ):
        error = ClientError({'Error': {'Code': scan_error_code, 'Message': 'no'}}, 'Scan')
        table, batch = _mock_table(scan_error=error)

        with pytest.raises(ClientError):
            promotion_handler.load_existing_keyword_keys(table)

        table.batch_writer.assert_not_called()
        table.put_item.assert_not_called()
        assert batch.put_item.call_args_list == [], 'A failed read still wrote items'
        assert _mutating_calls(table, batch) == [], 'A failed read issued a mutating call'


# --- Example tests ----------------------------------------------------------


class TestPromotionPersistenceUnit:
    """Example coverage of the documented read/write edge cases."""

    def test_no_keys_are_returned_when_the_table_is_empty(self, promotion_handler):
        table, _batch = _mock_table(scan_pages=[{'Items': []}])

        keys = promotion_handler.load_existing_keyword_keys(table)

        assert keys == set(), f'Expected no keys, got {keys}'
        assert table.scan.call_count == 1, f'Expected a single scan, got {table.scan.call_count}'

    def test_blank_stored_keywords_are_ignored_when_keys_are_read(self, promotion_handler):
        pages = [{'Items': [{'keyword': '   '}, {'keyword': None}, {}, {'keyword': 'seo audit'}]}]
        table, _batch = _mock_table(scan_pages=pages)

        keys = promotion_handler.load_existing_keyword_keys(table)

        assert keys == {'seo audit'}, f'Expected only the real key, got {keys}'

    def test_no_writer_is_opened_when_there_is_nothing_to_create(self, promotion_handler):
        table, batch = _mock_table()

        promotion_handler.write_items(table, [])

        table.batch_writer.assert_not_called()
        assert batch.put_item.call_args_list == [], 'An empty write opened a writer'


class TestPromotionValidationUnit:
    """Example coverage of the request-rejection boundaries."""

    def test_request_is_rejected_when_keyword_list_is_empty(self, promotion_handler):
        table, batch = _mock_table()

        status_code, body = _invoke(promotion_handler, table, [])

        assert status_code == 400, f'Expected 400, got {status_code}: {body}'
        assert body['field'] == 'keywords', f'Unexpected field {body.get("field")!r}'
        assert 'error' in body, f'Missing error message in {body}'
        table.scan.assert_not_called()
        table.batch_writer.assert_not_called()
        assert batch.put_item.call_args_list == [], 'A rejected request wrote items'

    def test_request_is_rejected_when_keyword_count_exceeds_the_maximum(self, promotion_handler):
        table, batch = _mock_table()
        keywords = [
            {'keyword': f'keyword {index}'}
            for index in range(promotion_handler.MAX_KEYWORDS + 1)
        ]

        status_code, body = _invoke(promotion_handler, table, keywords)

        assert status_code == 400, f'Expected 400, got {status_code}: {body}'
        assert str(promotion_handler.MAX_KEYWORDS) in body['error'], (
            f'Error should name the {promotion_handler.MAX_KEYWORDS} limit: {body["error"]!r}'
        )
        table.scan.assert_not_called()
        table.batch_writer.assert_not_called()
        assert batch.put_item.call_args_list == [], 'A rejected request wrote items'

    def test_request_is_rejected_when_a_trimmed_keyword_exceeds_the_length_limit(
        self, promotion_handler
    ):
        table, batch = _mock_table()
        too_long = 'a' * (promotion_handler.MAX_KEYWORD_LENGTH + 1)
        keywords = [{'keyword': 'best running shoes'}, {'keyword': f'  {too_long}  '}]

        status_code, body = _invoke(promotion_handler, table, keywords)

        assert status_code == 400, f'Expected 400, got {status_code}: {body}'
        assert str(promotion_handler.MAX_KEYWORD_LENGTH) in body['error'], (
            f'Error should name the {promotion_handler.MAX_KEYWORD_LENGTH}-character limit: '
            f'{body["error"]!r}'
        )
        table.scan.assert_not_called()
        table.batch_writer.assert_not_called()
        assert batch.put_item.call_args_list == [], 'A rejected request wrote items'

    @pytest.mark.parametrize(
        'keywords',
        [
            [{'keyword': ''}],
            [{'keyword': '   '}],
            [{'keyword': '\t'}, {'keyword': '\n'}],
            [{'keyword': ' '}, {'keyword': None}, {'intent': 'commercial'}],
        ],
    )
    def test_request_is_rejected_when_every_keyword_is_empty_after_trim(
        self, promotion_handler, keywords
    ):
        table, batch = _mock_table()

        status_code, body = _invoke(promotion_handler, table, keywords)

        assert status_code == 400, f'Expected 400, got {status_code}: {body}'
        assert body['field'] == 'keywords', f'Unexpected field {body.get("field")!r}'
        table.scan.assert_not_called()
        table.batch_writer.assert_not_called()
        assert batch.put_item.call_args_list == [], 'A rejected request wrote items'
