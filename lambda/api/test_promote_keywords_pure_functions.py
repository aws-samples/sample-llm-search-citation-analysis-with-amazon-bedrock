"""
Property tests for the pure functions of the keyword-promotion handler.

Covers:
- Property 1: Created set equals distinct, non-empty, non-duplicate keywords
- Property 2: Stored keyword text is the trimmed research text
- Property 3: Created items get unique ids and equal UTC timestamps
- Property 5: Duplicate classification is trim- and case-insensitive against
  existing keywords
- Property 7: Every skipped duplicate is reported with a duplicate indication
- Property 8: Status resolution applies to every created item
- Property 9: Priority resolution applies to every created item
- Property 10: Invalid status or priority rejects the whole request
- Property 11: Notes contain exactly the present research-context fields, labeled

`normalize_keyword`, `validate_request`, `partition_keywords`, `build_notes`,
and `create_items` take plain data and return plain data, so they are
property-testable without AWS. The handler response contract lives in
`test_promote_keywords_handler_io.py`.

Context:
    Three behaviors shape the assertions: `validate_request` resolves
    status/priority BEFORE checking them, so an omitted/empty value is valid and
    becomes the default while present values are matched exactly and
    case-sensitively; `partition_keywords` lets the FIRST occurrence of a
    normalized key win; and intra-request collapsed extras are not reported in
    `skipped`, because a duplicate is defined against the EXISTING active
    keywords. The allowed sets, defaults, skip reasons, and notes field order are
    imported from the module under test rather than restated here.
"""

import importlib
import importlib.util
import os
import sys
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import assume, given, settings
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
_PROMOTE_MODULE_NAME = 'promote_keywords_under_test_pure_functions'
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


# --- Strategies -------------------------------------------------------------

# Small vocabulary so requests collide often (duplicates, case/existing overlap).
_BASE_TEXTS = st.sampled_from([
    'best running shoes',
    'trail running shoes',
    'marathon training plan',
    'lightweight racing flats',
    'running shoe reviews',
])

# Surrounding whitespace only; normalization trims it, so the key is unchanged.
_PADDING = st.sampled_from(['', ' ', '  ', '\t', '\n', ' \t '])

# Case transforms that must not change the comparison key either.
_CASE_TRANSFORMS = st.sampled_from(['lower', 'upper', 'title', 'capitalize', 'swapcase'])

# Texts that are empty once trimmed.
_EMPTY_TEXTS = st.sampled_from(['', ' ', '   ', '\t', '\n', ' \t\n '])

_CONTEXT_FIELDS = st.fixed_dictionaries(
    {},
    optional={
        'intent': st.sampled_from(['commercial', 'informational']),
        'competition': st.sampled_from(['high', 'low']),
        'source': st.sampled_from(['expansion', 'competitor-analysis']),
    },
)


def _variant(text, case_transform, leading, trailing):
    """Build a whitespace/case variant of a text with the same normalized key."""
    return f'{leading}{getattr(text, case_transform)()}{trailing}'


def _variants_of(text):
    """A strategy for whitespace/case variants of one concrete text."""
    return st.builds(_variant, st.just(text), _CASE_TRANSFORMS, _PADDING, _PADDING)


@st.composite
def _partition_scenarios(draw):
    """Draw `(existing_texts, keywords)` mixing every classification case.

    Each request is guaranteed to contain an entry matching an EXISTING keyword
    under a whitespace/case variant (reported duplicate), an entry empty after
    trimming (reported empty), and an entry repeating another entry of the same
    request (collapsed into it, so neither created nor reported). Extra entries
    are appended and the list permuted, so order carries no meaning.
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
                max_size=6,
            )
        )
    )

    return [draw(_variants_of(existing_text))], list(draw(st.permutations(entries)))


# Mixed-case texts, so "original casing preserved" is a real assertion. These
# mimic entries already trimmed and de-duplicated by `partition_keywords`.
_TO_CREATE = st.lists(
    st.builds(
        lambda text, context: {**context, 'keyword': text},
        st.sampled_from([
            'Best Running Shoes',
            'trail running SHOES',
            'Marathon Training Plan',
            'lightweight Racing Flats',
            'RUNNING shoe Reviews',
        ]),
        _CONTEXT_FIELDS,
    ),
    min_size=1,
    max_size=10,
    unique_by=lambda entry: entry['keyword'],
)

# Payloads that clear every gate except status/priority, so only those decide
# the `validate_request` outcome.
_VALID_KEYWORDS = st.lists(
    _BASE_TEXTS.map(lambda text: {'keyword': text}), min_size=1, max_size=5
)

# Index into an allowed-values tuple, resolved with `% len(...)` in the test.
_ALLOWED_INDEX = st.integers(min_value=0, max_value=99)

# The two forms that mean "not supplied" and resolve to the documented defaults.
_OMITTED_OR_EMPTY = st.sampled_from([None, ''])

# Either an allowed-value index (int) or an omitted/empty marker.
_SUPPLIED_VALUE = st.one_of(_ALLOWED_INDEX, _OMITTED_OR_EMPTY)

# Plausible-but-wrong values plus arbitrary text; each is `assume`d outside the
# allowed set so a lucky valid draw is never asserted as a rejection.
_INVALID_CANDIDATES = st.one_of(
    st.sampled_from([
        'archived', 'enabled', 'disabled', 'urgent', 'medium', 'critical',
        'none', '0', ' active', 'active ', 'active,inactive',
    ]),
    st.text(min_size=1, max_size=24),
)

# Every form a status/priority can take; `_resolve_field_spec` turns a draw into
# (value to supply, value that must come back), where None means "reject".
_FIELD_SPEC = st.one_of(
    _ALLOWED_INDEX.map(lambda index: ('allowed', index)),
    _OMITTED_OR_EMPTY.map(lambda value: ('default', value)),
    _INVALID_CANDIDATES.map(lambda value: ('invalid', value)),
    st.tuples(_ALLOWED_INDEX, _CASE_TRANSFORMS).map(lambda pair: ('case-variant', pair)),
)

# Values that make a research-context field ABSENT: omitted key (None), empty
# string, or whitespace-only.
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

_NOTES_FIELD_NAMES = ('intent', 'competition', 'source')

# Each field draws (is_present, raw_value); the expected outcome comes from the
# generator, not a reimplementation of `build_notes`. The all-absent branch is
# offered explicitly so "no field present" is drawn often.
_NOTES_FIELD_SPECS = st.one_of(
    st.fixed_dictionaries({
        field: st.one_of(
            _ABSENT_VALUES.map(lambda value: (False, value)),
            _PRESENT_VALUES.map(lambda value: (True, value)),
        )
        for field in _NOTES_FIELD_NAMES
    }),
    st.fixed_dictionaries({
        field: _ABSENT_VALUES.map(lambda value: (False, value))
        for field in _NOTES_FIELD_NAMES
    }),
)


# --- Expectation helpers ----------------------------------------------------


def _existing_keys(module, texts):
    """Normalize generated existing keyword texts the way the reader does."""
    return {module.normalize_keyword(text) for text in texts}


def _trimmed(rk):
    """The request entry's keyword text as the handler reads it."""
    return str(rk.get('keyword') or '').strip()


def _expected_created_keys(module, keywords, existing_keys):
    """Expected created keys: distinct, non-empty, and not already existing."""
    expected = []
    for rk in keywords:
        key = module.normalize_keyword(_trimmed(rk))
        if not key or key in existing_keys or key in expected:
            continue
        expected.append(key)
    return expected


def _first_text_by_key(module, keywords):
    """The trimmed text of the FIRST request entry carrying each normalized key."""
    first = {}
    for rk in keywords:
        key = module.normalize_keyword(_trimmed(rk))
        if key and key not in first:
            first[key] = _trimmed(rk)
    return first


def _created_keys(module, to_create):
    """Normalized keys of the created entries, in creation order."""
    return [module.normalize_keyword(entry['keyword']) for entry in to_create]


def _with_reason(skipped, reason):
    """Skipped entries carrying a given reason."""
    return [entry for entry in skipped if entry['reason'] == reason]


def _resolve_supplied(drawn, allowed_values, default):
    """Resolve a drawn `_SUPPLIED_VALUE` as `validate_request` would.

    An integer selects an allowed value; `None`/`''` resolve to the default.
    """
    if isinstance(drawn, int):
        return allowed_values[drawn % len(allowed_values)]
    return default


def _resolve_field_spec(spec, allowed_values, default):
    """Turn a drawn status/priority spec into `(supplied, expected)`.

    `expected` is `None` when the form must be rejected; the invalid branches
    `assume` the value really is outside the allowed set.
    """
    kind, payload = spec

    if kind == 'allowed':
        value = allowed_values[payload % len(allowed_values)]
        return value, value
    if kind == 'default':
        return payload, default
    if kind == 'invalid':
        assume(payload != '' and payload not in allowed_values)
        return payload, None

    index, transform = payload
    variant = getattr(allowed_values[index % len(allowed_values)], transform)()
    assume(variant not in allowed_values)
    return variant, None


def _research_keyword(field_specs):
    """Build a research keyword dict from a generated notes field spec.

    A `None` raw value means the key is omitted entirely; every other value is
    carried through verbatim so whitespace handling is exercised.
    """
    keyword = {'keyword': 'best running shoes'}
    for field, (_present, raw_value) in field_specs.items():
        if raw_value is not None:
            keyword[field] = raw_value
    return keyword


def _notes_entries(notes):
    """Split a rendered `notes` value into its labeled entries."""
    return notes.split('; ') if notes else []


def _assert_utc_wire_timestamp(value):
    """Assert a timestamp is UTC ISO-8601 in the trailing-'Z' wire format."""
    assert value.endswith('Z'), f'Timestamp {value!r} lacks the trailing Z'

    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))

    assert parsed.utcoffset() == UTC.utcoffset(None), f'Timestamp {value!r} is not UTC'


# --- Property tests: partition_keywords -------------------------------------


class TestPartitionCreatedSetProperty:
    """
    **Property 1: Created set equals distinct, non-empty, non-duplicate keywords**

    The created set is exactly the normalized keyword texts that are non-empty,
    not already existing, and distinct within the request (first occurrence
    wins). Empty-after-trim entries are reported as `empty`, not created.
    """

    @given(scenario=_partition_scenarios())
    @settings(max_examples=100)
    def test_created_keys_are_distinct_non_empty_and_new_when_request_mixes_variants(
        self, promotion_handler, scenario
    ):
        existing_texts, keywords = scenario
        existing_keys = _existing_keys(promotion_handler, existing_texts)
        expected = _expected_created_keys(promotion_handler, keywords, existing_keys)
        first_text_by_key = _first_text_by_key(promotion_handler, keywords)
        expected_empty = sum(1 for rk in keywords if not _trimmed(rk))

        to_create, skipped = promotion_handler.partition_keywords(keywords, existing_keys)

        created = _created_keys(promotion_handler, to_create)
        assert created == expected, f'Expected created keys {expected}, got {created}'
        assert len(created) == len(set(created)), f'Duplicate creations in {created}'
        for entry in to_create:
            key = promotion_handler.normalize_keyword(entry['keyword'])
            assert entry['keyword'] == first_text_by_key[key], (
                f'Expected first occurrence {first_text_by_key[key]!r}, got {entry["keyword"]!r}'
            )
        empty_skips = _with_reason(skipped, promotion_handler.REASON_EMPTY)
        assert len(empty_skips) == expected_empty, (
            f'Expected {expected_empty} empty skips in {skipped}'
        )


class TestPartitionDuplicateProperty:
    """
    **Property 5: Duplicate classification is trim- and case-insensitive against
    existing keywords**

    A research keyword matching an existing one after trimming and case-folding
    is classified as a duplicate and never created.
    """

    @given(scenario=_partition_scenarios())
    @settings(max_examples=100)
    def test_matching_keywords_are_never_created_when_only_trim_and_case_differ(
        self, promotion_handler, scenario
    ):
        existing_texts, keywords = scenario
        existing_keys = _existing_keys(promotion_handler, existing_texts)
        matching = [
            _trimmed(rk)
            for rk in keywords
            if _trimmed(rk) and promotion_handler.normalize_keyword(_trimmed(rk)) in existing_keys
        ]

        to_create, skipped = promotion_handler.partition_keywords(keywords, existing_keys)

        assert matching, 'Scenario should always carry an existing-duplicate entry'
        for key in _created_keys(promotion_handler, to_create):
            assert key not in existing_keys, f'Pre-existing key {key!r} was created'
        created_texts = [entry['keyword'] for entry in to_create]
        for text in matching:
            assert text not in created_texts, f'Duplicate variant {text!r} was created'
        reported = [entry['keyword'] for entry in _with_reason(skipped, 'duplicate')]
        assert reported == matching, f'Expected duplicate skips {matching}, got {reported}'


class TestPartitionSkipReportingProperty:
    """
    **Property 7: Every skipped duplicate is reported with a duplicate indication**

    Each duplicate appears in `skipped` with its text and a duplicate reason,
    once per request entry; an intra-request collapsed extra is reported nowhere.
    """

    @given(scenario=_partition_scenarios())
    @settings(max_examples=100)
    def test_every_skip_carries_its_text_and_a_known_reason_when_request_mixes_cases(
        self, promotion_handler, scenario
    ):
        existing_texts, keywords = scenario
        existing_keys = _existing_keys(promotion_handler, existing_texts)
        expected_duplicates = [
            _trimmed(rk)
            for rk in keywords
            if _trimmed(rk) and promotion_handler.normalize_keyword(_trimmed(rk)) in existing_keys
        ]
        known_reasons = (promotion_handler.REASON_DUPLICATE, promotion_handler.REASON_EMPTY)

        to_create, skipped = promotion_handler.partition_keywords(keywords, existing_keys)

        reported = [
            entry['keyword']
            for entry in _with_reason(skipped, promotion_handler.REASON_DUPLICATE)
        ]
        assert reported == expected_duplicates, (
            f'Expected duplicate reports {expected_duplicates}, got {reported}'
        )
        for entry in skipped:
            assert set(entry) == {'keyword', 'reason'}, f'Unexpected skip shape {entry!r}'
            assert entry['reason'] in known_reasons, f'Unknown reason in {entry!r}'
        # Collapsed intra-request extras are reported nowhere, so the two output
        # lists can be shorter than the request (a documented consequence).
        assert len(to_create) + len(skipped) <= len(keywords), (
            f'Reported more outcomes than request entries: {to_create} / {skipped}'
        )


# --- Property tests: create_items -------------------------------------------


class TestCreateItemsKeywordTextProperty:
    """
    **Property 2: Stored keyword text is the trimmed research text**

    A created item's `keyword` is the research text trimmed with original casing
    preserved, never the lower-cased normalization key.
    """

    @given(to_create=_TO_CREATE, status=_SUPPLIED_VALUE, priority=_SUPPLIED_VALUE)
    @settings(max_examples=100)
    def test_stored_keyword_equals_the_trimmed_original_text_when_items_are_built(
        self, promotion_handler, to_create, status, priority
    ):
        resolved_status = _resolve_supplied(
            status, promotion_handler.ALLOWED_STATUSES, promotion_handler.DEFAULT_STATUS
        )
        resolved_priority = _resolve_supplied(
            priority, promotion_handler.ALLOWED_PRIORITIES, promotion_handler.DEFAULT_PRIORITY
        )

        items = promotion_handler.create_items(to_create, resolved_status, resolved_priority)

        assert len(items) == len(to_create), f'Expected {len(to_create)} items, got {len(items)}'
        for entry, item in zip(to_create, items, strict=True):
            expected_text = entry['keyword'].strip()
            assert item['keyword'] == expected_text, (
                f'Expected trimmed text {expected_text!r}, got {item["keyword"]!r}'
            )
            normalized = promotion_handler.normalize_keyword(expected_text)
            if expected_text != normalized:
                assert item['keyword'] != normalized, (
                    f'Stored the normalized key instead of {expected_text!r}'
                )


class TestCreateItemsIdentityProperty:
    """
    **Property 3: Created items get unique ids and equal UTC timestamps**

    Every created item has a distinct `id`, and each `created_at` equals its
    `updated_at` as a UTC ISO-8601 'Z' timestamp shared across one call.
    """

    @given(to_create=_TO_CREATE)
    @settings(max_examples=100)
    def test_ids_are_unique_and_timestamps_are_shared_utc_when_items_are_built(
        self, promotion_handler, to_create
    ):
        items = promotion_handler.create_items(
            to_create, promotion_handler.DEFAULT_STATUS, promotion_handler.DEFAULT_PRIORITY
        )

        ids = [item['id'] for item in items]
        assert len(set(ids)) == len(ids), f'Duplicate ids in {ids}'
        for item_id in ids:
            assert item_id, 'Created item carries an empty id'
        for item in items:
            assert item['created_at'] == item['updated_at'], (
                f'created_at {item["created_at"]!r} != updated_at {item["updated_at"]!r}'
            )
            _assert_utc_wire_timestamp(item['created_at'])
        timestamps = {item['created_at'] for item in items}
        assert len(timestamps) == 1, f'Expected one shared timestamp, got {timestamps}'


class TestCreateItemsStatusProperty:
    """
    **Property 8: Status resolution applies to every created item**

    Every created item carries the supplied status when valid, or `active` when
    the status is omitted or empty.
    """

    @given(to_create=_TO_CREATE, status=_SUPPLIED_VALUE)
    @settings(max_examples=100)
    def test_every_item_carries_the_resolved_status_when_status_is_supplied_or_omitted(
        self, promotion_handler, to_create, status
    ):
        resolved_status = _resolve_supplied(
            status, promotion_handler.ALLOWED_STATUSES, promotion_handler.DEFAULT_STATUS
        )

        items = promotion_handler.create_items(
            to_create, resolved_status, promotion_handler.DEFAULT_PRIORITY
        )

        for item in items:
            assert item['status'] == resolved_status, (
                f'Expected status {resolved_status!r}, got {item["status"]!r}'
            )


class TestCreateItemsPriorityProperty:
    """
    **Property 9: Priority resolution applies to every created item**

    Every created item carries the supplied priority when valid, or `normal`
    when the priority is omitted or empty.
    """

    @given(to_create=_TO_CREATE, priority=_SUPPLIED_VALUE)
    @settings(max_examples=100)
    def test_every_item_carries_the_resolved_priority_when_priority_is_supplied_or_omitted(
        self, promotion_handler, to_create, priority
    ):
        resolved_priority = _resolve_supplied(
            priority, promotion_handler.ALLOWED_PRIORITIES, promotion_handler.DEFAULT_PRIORITY
        )

        items = promotion_handler.create_items(
            to_create, promotion_handler.DEFAULT_STATUS, resolved_priority
        )

        for item in items:
            assert item['priority'] == resolved_priority, (
                f'Expected priority {resolved_priority!r}, got {item["priority"]!r}'
            )


# --- Property tests: validate_request ---------------------------------------


class TestValidateRequestProperty:
    """
    **Property 10: Invalid status or priority rejects the whole request**

    An out-of-set status or priority rejects the request with an error naming
    each invalid field and its value, resolving nothing. Values are matched
    exactly and case-sensitively; omitted/empty values are valid and default.
    """

    @given(keywords=_VALID_KEYWORDS, status_spec=_FIELD_SPEC, priority_spec=_FIELD_SPEC)
    @settings(max_examples=100)
    def test_request_is_rejected_or_resolved_per_field_when_status_and_priority_vary(
        self, promotion_handler, keywords, status_spec, priority_spec
    ):
        supplied_status, expected_status = _resolve_field_spec(
            status_spec, promotion_handler.ALLOWED_STATUSES, promotion_handler.DEFAULT_STATUS
        )
        supplied_priority, expected_priority = _resolve_field_spec(
            priority_spec, promotion_handler.ALLOWED_PRIORITIES, promotion_handler.DEFAULT_PRIORITY
        )
        invalid = [
            (field, value)
            for field, value, expected in (
                ('status', supplied_status, expected_status),
                ('priority', supplied_priority, expected_priority),
            )
            if expected is None
        ]

        error, status, priority = promotion_handler.validate_request(
            keywords, supplied_status, supplied_priority
        )

        if not invalid:
            assert error is None, f'Unexpected rejection: {error!r}'
            assert status == expected_status, f'Expected status {expected_status!r}, got {status!r}'
            assert priority == expected_priority, f'Expected priority {expected_priority!r}'
            return

        assert error is not None, 'Expected a rejection, got success'
        assert status is None, f'Rejected request resolved a status: {status!r}'
        assert priority is None, f'Rejected request resolved a priority: {priority!r}'
        for field, value in invalid:
            assert field in error['message'], f'Field {field!r} not named in {error["message"]!r}'
            assert value in error['message'], (
                f'Rejected value {value!r} not reported in {error["message"]!r}'
            )
        expected_field = ', '.join(field for field, _value in invalid)
        assert error['field'] == expected_field, (
            f'Expected offending field {expected_field!r}, got {error["field"]!r}'
        )


# --- Property tests: build_notes --------------------------------------------


class TestBuildNotesProperty:
    """
    **Property 11: Notes contain exactly the present research-context fields, labeled**

    `notes` holds a labeled entry for each present field of `intent`,
    `competition`, `source`, nothing for absent ones (missing, empty, or
    whitespace-only), in fixed `NOTES_FIELDS` order, and is '' when none present.
    """

    @given(field_specs=_NOTES_FIELD_SPECS)
    @settings(max_examples=100)
    def test_notes_hold_one_labeled_entry_per_present_field_in_source_order(
        self, promotion_handler, field_specs
    ):
        research_keyword = _research_keyword(field_specs)
        present = {
            field: raw_value
            for field, (is_present, raw_value) in field_specs.items()
            if is_present
        }
        absent = [field for field, (is_present, _raw) in field_specs.items() if not is_present]
        expected_order = [
            field for field in promotion_handler.NOTES_FIELDS if field_specs[field][0]
        ]

        notes = promotion_handler.build_notes(research_keyword)

        entries = _notes_entries(notes)
        assert len(entries) == len(present), f'Expected {len(present)} entries in {notes!r}'
        for field, raw_value in present.items():
            expected = f'{field}: {raw_value.strip()}'
            assert expected in entries, f'Missing labeled entry {expected!r} in {notes!r}'
        for field in absent:
            assert not any(entry.startswith(f'{field}: ') for entry in entries), (
                f'Absent field {field!r} was reported in {notes!r}'
            )
        labels = [entry.split(': ', 1)[0] for entry in entries]
        assert labels == expected_order, f'Expected field order {expected_order} in {notes!r}'
        if not present:
            assert notes == '', f'Expected empty notes, got {notes!r}'


# --- Example tests ----------------------------------------------------------


class TestPartitionKeywordsUnit:
    """Example coverage of the documented partition decisions."""

    def test_intra_request_duplicates_collapse_to_one_creation_without_a_skip_report(
        self, promotion_handler
    ):
        keywords = [
            {'keyword': 'Trail Running Shoes', 'intent': 'commercial'},
            {'keyword': '  trail running shoes  ', 'intent': 'informational'},
            {'keyword': 'TRAIL RUNNING SHOES'},
        ]

        to_create, skipped = promotion_handler.partition_keywords(keywords, set())

        assert to_create == [{'keyword': 'Trail Running Shoes', 'intent': 'commercial'}], (
            f'Expected a single first-occurrence creation, got {to_create}'
        )
        assert skipped == [], f'Collapsed extras should not be reported, got {skipped}'

    def test_research_context_is_carried_through_when_keyword_is_created(self, promotion_handler):
        keywords = [{
            'keyword': '  Best Running Shoes  ',
            'intent': 'commercial',
            'competition': 'high',
            'source': 'expansion',
        }]

        to_create, skipped = promotion_handler.partition_keywords(keywords, set())

        assert to_create == [{
            'keyword': 'Best Running Shoes',
            'intent': 'commercial',
            'competition': 'high',
            'source': 'expansion',
        }], f'Unexpected creation entry {to_create}'
        assert skipped == [], f'Unexpected skips {skipped}'

    def test_missing_keyword_field_is_reported_as_empty(self, promotion_handler):
        keywords = [{'intent': 'commercial'}, {'keyword': None}, {'keyword': '   '}]

        to_create, skipped = promotion_handler.partition_keywords(keywords, set())

        assert to_create == [], f'Expected no creation, got {to_create}'
        assert skipped == [{'keyword': '', 'reason': 'empty'}] * 3, (
            f'Expected three empty skips, got {skipped}'
        )


class TestCreateItemsUnit:
    """Example coverage of the documented Active_Keyword item shape."""

    def test_item_matches_the_create_keyword_field_set_when_context_is_present(
        self, promotion_handler
    ):
        to_create = [{
            'keyword': 'Best Running Shoes',
            'intent': 'commercial',
            'competition': 'high',
            'source': 'expansion',
        }]

        items = promotion_handler.create_items(to_create, 'paused', 'high')

        item = items[0]
        assert set(item) == {
            'id', 'keyword', 'status', 'created_at', 'updated_at',
            'region', 'language', 'category', 'priority', 'notes',
        }, f'Unexpected item fields {sorted(item)}'
        assert item['status'] == 'paused', f'Unexpected status {item["status"]!r}'
        assert item['priority'] == 'high', f'Unexpected priority {item["priority"]!r}'
        assert item['region'] == promotion_handler.DEFAULT_REGION, 'Unexpected region default'
        assert item['language'] == promotion_handler.DEFAULT_LANGUAGE, 'Unexpected language default'
        assert item['category'] == promotion_handler.DEFAULT_CATEGORY, 'Unexpected category default'
        assert item['notes'] == 'intent: commercial; competition: high; source: expansion', (
            f'Unexpected notes {item["notes"]!r}'
        )

    def test_no_items_are_built_when_nothing_was_accepted(self, promotion_handler):
        items = promotion_handler.create_items(
            [], promotion_handler.DEFAULT_STATUS, promotion_handler.DEFAULT_PRIORITY
        )

        assert items == [], f'Expected no items, got {items}'
