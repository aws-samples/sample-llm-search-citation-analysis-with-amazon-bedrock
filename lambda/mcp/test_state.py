"""
The MCP state table helpers: limits from the environment, daily counters, the run lock, tokens and audit records.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
import state

from testing.dynamodb_stubs import conditional_check_failure
from testing.mcp_state_fixtures import FakeStateTable, install_fake_table

NOW = datetime(2026, 12, 31, 23, 59, 30, tzinfo=UTC)
SUB = 'caller-1'


@pytest.fixture(autouse=True)
def table(monkeypatch) -> FakeStateTable:
    monkeypatch.setattr(state, 'utc_now', lambda: NOW)
    monkeypatch.setenv('MCP_STATE_TABLE', 'test-mcp-state')
    monkeypatch.delenv('MCP_LIMITS', raising=False)
    return install_fake_table(monkeypatch)


class TestLimits:
    def test_defaults_to_one_in_flight_five_runs_twenty_jobs_and_fifty_keywords(self):
        assert state.limits() == state.Limits(runs_in_flight=1, runs_per_day=5, jobs_per_day=20, max_run_keywords=50)

    def test_reads_the_camel_case_keys_of_mcp_limits(self, monkeypatch):
        monkeypatch.setenv('MCP_LIMITS', json.dumps({'runsPerDay': 2, 'maxRunKeywords': 10}))

        assert (state.limits().runs_per_day, state.limits().max_run_keywords, state.limits().jobs_per_day) == (2, 10, 20)

    @pytest.mark.parametrize('value', ['3', -1, True, 2.5, None])
    def test_ignores_a_value_that_is_not_a_non_negative_integer(self, monkeypatch, value):
        monkeypatch.setenv('MCP_LIMITS', json.dumps({'jobsPerDay': value}))

        assert state.limits().jobs_per_day == 20

    def test_counters_reset_at_the_next_utc_midnight_across_a_year_boundary(self):
        assert state.next_reset() == '2027-01-01T00:00:00Z'


class TestDailyCounters:
    def test_reserves_up_to_the_limit_then_refuses(self):
        days = [state.reserve(SUB, 'runs', 2) for _ in range(3)]

        assert days == ['2026-12-31', '2026-12-31', None]

    def test_refuses_every_use_with_a_limit_of_zero(self):
        assert state.reserve(SUB, 'runs', 0) is None

    def test_a_release_gives_the_use_back(self):
        day = state.reserve(SUB, 'jobs', 5)
        assert day is not None

        state.release(SUB, 'jobs', day)

        assert state.used_today(SUB, 'jobs') == 0

    def test_a_release_never_goes_below_zero(self, table):
        state.release(SUB, 'jobs', '2026-12-31')

        assert table.items == {}

    def test_counts_each_caller_separately(self):
        state.reserve(SUB, 'runs', 1)

        assert state.reserve('caller-2', 'runs', 1) == '2026-12-31'

    def test_expires_a_counter_two_days_later(self, table):
        state.reserve(SUB, 'runs', 1)

        assert table.items[(f'limit#{SUB}', 'runs#2026-12-31')]['ttl'] == int((NOW + timedelta(days=2)).timestamp())


class TestRunLock:
    def test_a_second_acquire_fails_while_the_lock_is_held(self):
        assert (state.acquire_run_lock(SUB), state.acquire_run_lock(SUB)) == (True, False)

    def test_an_expired_lock_can_be_taken_again(self, monkeypatch):
        state.acquire_run_lock(SUB)
        monkeypatch.setattr(state, 'utc_now', lambda: NOW + timedelta(minutes=2))

        assert state.acquire_run_lock(SUB) is True

    def test_a_released_lock_can_be_taken_again(self):
        state.acquire_run_lock(SUB)
        state.release_run_lock(SUB)

        assert state.acquire_run_lock(SUB) is True


class TestTokens:
    def test_issues_a_token_that_its_caller_can_consume_once(self):
        token, _expires = state.issue_token(SUB, 'run', 'digest-1')
        state.consume_token(token, SUB, 'run', 'digest-1')

        with pytest.raises(state.TokenRefused, match='unknown, already used or expired'):
            state.consume_token(token, SUB, 'run', 'digest-1')

    def test_keeps_a_token_presented_for_other_arguments(self):
        token, _expires = state.issue_token(SUB, 'run', 'digest-1')
        with pytest.raises(state.TokenRefused, match='issued for other arguments'):
            state.consume_token(token, SUB, 'run', 'digest-2')

        state.consume_token(token, SUB, 'run', 'digest-1')

    def test_refuses_a_token_of_another_family(self):
        token, _expires = state.issue_token(SUB, 'research', 'digest-1')

        with pytest.raises(state.TokenRefused, match='issued for other arguments'):
            state.consume_token(token, SUB, 'content', 'digest-1')

    def test_refuses_when_a_concurrent_start_deleted_the_token_first(self, monkeypatch):
        token, _expires = state.issue_token(SUB, 'run', 'digest-1')
        racing = FakeStateTable()
        racing.items = dict(state.table().items)
        monkeypatch.setattr(racing, 'delete_item', MagicMock(side_effect=conditional_check_failure('DeleteItem')))
        monkeypatch.setattr(state, '_table', racing)

        with pytest.raises(state.TokenRefused, match='has just been used'):
            state.consume_token(token, SUB, 'run', 'digest-1')

    def test_the_digest_ignores_key_order(self):
        assert state.request_digest({'a': 1, 'b': [1, 2]}) == state.request_digest({'b': [1, 2], 'a': 1})

    def test_the_digest_tells_different_requests_apart(self):
        assert state.request_digest({'scope': {'mode': 'all'}}) != state.request_digest({'scope': {'mode': 'groups'}})


class TestAuditRecords:
    def test_records_tool_operation_outcome_and_reason(self, table):
        state.record_audit(SUB, 'call_tool', 'start_run', 'token_refused', 'expired')

        record = table.partition(f'audit#{SUB}')[0]
        assert {key: record[key] for key in ('tool', 'operation', 'outcome', 'reason')} == {
            'tool': 'call_tool', 'operation': 'start_run', 'outcome': 'token_refused', 'reason': 'expired',
        }

    def test_omits_the_reason_of_a_call_that_was_not_refused(self, table):
        state.record_audit(SUB, 'manage_keywords', 'manage_keywords', 'http_201', None)

        assert 'reason' not in table.partition(f'audit#{SUB}')[0]

    def test_keeps_two_records_written_in_the_same_instant(self, table):
        state.record_audit(SUB, 'start_run', 'start_run', 'http_200', None)
        state.record_audit(SUB, 'start_run', 'start_run', 'http_200', None)

        assert len(table.partition(f'audit#{SUB}')) == 2

    def test_is_skipped_without_a_state_table(self, table, monkeypatch):
        monkeypatch.delenv('MCP_STATE_TABLE')

        state.record_audit(SUB, 'start_run', 'start_run', 'http_200', None)

        assert table.items == {}

    def test_a_failed_write_is_logged_not_raised(self, monkeypatch, caplog):
        failing = MagicMock()
        failing.put_item.side_effect = conditional_check_failure('PutItem')
        monkeypatch.setattr(state, '_table', failing)

        state.record_audit(SUB, 'start_run', 'start_run', 'http_200', None)

        assert 'Could not write the audit record of start_run' in caplog.text
