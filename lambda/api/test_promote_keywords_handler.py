"""
Handler-level tests for the promotion response contract and rejection boundaries.

Covers:
- Property 4: Response counts match their reported lists
  (**Validates: Requirements 1.4, 2.5**)
- Example coverage of the request-rejection boundaries
  (**Validates: Requirements 1.6, 7.1, 7.3, 7.4**)

Context:
    `handler(event, context)` in `promote-keywords.py` orchestrates
    validate -> read existing keys -> partition -> build items -> write ->
    respond, and builds the success body:

        {created, skipped, created_keywords, skipped_keywords}

    Two count rules drive the property below:
    - `created == len(created_keywords)`;
    - `skipped` is the DUPLICATE-ONLY count -- the number of `skipped_keywords`
      entries whose `reason` is `duplicate`. It is NOT `len(skipped_keywords)`,
      because that list also carries `reason: 'empty'` entries (Req 7.2), which
      are counted in neither `created` nor `skipped`.

    To make that distinction testable, every generated request is guaranteed to
    mix all three cases in one payload: an entry duplicating an EXISTING
    keyword, an entry that is empty after trimming, and an entry repeated within
    the request. So each example genuinely has `len(skipped_keywords) > skipped`,
    which a test using the wrong (`len(skipped_keywords)`) reading would fail.
    `created + skipped` is deliberately NOT compared against the number of
    request entries: intra-request repeats collapse (Req 2.3) and are reported
    nowhere, so the sum can be smaller.

    No AWS-mocking library is used -- none is declared in
    `lambda/requirements-dev.txt`, and the repository convention is to mock the
    AWS SDK at the import boundary. A `MagicMock` stands in for the
    Keywords_Table: its `scan` returns the existing keywords and its
    `batch_writer()` context manager records the puts. The handler reads the
    module-level `keywords_table`, so each invocation swaps that attribute for
    the mock through `patch.object`.

    The handler file is hyphenated, so it cannot be imported normally: it is
    loaded through `importlib.util.spec_from_file_location` under a unique module
    name (the `_load_router` pattern in `lambda/api/test_routers_404.py`). The
    module resolves its DynamoDB table and builds a `boto3` resource at import
    time, so the table env vars are set and `boto3.resource` is patched before
    the load happens.

Test outcomes:
    - `created` always equals the length of `created_keywords`
    - `skipped` always equals the number of `duplicate`-reason entries in
      `skipped_keywords`, never its full length
    - `empty`-reason entries are reported yet counted in neither number, so
      `len(skipped_keywords)` exceeds `skipped` whenever a blank entry is sent
    - `created_keywords` entries carry the COMPLETE created item -- the same
      field set `create_items` produces -- with a non-empty `id` and matching
      `created_at` / `updated_at`
    - every created item is actually written, one put per item, and the reported
      entries are exactly the written items
    - an empty keyword list, a >500 entry list, a trimmed keyword over 100
      characters, and an all-blank list each return a 400 validation error,
      create zero items, and perform no scan and no write
"""

import importlib.util
import json
import os
import sys
from typing import NamedTuple
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
_MODULE_NAME = 'promote_keywords_handler_under_test'

# Canonical + legacy table env vars read by `resolve_table_env` at module scope.
_TABLE_ENV_VARS = ('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
_TEST_TABLE_NAME = 'test-keywords-table'

# The fields a `created_keywords` entry carries: the COMPLETE created item, the
# same field set `create_items` produces (mirroring `create_keyword` in
# `manage-keywords.py`).
_CREATED_ENTRY_FIELDS = {
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


# --- Mock table and invocation ---------------------------------------------


def _mock_table(existing_texts=()):
    """Build a `MagicMock` Keywords_Table holding the given existing keywords.

    Returns `(table, batch)` where `batch` is the recorder yielded by
    `table.batch_writer()`, so the puts issued for created items are
    inspectable.
    """
    table = MagicMock()
    table.scan.return_value = {'Items': [{'keyword': text} for text in existing_texts]}

    batch = MagicMock()
    table.batch_writer.return_value.__enter__.return_value = batch

    return table, batch


def _promotion_event(keywords, status=None, priority=None):
    """Build the API Gateway event for a promotion request."""
    body = {'keywords': keywords}
    if status is not None:
        body['status'] = status
    if priority is not None:
        body['priority'] = priority

    return {
        'httpMethod': 'POST',
        'path': '/api/keywords/promote',
        'headers': {},
        'body': json.dumps(body),
    }


def _invoke(module, table, keywords, status=None, priority=None):
    """Invoke the handler against the mock table and decode its response."""
    with patch.object(module, 'keywords_table', table):
        response = module.handler(_promotion_event(keywords, status, priority), None)

    return response['statusCode'], json.loads(response['body'])


class _PromotionScenario(NamedTuple):
    """A drawn promotion request together with the table state it is sent against.

    `status` / `priority` are held in their DRAWN form -- an allowed-value index
    or one of the "not supplied" markers -- and resolved by `_invoke_scenario`.
    """

    existing_texts: list
    keywords: list
    status: object
    priority: object


def _supplied(drawn, allowed_values):
    """Turn a drawn status/priority into the value the request should carry.

    An integer draw selects one of the module's own allowed values, so this file
    never restates which values are allowed; `None` and `''` are passed through
    as the two "not supplied" forms that must resolve to the documented
    defaults.
    """
    if isinstance(drawn, int):
        return allowed_values[drawn % len(allowed_values)]
    return drawn


def _invoke_scenario(module, table, scenario):
    """Invoke the handler for a drawn scenario, resolving status and priority."""
    return _invoke(
        module,
        table,
        scenario.keywords,
        _supplied(scenario.status, module.ALLOWED_STATUSES),
        _supplied(scenario.priority, module.ALLOWED_PRIORITIES),
    )


def _duplicate_count(module, skipped_keywords):
    """Count the duplicate-reason entries, using the module's own reason value."""
    return len([
        entry for entry in skipped_keywords if entry['reason'] == module.REASON_DUPLICATE
    ])


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

# Texts that are empty once trimmed (Req 7.2).
_EMPTY_TEXTS = st.sampled_from(['', ' ', '   ', '\t', ' \t\n '])

# Index into an allowed-values tuple; resolved with `% len(...)` against the
# module's own `ALLOWED_STATUSES` / `ALLOWED_PRIORITIES` inside the test, so this
# file never restates which values are allowed.
_ALLOWED_INDEX = st.integers(min_value=0, max_value=99)

# The two forms that mean "not supplied" and resolve to the documented defaults.
_OMITTED_OR_EMPTY = st.sampled_from([None, ''])

# Either an allowed-value index (int) or an omitted/empty marker.
_SUPPLIED_VALUE = st.one_of(_ALLOWED_INDEX, _OMITTED_OR_EMPTY)

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
    """Draw a `_PromotionScenario` mixing every skip and collapse case.

    Each drawn request is guaranteed to contain all three of:
    - an entry duplicating an EXISTING keyword -> reported AND counted in
      `skipped`;
    - an entry that is empty after trimming -> reported but counted in NEITHER
      `created` nor `skipped` (Req 7.2);
    - an entry repeating another entry of the same request -> collapsed into it
      (Req 2.3), so it is neither created nor reported.

    Arbitrary extra entries are appended and the whole list is permuted, so
    order carries no meaning. Because the empty entry is always present, every
    example has `len(skipped_keywords) > skipped`.
    """
    vocabulary = draw(st.lists(_BASE_TEXTS, min_size=2, max_size=4, unique=True))
    existing_text = vocabulary[0]
    new_text = vocabulary[1]

    entries = [
        {**draw(_CONTEXT_FIELDS), 'keyword': draw(_variants_of(existing_text))},
        {'keyword': draw(_EMPTY_TEXTS)},
        {**draw(_CONTEXT_FIELDS), 'keyword': draw(_variants_of(new_text))},
        {'keyword': draw(_variants_of(new_text))},
    ]

    extras = draw(
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
    entries.extend(extras)

    keywords = draw(st.permutations(entries))

    return _PromotionScenario(
        existing_texts=[existing_text],
        keywords=list(keywords),
        status=draw(_SUPPLIED_VALUE),
        priority=draw(_SUPPLIED_VALUE),
    )


# --- Property tests ---------------------------------------------------------


class TestPromotionResponseProperty:
    """
    **Property 4: Response counts match their reported lists**

    For any promotion outcome, the reported `created` count equals the length of
    the returned `created_keywords` list, and the reported `skipped` count
    equals the number of entries in `skipped_keywords` whose `reason` is
    `duplicate` -- not the length of `skipped_keywords`, which also contains
    `reason: 'empty'` entries.

    **Validates: Requirements 1.4, 2.5**
    """

    @given(scenario=_promotion_scenarios())
    @settings(max_examples=100)
    def test_created_count_equals_the_created_list_length_when_request_mixes_cases(
        self, _promote_keywords, scenario
    ):
        table, _batch = _mock_table(scenario.existing_texts)

        status_code, body = _invoke_scenario(_promote_keywords, table, scenario)

        assert status_code == 200, f'Expected 200, got {status_code}: {body}'
        assert body['created'] == len(body['created_keywords']), (
            f'created {body["created"]} != len(created_keywords) {len(body["created_keywords"])}'
        )

    @given(scenario=_promotion_scenarios())
    @settings(max_examples=100)
    def test_skipped_count_equals_the_duplicate_reason_count_when_request_mixes_cases(
        self, _promote_keywords, scenario
    ):
        table, _batch = _mock_table(scenario.existing_texts)

        status_code, body = _invoke_scenario(_promote_keywords, table, scenario)

        expected = _duplicate_count(_promote_keywords, body['skipped_keywords'])
        assert status_code == 200, f'Expected 200, got {status_code}: {body}'
        assert body['skipped'] == expected, (
            f'skipped {body["skipped"]} != duplicate-reason count {expected} '
            f'in {body["skipped_keywords"]}'
        )

    @given(scenario=_promotion_scenarios())
    @settings(max_examples=100)
    def test_empty_entries_are_reported_but_uncounted_when_request_carries_blanks(
        self, _promote_keywords, scenario
    ):
        table, _batch = _mock_table(scenario.existing_texts)

        _status_code, body = _invoke_scenario(_promote_keywords, table, scenario)

        # Every generated request carries at least one empty-after-trim entry, so
        # the reported list is strictly longer than the duplicate-only count.
        assert len(body['skipped_keywords']) > body['skipped'], (
            f'Expected empty entries beyond the {body["skipped"]} counted duplicates, '
            f'got {body["skipped_keywords"]}'
        )
        assert any(
            entry['reason'] == _promote_keywords.REASON_EMPTY
            for entry in body['skipped_keywords']
        ), f'No empty-reason entry reported in {body["skipped_keywords"]}'

    @given(scenario=_promotion_scenarios())
    @settings(max_examples=50)
    def test_created_entries_carry_the_complete_item_when_items_are_created(
        self, _promote_keywords, scenario
    ):
        table, _batch = _mock_table(scenario.existing_texts)

        _status_code, body = _invoke_scenario(_promote_keywords, table, scenario)

        for entry in body['created_keywords']:
            assert set(entry) == _CREATED_ENTRY_FIELDS, f'Unexpected entry shape {entry!r}'
            assert entry['id'], f'Created entry carries an empty id: {entry!r}'
            assert entry['created_at'] == entry['updated_at'], (
                f'Created entry timestamps differ: {entry!r}'
            )

    @given(scenario=_promotion_scenarios())
    @settings(max_examples=50)
    def test_every_created_keyword_is_written_once_when_promotion_succeeds(
        self, _promote_keywords, scenario
    ):
        table, batch = _mock_table(scenario.existing_texts)

        _status_code, body = _invoke_scenario(_promote_keywords, table, scenario)

        written = [put_call.kwargs['Item'] for put_call in batch.put_item.call_args_list]
        assert len(written) == body['created'], (
            f'Wrote {len(written)} items for a reported created count of {body["created"]}'
        )
        # The response reports the very items that were written, field for field.
        assert written == body['created_keywords'], (
            f'Written items do not match the reported ones: {written}'
        )


# --- Example tests ----------------------------------------------------------


class TestPromotionValidationUnit:
    """Example coverage of the request-rejection boundaries (Req 1.6, 7.1, 7.3, 7.4)."""

    def test_request_is_rejected_when_keyword_list_is_empty(self, _promote_keywords):
        table, batch = _mock_table()

        status_code, body = _invoke(_promote_keywords, table, [])

        assert status_code == 400, f'Expected 400, got {status_code}: {body}'
        assert body['field'] == 'keywords', f'Unexpected field {body.get("field")!r}'
        assert 'error' in body, f'Missing error message in {body}'
        table.scan.assert_not_called()
        table.batch_writer.assert_not_called()
        assert batch.put_item.call_args_list == [], 'A rejected request wrote items'

    def test_request_is_rejected_when_keyword_count_exceeds_the_maximum(self, _promote_keywords):
        table, batch = _mock_table()
        keywords = [
            {'keyword': f'keyword {index}'}
            for index in range(_promote_keywords.MAX_KEYWORDS + 1)
        ]

        status_code, body = _invoke(_promote_keywords, table, keywords)

        assert status_code == 400, f'Expected 400, got {status_code}: {body}'
        assert str(_promote_keywords.MAX_KEYWORDS) in body['error'], (
            f'Error should name the {_promote_keywords.MAX_KEYWORDS} limit: {body["error"]!r}'
        )
        table.scan.assert_not_called()
        table.batch_writer.assert_not_called()
        assert batch.put_item.call_args_list == [], 'A rejected request wrote items'

    def test_request_is_rejected_when_a_trimmed_keyword_exceeds_the_length_limit(
        self, _promote_keywords
    ):
        table, batch = _mock_table()
        too_long = 'a' * (_promote_keywords.MAX_KEYWORD_LENGTH + 1)
        keywords = [{'keyword': 'best running shoes'}, {'keyword': f'  {too_long}  '}]

        status_code, body = _invoke(_promote_keywords, table, keywords)

        assert status_code == 400, f'Expected 400, got {status_code}: {body}'
        assert str(_promote_keywords.MAX_KEYWORD_LENGTH) in body['error'], (
            f'Error should name the {_promote_keywords.MAX_KEYWORD_LENGTH}-character limit: '
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
        self, _promote_keywords, keywords
    ):
        table, batch = _mock_table()

        status_code, body = _invoke(_promote_keywords, table, keywords)

        assert status_code == 400, f'Expected 400, got {status_code}: {body}'
        assert body['field'] == 'keywords', f'Unexpected field {body.get("field")!r}'
        table.scan.assert_not_called()
        table.batch_writer.assert_not_called()
        assert batch.put_item.call_args_list == [], 'A rejected request wrote items'
