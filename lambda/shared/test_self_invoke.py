"""Tests for fail-closed asynchronous Lambda invocation."""

from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async


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


def _client_whose_invoke_raises(error: ClientError) -> MagicMock:
    lambda_client = MagicMock()
    lambda_client.invoke.side_effect = error
    return lambda_client


def _start_generation(lambda_client: MagicMock) -> dict[str, object]:
    """Ask ``content-worker`` to start an async generation through ``lambda_client``."""
    return invoke_self_async(
        "content-worker",
        b'{"action":"generate"}',
        description="generation",
        lambda_client=lambda_client,
    )


class TestInvokeSelfAsync:
    def test_invokes_named_function_as_event_with_encoded_payload(self) -> None:
        lambda_client = MagicMock()

        _start_generation(lambda_client)

        lambda_client.invoke.assert_called_once_with(
            FunctionName="content-worker",
            InvocationType="Event",
            Payload=b'{"action":"generate"}',
        )

    def test_returns_the_invoke_response(self) -> None:
        lambda_client = MagicMock()
        lambda_client.invoke.return_value = {"StatusCode": 202}

        assert _start_generation(lambda_client) == {"StatusCode": 202}

    def test_logs_callers_description_when_invoke_fails(self, caplog: pytest.LogCaptureFixture) -> None:
        with (
            caplog.at_level(logging.ERROR, logger="shared.self_invoke"),
            pytest.raises(SelfInvokeDispatchError),
        ):
            _start_generation(_client_whose_invoke_raises(_invoke_error("denied")))

        assert "Failed to trigger async generation" in caplog.text


class TestDispatchFailureFailsClosed:
    def test_error_names_operation_that_could_not_start(self) -> None:
        with pytest.raises(SelfInvokeDispatchError, match="generation"):
            _start_generation(_client_whose_invoke_raises(_invoke_error("denied")))

    def test_preserves_underlying_cause_for_diagnosis(self) -> None:
        original = _invoke_error("AccessDeniedException")

        with pytest.raises(SelfInvokeDispatchError) as exc_info:
            _start_generation(_client_whose_invoke_raises(original))

        assert exc_info.value.__cause__ is original
