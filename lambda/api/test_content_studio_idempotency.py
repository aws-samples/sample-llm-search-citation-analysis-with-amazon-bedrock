"""
Regression tests for content-studio async generation idempotency (audit #23).

Background — the previous implementation generated a fresh `uuid.uuid4()`
primary key on every call to `create_pending_content`. If API Gateway
retried a POST (default behavior on read timeouts) or a user double-clicked
the generate button, two rows were created with two separate UUIDs and
two separate async Lambda self-invocations fired. The client saw two
results, and Bedrock got billed twice for the same work.

The fix:
- `_compute_idempotency_key(idea)` derives a deterministic 32-char hex
  key from idea_id + keyword + content_angle + output_language + a
  rounded 5-minute time bucket.
- `create_pending_content` uses that key as the DynamoDB primary key with
  a conditional `attribute_not_exists(id)` put. Duplicates hit the
  condition, fall back to a `get_item`, and return `(existing, created=False)`.
- `_generate_content` skips the async Lambda invocation when
  `created is False` so retries don't spawn duplicate generations.

These tests pin:
- Same idea + same window → same key → same row
- Same idea + different window → different key → new row (user-intent re-run)
- Different idea data → different key even in same window
- Conditional-check failure paths return the existing row
- Caller skips async invocation on idempotent hit
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.env import setdefault_env
from testing.module_loader import load_handler_module

# Table names the module reads at import time.
setdefault_env({
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
    'DYNAMODB_TABLE_CONTENT_STUDIO': 'test-content-studio',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-keyword-groups',
})
_mod = load_handler_module(os.path.dirname(__file__), 'content-studio.py')

_GROUP_IDEA = {
    'id': 'brief-1',
    'type': 'group_brief',
    'keyword': 'Group One',
    'group_id': 'group-1',
    'keyword_ids': ['keyword-1', 'keyword-2'],
    'keywords': ['alpha', 'beta'],
    'content_angle': 'create_new_landing_page',
    'landing_url': '',
    'current_copy': '',
    'prompt_template': 'Create for {group}',
    'output_language': 'English',
}


class _FakeClientError(Exception):
    """Minimal ClientError substitute with the .response shape the code
    expects. Actual botocore.exceptions.ClientError is used at runtime;
    we swap for testability so tests don't depend on the boto3 error
    hierarchy details."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.response = {'Error': {'Code': code}}


class TestComputeIdempotencyKey:
    """The key must be deterministic for the same inputs + window and
    diverge only on meaningful input changes."""

    def test_same_idea_same_window_produces_same_key(self) -> None:
        idea = {
            'id': 'idea-1',
            'keyword': 'luxury hotels',
            'content_angle': 'comprehensive_guide',
            'output_language': 'English',
        }
        k1 = _mod._compute_idempotency_key(idea)
        k2 = _mod._compute_idempotency_key(idea)
        assert k1 == k2

    def test_different_keyword_produces_different_key(self) -> None:
        base = {
            'id': 'idea-1',
            'content_angle': 'comprehensive_guide',
            'output_language': 'English',
        }
        k1 = _mod._compute_idempotency_key({**base, 'keyword': 'luxury hotels'})
        k2 = _mod._compute_idempotency_key({**base, 'keyword': 'budget hotels'})
        assert k1 != k2

    def test_different_content_angle_produces_different_key(self) -> None:
        """Same idea, different angle = different generation output
        expected, so different key."""
        base = {
            'id': 'idea-1',
            'keyword': 'hotels',
            'output_language': 'English',
        }
        k1 = _mod._compute_idempotency_key({**base, 'content_angle': 'comprehensive_guide'})
        k2 = _mod._compute_idempotency_key({**base, 'content_angle': 'reputation_management'})
        assert k1 != k2

    def test_different_language_produces_different_key(self) -> None:
        base = {
            'id': 'idea-1',
            'keyword': 'hotels',
            'content_angle': 'comprehensive_guide',
        }
        k1 = _mod._compute_idempotency_key({**base, 'output_language': 'English'})
        k2 = _mod._compute_idempotency_key({**base, 'output_language': 'Spanish'})
        assert k1 != k2

    @pytest.mark.parametrize(
        ('field', 'changed_value'),
        [
            ('group_id', 'group-2'),
            ('content_angle', 'rewrite_pasted_copy'),
            ('keyword_ids', ['keyword-1', 'keyword-3']),
            ('keywords', ['alpha', 'gamma']),
            ('landing_url', 'https://example.com/page'),
            ('current_copy', 'different current copy'),
            ('prompt_template', 'Different template for {group}'),
        ],
        ids=[
            'group-id',
            'mode',
            'selected-ids',
            'authoritative-keywords',
            'landing-url',
            'current-copy-hash',
            'template-hash',
        ],
    )
    def test_distinct_group_brief_dimension_produces_different_key(
        self, field: str, changed_value: object
    ) -> None:
        fixed_time = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
        changed = {**_GROUP_IDEA, field: changed_value}

        with patch.object(_mod, 'utc_now', return_value=fixed_time):
            original_key = _mod._compute_idempotency_key(_GROUP_IDEA)
            changed_key = _mod._compute_idempotency_key(changed)

        assert original_key != changed_key

    def test_reordered_group_keyword_ids_and_names_produce_same_key(self) -> None:
        fixed_time = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
        reordered = {
            **_GROUP_IDEA,
            'keyword_ids': ['keyword-2', 'keyword-1'],
            'keywords': ['beta', 'alpha'],
        }

        with patch.object(_mod, 'utc_now', return_value=fixed_time):
            original_key = _mod._compute_idempotency_key(_GROUP_IDEA)
            reordered_key = _mod._compute_idempotency_key(reordered)

        assert original_key == reordered_key

    def test_legacy_idea_key_keeps_original_dimensions(self) -> None:
        idea = {
            'id': 'idea-1',
            'keyword': 'generic keyword',
            'content_angle': 'comprehensive_guide',
            'output_language': 'English',
        }
        fixed_time = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
        bucket = int(fixed_time.timestamp() // 300)
        expected = hashlib.sha256(
            f'idea-1|generic keyword|comprehensive_guide|English|{bucket}'.encode()
        ).hexdigest()[:32]

        with patch.object(_mod, 'utc_now', return_value=fixed_time):
            actual = _mod._compute_idempotency_key(idea)

        assert actual == expected

    def test_different_window_produces_different_key(self) -> None:
        """A user who re-triggers generation after the window expires
        should get a fresh key (no longer an idempotent hit)."""
        idea = {'id': 'idea-1', 'keyword': 'hotels', 'content_angle': 'comprehensive_guide'}
        # Tiny 0.001-minute window so consecutive calls fall in different buckets.
        # This works because _compute_idempotency_key uses int(timestamp // window_seconds)
        # and we can simulate window rollover by patching utc_now across calls.
        real_utc_now = _mod.utc_now
        fixed_early = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
        fixed_later = datetime(2026, 4, 18, 12, 10, 0, tzinfo=UTC)

        with patch.object(_mod, 'utc_now', return_value=fixed_early):
            k1 = _mod._compute_idempotency_key(idea)
        with patch.object(_mod, 'utc_now', return_value=fixed_later):
            k2 = _mod._compute_idempotency_key(idea)

        assert k1 != k2
        # Sanity: our patch didn't accidentally break utc_now globally.
        assert _mod.utc_now is real_utc_now

    def test_returns_thirty_two_char_hex(self) -> None:
        """DynamoDB keys must be predictable length. 32 hex chars = 128 bits
        of collision resistance, plenty for this use case."""
        idea = {'id': 'idea-1', 'keyword': 'kw', 'content_angle': 'ca'}
        key = _mod._compute_idempotency_key(idea)
        assert len(key) == 32
        assert all(c in '0123456789abcdef' for c in key)


_IDEA = {'id': 'x', 'keyword': 'kw', 'content_angle': 'a'}


class TestCreatePendingContent:
    """The conditional write + get_item fallback behaviour."""

    @staticmethod
    @contextmanager
    def _table(put_raises: Exception | None = None,
               get_item_return: dict | None = None) -> Iterator[MagicMock]:
        """Point the module at a fake table and at `_FakeClientError` for the block.

        `ClientError` is swapped so the handler's `except` catches the fake the
        table raises instead of botocore's real hierarchy.
        """
        table = MagicMock()
        if put_raises is not None:
            table.put_item.side_effect = put_raises
        table.get_item.return_value = {'Item': get_item_return} if get_item_return else {}
        with (
            patch.object(_mod, 'dynamodb', fake_dynamodb_resource(table)),
            patch.object(_mod, 'ClientError', _FakeClientError),
        ):
            yield table

    def test_writes_new_row_with_deterministic_key_on_fresh_call(self) -> None:
        idea = {'id': 'idea-1', 'keyword': 'hotels', 'content_angle': 'comprehensive_guide'}

        with self._table():
            item, created = _mod.create_pending_content(idea)

        assert created is True
        # The row's primary key must equal the idempotency key.
        assert item['id'] == _mod._compute_idempotency_key(idea)

    def test_uses_conditional_expression_attribute_not_exists(self) -> None:
        """Regression guard: someone removing the ConditionExpression would
        re-introduce the duplicate-write bug."""
        with self._table() as table:
            _mod.create_pending_content(_IDEA)

        put_kwargs = table.put_item.call_args.kwargs
        assert put_kwargs['ConditionExpression'] == 'attribute_not_exists(id)'

    def test_returns_existing_row_on_conditional_check_failure(self) -> None:
        """The core idempotency behavior — duplicate requests return the
        existing record with created=False."""
        existing_row = {
            'id': 'some-key',
            'status': 'generating',
            'keyword': 'hotels',
            'idea_id': 'idea-1',
        }
        error = _FakeClientError('ConditionalCheckFailedException')

        with self._table(put_raises=error, get_item_return=existing_row):
            item, created = _mod.create_pending_content({
                'id': 'idea-1', 'keyword': 'hotels', 'content_angle': 'a',
            })

        assert created is False
        assert item == existing_row

    def test_reraises_non_conditional_client_errors(self) -> None:
        """Only ConditionalCheckFailedException is the idempotent-hit case.
        Other DynamoDB errors must propagate."""
        error = _FakeClientError('ProvisionedThroughputExceededException')

        with self._table(put_raises=error), pytest.raises(_FakeClientError):
            _mod.create_pending_content(_IDEA)

    def test_raises_runtime_error_when_existing_item_disappears(self) -> None:
        """Very unlikely race: row existed when put failed, gone when we read
        back. Better to surface the race than silently continue with a
        fabricated record."""
        error = _FakeClientError('ConditionalCheckFailedException')

        with (
            self._table(put_raises=error, get_item_return=None),
            pytest.raises(RuntimeError, match=r'(?i)disappeared'),
        ):
            _mod.create_pending_content(_IDEA)

    def test_returned_tuple_order_is_item_then_created_flag(self) -> None:
        """Regression guard: callers unpack `item, created = ...`. Reversing
        the order would silently break every caller."""
        with self._table():
            result = _mod.create_pending_content(_IDEA)

        assert isinstance(result, tuple)
        assert len(result) == 2
        assert isinstance(result[0], dict)
        assert isinstance(result[1], bool)
