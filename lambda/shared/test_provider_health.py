"""
Tests for shared.provider_health.

THE INCIDENT THIS MODULE EXISTS FOR. On 2026-08-14 a production run reported
`success_rate: 100.0` while Claude answered every query with
`400 "Your credit balance is too low to access the Anthropic API."`. The
condition was still live on 2026-08-19, so five days of brand-visibility
measurements were taken with one configured provider contributing nothing, and
nothing in the summary moved.

Two behaviours carry the whole fix, and both are pinned here:

1. Classification order. Anthropic reports credit exhaustion with HTTP **400**,
   not 402, so a status-code-first rule reads the outage as a generic bad
   request. Message text must win over status. Every "message beats status"
   test below is guarding a real provider response, not a hypothetical.

2. `UNKNOWN` is not terminal. Auto-disable is a destructive action — it stops a
   provider being queried until a human intervenes. A message this module has
   not seen before must never trigger it, or one unrecognised blip silently
   removes a working provider from the panel and reintroduces the same
   under-measurement the incident was about.
"""

from __future__ import annotations

import os
import sys
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock

from botocore.exceptions import ClientError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared.provider_health import (
    AUTO_DISABLE_THRESHOLD,
    INSUFFICIENT_CREDIT,
    INVALID_KEY,
    RATE_LIMITED,
    TERMINAL_CATEGORIES,
    TIMEOUT,
    UNKNOWN,
    classify_provider_error,
    describe_category,
    record_provider_failure,
    record_provider_success,
)

#: The exact string Anthropic returned throughout the 2026-08-14 outage.
ANTHROPIC_CREDIT_MESSAGE = 'Your credit balance is too low to access the Anthropic API.'

#: What OpenAI actually sends for a spent account — note the 429 status.
OPENAI_QUOTA_MESSAGE = (
    'You exceeded your current quota, please check your plan and billing details.'
)

NOW = '2026-08-19T12:00:00Z'


class ProviderTestError(Exception):
    """Stands in for a provider SDK exception, to prove non-string input works."""


def _table(consecutive_failures: int = 1) -> MagicMock:
    """A ProviderConfig table whose ADD echoes `consecutive_failures`.

    DynamoDB returns numbers as `Decimal` through the boto3 resource layer, so
    the fixture does too — the production code has to cope with that type, not
    with a convenient int.
    """
    table = MagicMock()
    table.update_item.return_value = {
        'Attributes': {'consecutive_failures': Decimal(consecutive_failures)}
    }
    return table


def _write(table: MagicMock, call_index: int = 0) -> dict[str, Any]:
    """The kwargs of one `update_item` call, for asserting on what was written."""
    return table.update_item.call_args_list[call_index].kwargs


class TestTheAnthropicCreditIncident:
    """
    The 2026-08-14 regression, asserted against the verbatim provider message.

    If any test in this class goes red, the system has lost the ability to
    recognise the outage it was built to catch.
    """

    def test_classifies_the_verbatim_anthropic_credit_message_as_insufficient_credit(self):
        """The exact string, with the exact status, that ran undetected for five days."""
        assert classify_provider_error(ANTHROPIC_CREDIT_MESSAGE, 400) == INSUFFICIENT_CREDIT

    def test_classifies_the_anthropic_credit_message_when_no_status_code_is_known(self):
        """
        The search Lambda's `_record_provider_outcome` passes only
        `result['error']` — no status code survives `provider_error_result`. So
        message-only classification is the production path, not a fallback.
        """
        assert classify_provider_error(ANTHROPIC_CREDIT_MESSAGE) == INSUFFICIENT_CREDIT

    def test_does_not_classify_the_anthropic_credit_message_as_unknown(self):
        """
        Message text must beat the status code. Anthropic returns 400 for credit
        exhaustion, so a status-first rule would fall through every marker list
        and land on UNKNOWN — non-terminal, unactionable, and indistinguishable
        from noise. Stated as its own test because this inversion is the single
        most likely way to silently reintroduce the incident.
        """
        assert classify_provider_error(ANTHROPIC_CREDIT_MESSAGE, 400) != UNKNOWN

    def test_classifies_a_bare_400_with_no_recognisable_text_as_unknown(self):
        """
        The other half of the previous test: 400 on its own carries no billing
        meaning, which is exactly why the status code cannot be the primary
        signal. Without this case the ordering rule looks arbitrary.
        """
        assert classify_provider_error('Bad Request', 400) == UNKNOWN

    def test_classifies_the_anthropic_message_inside_a_full_json_error_body(self):
        """Providers send the message wrapped in an envelope; substring matching must still hit."""
        body = (
            '{"type":"error","error":{"type":"invalid_request_error",'
            f'"message":"{ANTHROPIC_CREDIT_MESSAGE}"}}}}'
        )

        assert classify_provider_error(body, 400) == INSUFFICIENT_CREDIT


class TestCreditExhaustionAcrossProviders:
    """Each provider phrases a spent account differently; all must reach one category."""

    def test_classifies_openais_insufficient_quota_code_as_insufficient_credit(self):
        assert classify_provider_error('insufficient_quota') == INSUFFICIENT_CREDIT

    def test_classifies_openais_quota_message_as_insufficient_credit_despite_a_429(self):
        """
        OpenAI returns **429** for a spent account, the same status it uses for
        throttling. Reading the status alone would call this `rate_limited` and
        retry forever against an account that cannot pay. Second real provider
        where message must beat status, so the rule is not Anthropic-specific.
        """
        assert classify_provider_error(OPENAI_QUOTA_MESSAGE, 429) == INSUFFICIENT_CREDIT

    def test_classifies_a_402_with_no_recognisable_text_as_insufficient_credit(self):
        """Payment Required is unambiguous, so the status fallback can be trusted here."""
        assert classify_provider_error('', 402) == INSUFFICIENT_CREDIT


class TestTransientFailuresAreNotTerminal:
    """Throttling and timeouts resolve themselves; misreading them disables healthy providers."""

    def test_classifies_a_rate_limit_message_as_rate_limited(self):
        assert classify_provider_error('Rate limit reached for gpt-5-mini') == RATE_LIMITED

    def test_classifies_a_429_with_no_recognisable_text_as_rate_limited(self):
        assert classify_provider_error('Too Many Requests', 429) == RATE_LIMITED

    def test_classifies_anthropics_overloaded_error_as_rate_limited(self):
        """Anthropic's 529 `overloaded_error` is capacity, not a broken account."""
        assert classify_provider_error('{"type":"overloaded_error"}', 529) == RATE_LIMITED

    def test_classifies_a_read_timeout_message_as_timeout(self):
        assert classify_provider_error('HTTPSConnectionPool: Read timed out. (read timeout=60)') == TIMEOUT

    def test_classifies_a_504_as_timeout(self):
        assert classify_provider_error('Gateway Timeout', 504) == TIMEOUT

    def test_classifies_a_408_as_timeout(self):
        assert classify_provider_error('', 408) == TIMEOUT


class TestRejectedKeys:
    """A rejected key is terminal: retrying cannot fix it, only a human can."""

    def test_classifies_anthropics_authentication_error_as_invalid_key(self):
        body = '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'

        assert classify_provider_error(body, 401) == INVALID_KEY

    def test_classifies_openais_incorrect_api_key_message_as_invalid_key(self):
        assert classify_provider_error('Incorrect API key provided: sk-***') == INVALID_KEY

    def test_classifies_a_401_with_no_recognisable_text_as_invalid_key(self):
        assert classify_provider_error('Unauthorized', 401) == INVALID_KEY

    def test_classifies_a_403_with_no_recognisable_text_as_invalid_key(self):
        assert classify_provider_error('', 403) == INVALID_KEY


class TestUnrecognisedErrorsCanNeverDisableAProvider:
    """
    The safety property of the whole module.

    Auto-disable stops a provider being queried until someone notices and
    re-enables it by hand. A message this module has never seen must therefore
    be inert: reported, but never acted on destructively.
    """

    def test_classifies_an_unrecognised_message_as_unknown(self):
        assert classify_provider_error('Something nobody has seen before') == UNKNOWN

    def test_classifies_an_unrecognised_exception_object_as_unknown(self):
        """Callers pass exceptions, not just strings; stringification must not raise."""
        assert classify_provider_error(ProviderTestError('kaboom')) == UNKNOWN

    def test_classifies_an_empty_error_with_no_status_as_unknown(self):
        assert classify_provider_error('') == UNKNOWN

    def test_excludes_unknown_from_the_terminal_categories(self):
        """
        Stated directly, because every auto-disable decision reads this set. If
        UNKNOWN ever lands in it, one unrecognised message from a healthy
        provider is enough to switch it off.
        """
        assert UNKNOWN not in TERMINAL_CATEGORIES

    def test_treats_only_credit_and_key_failures_as_terminal(self):
        """
        Pins the whole set rather than one membership, so adding a transient
        category to it fails loudly here instead of quietly disabling providers
        that were only rate limited.
        """
        assert TERMINAL_CATEGORIES == frozenset({INSUFFICIENT_CREDIT, INVALID_KEY})

    def test_does_not_disable_a_provider_after_many_unrecognised_failures(self):
        """
        The behavioural form of the property above: even far past the threshold,
        an unclassifiable error must leave the provider enabled. This is the
        assertion that would catch UNKNOWN being made terminal by accident.
        """
        table = _table(consecutive_failures=99)

        outcome = record_provider_failure(table, 'gemini', 'Something new', now=NOW)

        assert outcome == {
            'category': UNKNOWN,
            'consecutive_failures': 99,
            'auto_disabled': False,
        }

    def test_writes_only_the_counter_update_for_an_unrecognised_failure(self):
        """No second write means no `enabled = false` was issued."""
        table = _table(consecutive_failures=99)

        record_provider_failure(table, 'gemini', 'Something new', now=NOW)

        assert table.update_item.call_count == 1


class TestRecordProviderFailureBookkeeping:
    """What lands on the provider row, so Settings can explain the problem."""

    def test_returns_the_classified_category_for_the_recorded_failure(self):
        table = _table()

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['category'] == INSUFFICIENT_CREDIT

    def test_stores_the_category_on_the_provider_row(self):
        """
        Settings reads `last_error_category` to say "No credit remaining"
        instead of showing a green tick, which is the user-visible half of the
        fix.
        """
        table = _table()

        record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert _write(table)['ExpressionAttributeValues'][':cat'] == INSUFFICIENT_CREDIT

    def test_stores_the_error_message_on_the_provider_row(self):
        table = _table()

        record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert _write(table)['ExpressionAttributeValues'][':err'] == ANTHROPIC_CREDIT_MESSAGE

    def test_truncates_a_very_long_error_message_to_500_characters(self):
        """
        Provider errors can carry an entire HTML error page. An unbounded write
        risks the 400KB DynamoDB item limit, which would make the write fail and
        lose the health signal entirely.
        """
        table = _table()

        record_provider_failure(table, 'claude', 'x' * 9000, now=NOW)

        assert len(_write(table)['ExpressionAttributeValues'][':err']) == 500

    def test_returns_the_failure_count_dynamodb_echoed_back(self):
        table = _table(consecutive_failures=2)

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['consecutive_failures'] == 2

    def test_returns_the_failure_count_as_an_int_not_a_decimal(self):
        """
        The count is tagged onto the search result and travels through the Step
        Functions state, which `json.dumps` cannot serialise as `Decimal`.
        """
        table = _table(consecutive_failures=2)

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert isinstance(outcome['consecutive_failures'], int)

    def test_increments_the_counter_atomically_rather_than_overwriting_it(self):
        """
        Providers are recorded per keyword, and keywords run in a Map state, so
        two failures can land concurrently. `ADD` merges them; a read-modify-SET
        would drop one and delay auto-disable indefinitely.
        """
        table = _table()

        record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert 'ADD consecutive_failures :one' in _write(table)['UpdateExpression']

    def test_writes_a_timestamp_when_the_caller_does_not_supply_one(self):
        """
        Exercises the default-clock path, which resolves `get_timestamp` through
        a function-level relative import placed outside the try block. If that
        import ever broke it would raise straight through the caller that
        documents itself as never raising.
        """
        table = _table()

        record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE)

        assert _write(table)['ExpressionAttributeValues'][':ts'].endswith('Z')


class TestAutoDisableThreshold:
    """
    Disabling is destructive, so the boundary is pinned on both sides.

    Too eager and a transient blip removes a working provider; too lax and a
    dead provider keeps burning five retry attempts per query on every run.
    """

    def test_uses_a_threshold_of_three_consecutive_failures(self):
        """The boundary the tests below are written against, stated once."""
        assert AUTO_DISABLE_THRESHOLD == 3

    def test_does_not_disable_a_provider_on_its_first_terminal_failure(self):
        table = _table(consecutive_failures=1)

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['auto_disabled'] is False

    def test_does_not_disable_a_provider_on_its_second_terminal_failure(self):
        """One below the threshold — the off-by-one that would disable too soon."""
        table = _table(consecutive_failures=2)

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['auto_disabled'] is False

    def test_issues_no_disable_write_below_the_threshold(self):
        table = _table(consecutive_failures=2)

        record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert table.update_item.call_count == 1

    def test_disables_a_provider_on_its_third_consecutive_terminal_failure(self):
        table = _table(consecutive_failures=3)

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['auto_disabled'] is True

    def test_sets_enabled_to_false_when_it_disables_a_provider(self):
        """The write that actually stops the provider being queried."""
        table = _table(consecutive_failures=3)

        record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert _write(table, 1)['ExpressionAttributeValues'][':off'] is False

    def test_records_why_a_provider_was_disabled(self):
        """Without the reason the user sees a disabled provider and no cause."""
        table = _table(consecutive_failures=3)

        record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert _write(table, 1)['ExpressionAttributeValues'][':cat'] == INSUFFICIENT_CREDIT

    def test_marks_the_row_as_auto_disabled_rather_than_user_disabled(self):
        """Settings must not present an automatic action as the user's own choice."""
        table = _table(consecutive_failures=3)

        record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert _write(table, 1)['ExpressionAttributeValues'][':true'] is True

    def test_disables_a_provider_after_three_rejected_key_failures(self):
        """The second terminal category; also unfixable by retrying."""
        table = _table(consecutive_failures=3)

        outcome = record_provider_failure(table, 'openai', 'Incorrect API key provided', now=NOW)

        assert outcome == {
            'category': INVALID_KEY,
            'consecutive_failures': 3,
            'auto_disabled': True,
        }

    def test_still_disables_a_provider_past_the_threshold(self):
        """The comparison is >=, so a missed run cannot let a dead provider through."""
        table = _table(consecutive_failures=7)

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['auto_disabled'] is True


class TestTransientFailuresNeverAutoDisable:
    """
    Rate limits and timeouts recover on their own. Disabling on them would take
    a healthy provider offline for a blip, and only a human could bring it back.
    """

    def test_does_not_disable_a_rate_limited_provider_at_the_threshold(self):
        table = _table(consecutive_failures=3)

        outcome = record_provider_failure(table, 'perplexity', 'Rate limit reached', now=NOW)

        assert outcome == {
            'category': RATE_LIMITED,
            'consecutive_failures': 3,
            'auto_disabled': False,
        }

    def test_does_not_disable_a_rate_limited_provider_however_often_it_repeats(self):
        """Sustained throttling is still throttling, not a broken account."""
        table = _table(consecutive_failures=50)

        outcome = record_provider_failure(table, 'perplexity', 'Rate limit reached', now=NOW)

        assert outcome['auto_disabled'] is False

    def test_issues_no_disable_write_for_a_repeatedly_rate_limited_provider(self):
        table = _table(consecutive_failures=50)

        record_provider_failure(table, 'perplexity', 'Rate limit reached', now=NOW)

        assert table.update_item.call_count == 1

    def test_does_not_disable_a_repeatedly_timing_out_provider(self):
        table = _table(consecutive_failures=50)

        outcome = record_provider_failure(table, 'gemini', 'Read timed out', now=NOW)

        assert outcome == {
            'category': TIMEOUT,
            'consecutive_failures': 50,
            'auto_disabled': False,
        }


class TestBookkeepingNeverMasksTheOriginalFailure:
    """
    The caller is already handling a provider error. A secondary DynamoDB
    failure must not replace it with a different exception, or a routine write
    blip turns one degraded provider into a failed run.
    """

    def test_returns_normally_when_the_counter_write_fails(self):
        table = MagicMock()
        table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ProvisionedThroughputExceededException'}}, 'UpdateItem'
        )

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome == {
            'category': INSUFFICIENT_CREDIT,
            'consecutive_failures': 0,
            'auto_disabled': False,
        }

    def test_still_classifies_the_error_when_the_counter_write_fails(self):
        """
        The category is derived before any write, so it survives a dead table.
        The caller tags it onto the search result, so the execution summary
        still explains the failure even when persistence is down.
        """
        table = MagicMock()
        table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ResourceNotFoundException'}}, 'UpdateItem'
        )

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['category'] == INSUFFICIENT_CREDIT

    def test_logs_an_error_when_the_counter_write_fails(self, caplog):
        """
        A swallowed exception with no log is the exact shape of the bug this
        module was written for. The log line is the only remaining evidence.
        """
        table = MagicMock()
        table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ResourceNotFoundException'}}, 'UpdateItem'
        )

        with caplog.at_level('ERROR', logger='shared.provider_health'):
            record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert 'provider_health_write_failed' in caplog.text

    def test_reports_not_disabled_when_the_disable_write_fails(self):
        """
        Same swallow pattern one call deeper. `auto_disabled` must describe what
        actually happened, so a failed disable is never reported as a success.
        """
        table = _table(consecutive_failures=3)
        table.update_item.side_effect = [
            {'Attributes': {'consecutive_failures': Decimal(3)}},
            ClientError({'Error': {'Code': 'ThrottlingException'}}, 'UpdateItem'),
        ]

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['auto_disabled'] is False

    def test_still_reports_the_failure_count_when_the_disable_write_fails(self):
        table = _table(consecutive_failures=3)
        table.update_item.side_effect = [
            {'Attributes': {'consecutive_failures': Decimal(3)}},
            ClientError({'Error': {'Code': 'ThrottlingException'}}, 'UpdateItem'),
        ]

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['consecutive_failures'] == 3

    def test_treats_a_response_without_attributes_as_zero_failures(self):
        """A malformed echo must not crash the caller mid-error-handling."""
        table = MagicMock()
        table.update_item.return_value = {}

        outcome = record_provider_failure(table, 'claude', ANTHROPIC_CREDIT_MESSAGE, now=NOW)

        assert outcome['consecutive_failures'] == 0


class TestRecordProviderSuccess:
    """
    Resetting the streak is what makes the threshold mean *consecutive*.
    Without it, three failures spread over weeks would eventually disable a
    provider that works almost always.
    """

    def test_resets_the_consecutive_failure_count_to_zero(self):
        table = MagicMock()

        record_provider_success(table, 'claude', now=NOW)

        assert _write(table)['ExpressionAttributeValues'][':zero'] == 0

    def test_clears_the_stored_error_category(self):
        """A stale category would keep Settings warning about a fixed provider."""
        table = MagicMock()

        record_provider_success(table, 'claude', now=NOW)

        assert 'last_error_category = :none' in _write(table)['UpdateExpression']

    def test_records_when_the_provider_last_answered(self):
        table = MagicMock()

        record_provider_success(table, 'claude', now=NOW)

        assert _write(table)['ExpressionAttributeValues'][':ts'] == NOW

    def test_does_not_re_enable_an_auto_disabled_provider(self):
        """
        Deliberately manual. Re-enabling on the first success would hide that
        anything happened — the provider would flap between disabled and
        enabled while the underlying billing problem was never addressed. The
        user re-enables it in Settings once they have actually fixed it.
        """
        table = MagicMock()

        record_provider_success(table, 'claude', now=NOW)

        assert 'enabled' not in _write(table)['UpdateExpression']

    def test_returns_normally_when_the_reset_write_fails(self):
        """A failed reset must not turn a successful provider query into an error."""
        table = MagicMock()
        table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ThrottlingException'}}, 'UpdateItem'
        )

        assert record_provider_success(table, 'claude', now=NOW) is None

    def test_writes_a_timestamp_when_the_caller_does_not_supply_one(self):
        """Exercises the same function-level relative import as the failure path."""
        table = MagicMock()

        record_provider_success(table, 'claude')

        assert _write(table)['ExpressionAttributeValues'][':ts'].endswith('Z')


class TestDescribeCategory:
    """
    The strings the dashboard shows. "No credit remaining" is actionable;
    "error" is what the user got for five days.
    """

    def test_describes_insufficient_credit_as_a_billing_problem(self):
        assert describe_category(INSUFFICIENT_CREDIT) == (
            'No credit remaining on this provider account'
        )

    def test_describes_invalid_key_as_a_key_problem(self):
        assert describe_category(INVALID_KEY) == 'API key rejected — check or replace the key'

    def test_describes_an_unrecognised_category_with_the_unknown_text(self):
        """Guards the `.get` fallback, so a new category never renders as blank."""
        assert describe_category('not-a-real-category') == (
            'Provider returned an unrecognised error'
        )
