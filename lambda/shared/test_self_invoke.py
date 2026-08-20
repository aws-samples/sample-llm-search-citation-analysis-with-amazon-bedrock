"""
Tests for shared.self_invoke.invoke_self_async.

The helper replaces the three copy-pasted async self-invocation blocks
(bugs.md 3.4: keyword-research expand + competitor, content-studio
generation). These tests pin the shared contract:

- no ``AWS_LAMBDA_FUNCTION_NAME`` (local runs) -> synchronous fallback,
  no invoke attempted
- happy path -> exactly one Event invocation of the current function with
  the JSON payload; fallback untouched; optional success log emitted
- invoke failure -> logged, then ``SelfInvokeDispatchError`` raised. It does
  NOT fall back to running the job inline; see ``TestDispatchFailureFailsClosed``.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

from shared import self_invoke
from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async


class TestInvokeSelfAsync:
    def test_runs_fallback_synchronously_when_no_function_name_is_set(self):
        fallback = MagicMock()
        fake_boto3 = MagicMock()

        with (
            patch.dict(os.environ, {'AWS_LAMBDA_FUNCTION_NAME': ''}),
            patch.object(self_invoke, 'boto3', fake_boto3),
        ):
            invoke_self_async({'async_expand': True}, fallback, description='expand')

        fallback.assert_called_once_with()
        fake_boto3.client.assert_not_called()

    def test_invokes_current_function_as_event_with_json_payload(self):
        fallback = MagicMock()
        fake_boto3 = MagicMock()

        with (
            patch.dict(os.environ, {'AWS_LAMBDA_FUNCTION_NAME': 'research-fn'}),
            patch.object(self_invoke, 'boto3', fake_boto3),
        ):
            invoke_self_async(
                {'async_expand': True, 'research_id': 'abc'},
                fallback,
                description='expand',
            )

        fake_boto3.client.return_value.invoke.assert_called_once_with(
            FunctionName='research-fn',
            InvocationType='Event',
            Payload=json.dumps({'async_expand': True, 'research_id': 'abc'}),
        )
        fallback.assert_not_called()

    def test_logs_the_callers_description_when_the_invoke_call_fails(self, caplog):
        fallback = MagicMock()
        fake_boto3 = MagicMock()
        fake_boto3.client.return_value.invoke.side_effect = RuntimeError('denied')

        with (
            patch.dict(os.environ, {'AWS_LAMBDA_FUNCTION_NAME': 'research-fn'}),
            patch.object(self_invoke, 'boto3', fake_boto3),
            caplog.at_level(logging.ERROR, logger='shared.self_invoke'),
            pytest.raises(SelfInvokeDispatchError),
        ):
            invoke_self_async({'async_expand': True}, fallback, description='expand')

        assert 'Failed to trigger async expand: denied' in caplog.text


class TestDispatchFailureFailsClosed:
    """
    REGRESSION (AUDIT-2026-08-19 §2.9).

    This helper used to catch every exception from `invoke` and call
    `fallback()` — and the fallbacks callers pass in ARE the long jobs
    (`_process_generation_async`, `_process_expand_sync`,
    `_process_competitor_sync`). A failed dispatch therefore ran a multi-minute
    LLM job inline on an API-Gateway request: the client got a 504 at the
    gateway's hard 29s ceiling, while the function kept going to its own 300s
    timeout, billed the model call, and wrote the result nobody could see.

    The endpoint's whole reason for being async was defeated by its own error
    handler, and the test that used to live here asserted exactly that as the
    intended contract ("falls back synchronously when the invoke call fails"),
    which is why it went unnoticed.
    """

    def test_raises_instead_of_running_the_job_on_the_callers_request(self):
        """The core guarantee: the long fallback must NOT be executed."""
        fallback = MagicMock()
        fake_boto3 = MagicMock()
        fake_boto3.client.return_value.invoke.side_effect = RuntimeError('denied')

        with (
            patch.dict(os.environ, {'AWS_LAMBDA_FUNCTION_NAME': 'studio-fn'}),
            patch.object(self_invoke, 'boto3', fake_boto3),
            pytest.raises(SelfInvokeDispatchError),
        ):
            invoke_self_async({'async_generation': True}, fallback, description='generation')

        fallback.assert_not_called()

    def test_error_names_the_operation_that_could_not_be_started(self):
        fallback = MagicMock()
        fake_boto3 = MagicMock()
        fake_boto3.client.return_value.invoke.side_effect = RuntimeError('denied')

        with (
            patch.dict(os.environ, {'AWS_LAMBDA_FUNCTION_NAME': 'studio-fn'}),
            patch.object(self_invoke, 'boto3', fake_boto3),
            pytest.raises(SelfInvokeDispatchError, match='generation'),
        ):
            invoke_self_async({'async_generation': True}, fallback, description='generation')

    def test_preserves_the_underlying_cause_for_diagnosis(self):
        """`raise ... from e` — losing the boto3 error would hide the reason."""
        fallback = MagicMock()
        original = RuntimeError('AccessDeniedException')
        fake_boto3 = MagicMock()
        fake_boto3.client.return_value.invoke.side_effect = original

        with (
            patch.dict(os.environ, {'AWS_LAMBDA_FUNCTION_NAME': 'studio-fn'}),
            patch.object(self_invoke, 'boto3', fake_boto3),
            pytest.raises(SelfInvokeDispatchError) as exc_info,
        ):
            invoke_self_async({'async_generation': True}, fallback, description='generation')

        assert exc_info.value.__cause__ is original

    def test_still_runs_inline_outside_lambda_where_no_async_path_exists(self):
        """
        The local/test case must keep working: with no
        AWS_LAMBDA_FUNCTION_NAME there is nothing to dispatch to, so inline
        execution is correct rather than a silent downgrade.
        """
        fallback = MagicMock()
        fake_boto3 = MagicMock()

        with (
            patch.dict(os.environ, {'AWS_LAMBDA_FUNCTION_NAME': ''}),
            patch.object(self_invoke, 'boto3', fake_boto3),
        ):
            invoke_self_async({'async_generation': True}, fallback, description='generation')

        fallback.assert_called_once_with()

    def test_emits_the_success_log_only_after_a_successful_invoke(self, caplog):
        fallback = MagicMock()
        fake_boto3 = MagicMock()

        with (
            patch.dict(os.environ, {'AWS_LAMBDA_FUNCTION_NAME': 'studio-fn'}),
            patch.object(self_invoke, 'boto3', fake_boto3),
            caplog.at_level(logging.INFO, logger='shared.self_invoke'),
        ):
            invoke_self_async(
                {'async_generation': True},
                fallback,
                description='generation',
                success_log='Triggered async generation for content_id=abc',
            )

        assert 'Triggered async generation for content_id=abc' in caplog.text
