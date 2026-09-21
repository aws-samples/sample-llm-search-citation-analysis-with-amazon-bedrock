"""Tests for fail-closed asynchronous Lambda invocation."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared import self_invoke
from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async


@contextmanager
def _lambda_env(function_name: str, fake_boto3: MagicMock) -> Iterator[None]:
    with (
        patch.dict(os.environ, {"AWS_LAMBDA_FUNCTION_NAME": function_name}),
        patch.object(self_invoke, "boto3", fake_boto3),
    ):
        yield


def _invoke_error(message: str) -> ClientError:
    return ClientError(
        {
            "Error": {
                "Code": "AccessDeniedException",
                "Message": message,
            }
        },
        "Invoke",
    )


def _boto3_whose_invoke_raises(error: ClientError) -> MagicMock:
    fake_boto3 = MagicMock()
    fake_boto3.client.return_value.invoke.side_effect = error
    return fake_boto3


class TestInvokeSelfAsync:
    def test_runs_fallback_synchronously_when_no_function_name_is_set(self) -> None:
        fallback = MagicMock()
        fake_boto3 = MagicMock()

        with _lambda_env("", fake_boto3):
            invoke_self_async({"async_expand": True}, fallback, description="expand")

        fallback.assert_called_once_with()
        fake_boto3.client.assert_not_called()

    def test_invokes_current_function_as_event_with_json_payload(self) -> None:
        fallback = MagicMock()
        fake_boto3 = MagicMock()

        with _lambda_env("research-fn", fake_boto3):
            invoke_self_async(
                {"async_expand": True, "research_id": "abc"},
                fallback,
                description="expand",
            )

        fake_boto3.client.return_value.invoke.assert_called_once_with(
            FunctionName="research-fn",
            InvocationType="Event",
            Payload=json.dumps({"async_expand": True, "research_id": "abc"}),
        )
        fallback.assert_not_called()

    def test_invokes_explicit_function_with_preencoded_payload(self) -> None:
        lambda_client = MagicMock()
        payload = {"legacy_generation": True}

        invoke_self_async(
            payload,
            None,
            description="generation",
            function_name="content-worker",
            payload_bytes=b'{"legacy_generation":true}',
            lambda_client=lambda_client,
        )

        lambda_client.invoke.assert_called_once_with(
            FunctionName="content-worker",
            InvocationType="Event",
            Payload=b'{"legacy_generation":true}',
        )

    def test_logs_callers_description_when_invoke_fails(self, caplog: pytest.LogCaptureFixture) -> None:
        fallback = MagicMock()
        fake_boto3 = _boto3_whose_invoke_raises(_invoke_error("denied"))

        with (
            _lambda_env("research-fn", fake_boto3),
            caplog.at_level(logging.ERROR, logger="shared.self_invoke"),
            pytest.raises(SelfInvokeDispatchError),
        ):
            invoke_self_async({"async_expand": True}, fallback, description="expand")

        assert "Failed to trigger async expand" in caplog.text


class TestDispatchFailureFailsClosed:
    def test_raises_instead_of_running_job_on_callers_request(self) -> None:
        fallback = MagicMock()
        fake_boto3 = _boto3_whose_invoke_raises(_invoke_error("denied"))

        with _lambda_env("studio-fn", fake_boto3), pytest.raises(SelfInvokeDispatchError):
            invoke_self_async(
                {"async_generation": True},
                fallback,
                description="generation",
            )

        fallback.assert_not_called()

    def test_error_names_operation_that_could_not_start(self) -> None:
        fallback = MagicMock()
        fake_boto3 = _boto3_whose_invoke_raises(_invoke_error("denied"))

        with _lambda_env("studio-fn", fake_boto3), pytest.raises(
            SelfInvokeDispatchError,
            match="generation",
        ):
            invoke_self_async(
                {"async_generation": True},
                fallback,
                description="generation",
            )

    def test_preserves_underlying_cause_for_diagnosis(self) -> None:
        fallback = MagicMock()
        original = _invoke_error("AccessDeniedException")
        fake_boto3 = _boto3_whose_invoke_raises(original)

        with _lambda_env("studio-fn", fake_boto3), pytest.raises(
            SelfInvokeDispatchError
        ) as exc_info:
            invoke_self_async(
                {"async_generation": True},
                fallback,
                description="generation",
            )

        assert exc_info.value.__cause__ is original

    def test_runs_inline_outside_lambda_when_no_async_path_exists(self) -> None:
        fallback = MagicMock()
        fake_boto3 = MagicMock()

        with _lambda_env("", fake_boto3):
            invoke_self_async(
                {"async_generation": True},
                fallback,
                description="generation",
            )

        fallback.assert_called_once_with()

    def test_emits_success_log_only_after_successful_invoke(
        self,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        fallback = MagicMock()
        fake_boto3 = MagicMock()

        with (
            _lambda_env("studio-fn", fake_boto3),
            caplog.at_level(logging.INFO, logger="shared.self_invoke"),
        ):
            invoke_self_async(
                {"async_generation": True},
                fallback,
                description="generation",
                success_log="Triggered async generation for content_id=abc",
            )

        assert "Triggered async generation for content_id=abc" in caplog.text
