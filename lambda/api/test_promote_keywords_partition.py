"""
Property tests for the keyword partitioning step in the promotion handler.

Covers:
- Property 1: Created set equals distinct, non-empty, non-duplicate keywords
  (**Validates: Requirements 1.1, 2.3, 7.2**)
- Property 5: Duplicate classification is trim- and case-insensitive against
  existing keywords (**Validates: Requirements 1.5, 2.1, 2.2**)
- Property 7: Every skipped duplicate is reported with a duplicate indication
  (**Validates: Requirements 2.4**)

Context:
    `partition_keywords(keywords, existing_keys)` in `promote-keywords.py` runs
    after the request has been validated and after the existing keyword keys
    have been read. It returns `(to_create, skipped)` and every decision it
    makes is a PER-ITEM skip, never a request-level rejection.

    `existing_keys` holds ALREADY-NORMALIZED keys (what
    `load_existing_keyword_keys` returns), so the tests normalize their
    generated existing keywords with `normalize_keyword` from the module under
    test rather than lower-casing by hand.

    Two documented behaviors shape the assertions below:
    - the FIRST occurrence of a normalized key wins, so its original trimmed
      text is what reaches `to_create`;
    - intra-request collapsed extras are NOT reported in `skipped`, because a
      Duplicate_Keyword is defined against the EXISTING active keywords. Only
      existing-duplicates and individually-empty entries are reported, once per
      request entry.

    The handler file is hyphenated, so it cannot be imported normally: it is
    loaded through `importlib.util.spec_from_file_location` under a unique module
    name (the `_load_router` pattern in `lambda/api/test_routers_404.py`). The
    module resolves its DynamoDB table and builds a `boto3` resource at import
    time, so the table env vars are set and `boto3.resource` is patched before
    the load happens.

Test outcomes:
    - the created set equals exactly the distinct, non-empty, non-existing
      normalized keys of the request
    - no pre-existing key is ever created
    - equal normalized texts within one request collapse to a single creation,
      keeping the first occurrence's original text and casing
    - keywords matching an existing keyword after trimming and case-folding are
      classified as duplicates regardless of the whitespace/case variant used
    - every duplicate entry is reported in `skipped` with its text and
      `reason: 'duplicate'`
    - empty-after-trim entries are reported with `reason: 'empty'` and never
      created
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
# Distinct from the names used by the other promote-keywords test modules so the
# modules cannot evict each other's copy in the same pytest session.
_MODULE_NAME = 'promote_keywords_partition_under_test'

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

# A small base vocabulary so generated requests collide often: duplicates,
# case variants, and existing-key overlaps all stay likely at these sizes.
_BASE_TEXTS = st.sampled_from([
    'best running shoes',
    'trail running shoes',
    'marathon training plan',
    'lightweight racing flats',
    'running shoe reviews',
])

# Surrounding whitespace only: normalization trims, so these must not change
# the comparison key.
_PADDING = st.sampled_from(['', ' ', '  ', '\t', '\n', ' \t '])

# Case transforms that must not change the comparison key either.
_CASE_TRANSFORMS = st.sampled_from(['lower', 'upper', 'title', 'capitalize', 'swapcase'])

# Texts that are empty once trimmed (Req 7.2).
_EMPTY_TEXTS = st.sampled_from(['', ' ', '   ', '\t', '\n', ' \t\n '])


def _variant(text, case_transform, leading, trailing):
    """Build a whitespace/case variant of a text with the same normalized key."""
    return f'{leading}{getattr(text, case_transform)()}{trailing}'


_KEYWORD_TEXTS = st.builds(_variant, _BASE_TEXTS, _CASE_TRANSFORMS, _PADDING, _PADDING)

# Research keywords: mostly non-empty variants, with empty entries mixed in so
# the empty-skip path is exercised alongside the duplicate paths.
_RESEARCH_KEYWORDS = st.lists(
    st.one_of(
        _KEYWORD_TEXTS.map(lambda text: {'keyword': text}),
        _KEYWORD_TEXTS.map(lambda text: {'keyword': text, 'intent': 'commercial'}),
        _EMPTY_TEXTS.map(lambda text: {'keyword': text}),
    ),
    min_size=1,
    max_size=12,
)

# Existing keywords are generated as RAW texts (with padding/case variants) and
# normalized inside each test with `normalize_keyword`, mirroring what
# `load_existing_keyword_keys` produces from the table.
_EXISTING_TEXTS = st.lists(_KEYWORD_TEXTS, min_size=0, max_size=5)


def _existing_keys(module, texts):
    """Normalize generated existing keyword texts the way the reader does."""
    return {module.normalize_keyword(text) for text in texts}


def _expected_created_keys(module, keywords, existing_keys):
    """Expected created keys: distinct, non-empty, and not already existing."""
    expected = []
    for rk in keywords:
        key = module.normalize_keyword(rk['keyword'])
        if not key or key in existing_keys or key in expected:
            continue
        expected.append(key)
    return expected


def _created_keys(module, to_create):
    """Normalized keys of the created entries, in creation order."""
    return [module.normalize_keyword(entry['keyword']) for entry in to_create]


def _reasons(skipped, reason):
    """Skipped entries carrying a given reason."""
    return [entry for entry in skipped if entry['reason'] == reason]


# --- Property tests ---------------------------------------------------------


class TestPartitionKeywordsCreatedSetProperty:
    """
    **Property 1: Created set equals distinct, non-empty, non-duplicate keywords**

    For any promotion request list of research keywords and any set of existing
    active keyword keys, the set of created keywords is exactly the set of
    normalized (trimmed, lower-cased) keyword texts that are non-empty, do not
    already exist, and -- where several request entries share a normalized
    value -- collapse to a single creation. The first occurrence supplies the
    created entry, and empty-after-trim entries are reported with
    `reason: 'empty'` instead of being created.

    **Validates: Requirements 1.1, 2.3, 7.2**
    """

    @given(keywords=_RESEARCH_KEYWORDS, existing_texts=_EXISTING_TEXTS)
    @settings(max_examples=100)
    def test_created_keys_are_distinct_non_empty_and_new_when_request_mixes_variants(
        self, _promote_keywords, keywords, existing_texts
    ):
        existing_keys = _existing_keys(_promote_keywords, existing_texts)
        expected = _expected_created_keys(_promote_keywords, keywords, existing_keys)

        to_create, _skipped = _promote_keywords.partition_keywords(keywords, existing_keys)

        created = _created_keys(_promote_keywords, to_create)
        assert created == expected, f'Expected created keys {expected}, got {created}'

    @given(keywords=_RESEARCH_KEYWORDS, existing_texts=_EXISTING_TEXTS)
    @settings(max_examples=100)
    def test_created_keys_are_unique_when_request_repeats_normalized_values(
        self, _promote_keywords, keywords, existing_texts
    ):
        existing_keys = _existing_keys(_promote_keywords, existing_texts)

        to_create, _skipped = _promote_keywords.partition_keywords(keywords, existing_keys)

        created = _created_keys(_promote_keywords, to_create)
        assert len(created) == len(set(created)), f'Duplicate creations in {created}'

    @given(keywords=_RESEARCH_KEYWORDS, existing_texts=_EXISTING_TEXTS)
    @settings(max_examples=100)
    def test_first_occurrence_supplies_the_created_text_when_variants_collide(
        self, _promote_keywords, keywords, existing_texts
    ):
        existing_keys = _existing_keys(_promote_keywords, existing_texts)
        first_text_by_key = {}
        for rk in keywords:
            key = _promote_keywords.normalize_keyword(rk['keyword'])
            if key and key not in first_text_by_key:
                first_text_by_key[key] = rk['keyword'].strip()

        to_create, _skipped = _promote_keywords.partition_keywords(keywords, existing_keys)

        for entry in to_create:
            key = _promote_keywords.normalize_keyword(entry['keyword'])
            assert entry['keyword'] == first_text_by_key[key], (
                f'Expected first occurrence {first_text_by_key[key]!r}, got {entry["keyword"]!r}'
            )

    @given(keywords=_RESEARCH_KEYWORDS, existing_texts=_EXISTING_TEXTS)
    @settings(max_examples=100)
    def test_empty_keywords_are_reported_and_never_created_when_request_has_blanks(
        self, _promote_keywords, keywords, existing_texts
    ):
        existing_keys = _existing_keys(_promote_keywords, existing_texts)
        expected_empty_count = sum(1 for rk in keywords if not rk['keyword'].strip())

        to_create, skipped = _promote_keywords.partition_keywords(keywords, existing_keys)

        assert len(_reasons(skipped, 'empty')) == expected_empty_count, (
            f'Expected {expected_empty_count} empty skips in {skipped}'
        )
        for entry in to_create:
            assert entry['keyword'].strip() != '', f'Empty keyword created: {entry!r}'


class TestPartitionKeywordsDuplicateProperty:
    """
    **Property 5: Duplicate classification is trim- and case-insensitive against
    existing keywords**

    For any existing active keyword and any research keyword whose text matches
    it after trimming and case-folding, that research keyword is classified as a
    duplicate and is not created. `partition_keywords` only ever adds to
    `to_create` / `skipped`, so no existing record can be modified as a result.

    **Validates: Requirements 1.5, 2.1, 2.2**
    """

    @given(keywords=_RESEARCH_KEYWORDS, existing_texts=_EXISTING_TEXTS)
    @settings(max_examples=100)
    def test_no_existing_key_is_created_when_request_uses_whitespace_or_case_variants(
        self, _promote_keywords, keywords, existing_texts
    ):
        existing_keys = _existing_keys(_promote_keywords, existing_texts)

        to_create, _skipped = _promote_keywords.partition_keywords(keywords, existing_keys)

        for key in _created_keys(_promote_keywords, to_create):
            assert key not in existing_keys, f'Pre-existing key {key!r} was created'

    @given(
        base_text=_BASE_TEXTS,
        existing_transform=_CASE_TRANSFORMS,
        existing_leading=_PADDING,
        existing_trailing=_PADDING,
        request_transform=_CASE_TRANSFORMS,
        request_leading=_PADDING,
        request_trailing=_PADDING,
    )
    @settings(max_examples=100)
    def test_matching_keyword_is_skipped_when_only_trim_and_case_differ(
        self,
        _promote_keywords,
        base_text,
        existing_transform,
        existing_leading,
        existing_trailing,
        request_transform,
        request_leading,
        request_trailing,
    ):
        existing_text = _variant(base_text, existing_transform, existing_leading, existing_trailing)
        request_text = _variant(base_text, request_transform, request_leading, request_trailing)
        existing_keys = _existing_keys(_promote_keywords, [existing_text])

        to_create, skipped = _promote_keywords.partition_keywords(
            [{'keyword': request_text}], existing_keys
        )

        assert to_create == [], f'Duplicate variant {request_text!r} was created'
        assert skipped == [{'keyword': request_text.strip(), 'reason': 'duplicate'}], (
            f'Unexpected skip report {skipped}'
        )


class TestPartitionKeywordsSkipReportingProperty:
    """
    **Property 7: Every skipped duplicate is reported with a duplicate indication**

    For any promotion request, each research keyword classified as a duplicate
    appears in the skipped list with its keyword text and a duplicate reason
    indicator. Duplicates are reported once per request entry, so a request
    carrying several existing-duplicate variants reports each of them.

    **Validates: Requirements 2.4**
    """

    @given(keywords=_RESEARCH_KEYWORDS, existing_texts=_EXISTING_TEXTS)
    @settings(max_examples=100)
    def test_every_duplicate_entry_is_reported_with_a_duplicate_reason(
        self, _promote_keywords, keywords, existing_texts
    ):
        existing_keys = _existing_keys(_promote_keywords, existing_texts)
        expected_duplicates = [
            rk['keyword'].strip()
            for rk in keywords
            if rk['keyword'].strip()
            and _promote_keywords.normalize_keyword(rk['keyword']) in existing_keys
        ]

        _to_create, skipped = _promote_keywords.partition_keywords(keywords, existing_keys)

        reported = [entry['keyword'] for entry in _reasons(skipped, 'duplicate')]
        assert reported == expected_duplicates, (
            f'Expected duplicate reports {expected_duplicates}, got {reported}'
        )

    @given(keywords=_RESEARCH_KEYWORDS, existing_texts=_EXISTING_TEXTS)
    @settings(max_examples=100)
    def test_every_skip_carries_a_known_reason_and_a_keyword_text(
        self, _promote_keywords, keywords, existing_texts
    ):
        existing_keys = _existing_keys(_promote_keywords, existing_texts)

        _to_create, skipped = _promote_keywords.partition_keywords(keywords, existing_keys)

        for entry in skipped:
            assert set(entry) == {'keyword', 'reason'}, f'Unexpected skip shape {entry!r}'
            assert entry['reason'] in ('duplicate', 'empty'), f'Unknown reason in {entry!r}'


# --- Example tests ----------------------------------------------------------


class TestPartitionKeywordsUnit:
    """Example-based coverage of the documented partition decisions."""

    def test_intra_request_duplicates_collapse_to_one_creation_without_a_skip_report(
        self, _promote_keywords
    ):
        keywords = [
            {'keyword': 'Trail Running Shoes', 'intent': 'commercial'},
            {'keyword': '  trail running shoes  ', 'intent': 'informational'},
            {'keyword': 'TRAIL RUNNING SHOES'},
        ]

        to_create, skipped = _promote_keywords.partition_keywords(keywords, set())

        assert len(to_create) == 1, f'Expected a single creation, got {to_create}'
        assert to_create[0]['keyword'] == 'Trail Running Shoes', (
            f'Expected the first occurrence text, got {to_create[0]["keyword"]!r}'
        )
        assert to_create[0]['intent'] == 'commercial', 'Expected the first occurrence context'
        assert skipped == [], f'Collapsed extras should not be reported, got {skipped}'

    def test_research_context_is_carried_through_when_keyword_is_created(self, _promote_keywords):
        keywords = [{
            'keyword': '  Best Running Shoes  ',
            'intent': 'commercial',
            'competition': 'high',
            'source': 'expansion',
        }]

        to_create, skipped = _promote_keywords.partition_keywords(keywords, set())

        assert to_create == [{
            'keyword': 'Best Running Shoes',
            'intent': 'commercial',
            'competition': 'high',
            'source': 'expansion',
        }], f'Unexpected creation entry {to_create}'
        assert skipped == [], f'Unexpected skips {skipped}'

    @pytest.mark.parametrize(
        ('existing_text', 'request_text'),
        [
            ('best running shoes', 'Best Running Shoes'),
            ('best running shoes', '  best running shoes  '),
            ('Best Running Shoes', 'BEST RUNNING SHOES'),
            ('  best running shoes  ', '\tbest running shoes\n'),
        ],
    )
    def test_keyword_is_skipped_when_it_matches_an_existing_keyword(
        self, _promote_keywords, existing_text, request_text
    ):
        existing_keys = {_promote_keywords.normalize_keyword(existing_text)}

        to_create, skipped = _promote_keywords.partition_keywords(
            [{'keyword': request_text}], existing_keys
        )

        assert to_create == [], f'Expected no creation, got {to_create}'
        assert skipped == [{'keyword': request_text.strip(), 'reason': 'duplicate'}], (
            f'Unexpected skip report {skipped}'
        )

    def test_missing_keyword_field_is_reported_as_empty(self, _promote_keywords):
        keywords = [{'intent': 'commercial'}, {'keyword': None}, {'keyword': '   '}]

        to_create, skipped = _promote_keywords.partition_keywords(keywords, set())

        assert to_create == [], f'Expected no creation, got {to_create}'
        assert skipped == [{'keyword': '', 'reason': 'empty'}] * 3, (
            f'Expected three empty skips, got {skipped}'
        )
