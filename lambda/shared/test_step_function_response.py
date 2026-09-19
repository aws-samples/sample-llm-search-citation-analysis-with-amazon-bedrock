"""
Tests for shared.step_function_response.

The Step Functions handlers (parse-keywords, search, deduplication, crawler)
report failures through ``log_error`` and successes through
``step_function_success``. These tests pin what reaches the logs and the
state machine:

- ``sanitize_error_for_step_function`` maps known exception types to a fixed
  safe phrase and never echoes the exception message
- ``log_error`` redacts credential-shaped event keys, truncates the event to
  500 characters, and only prints a traceback when asked
- ``step_function_success`` stamps ``status: success`` onto the payload
"""

from __future__ import annotations

import json
import logging
from typing import Any

import pytest
from botocore.exceptions import BotoCoreError, ClientError

from shared.step_function_response import (
    log_error,
    sanitize_error_for_step_function,
    step_function_success,
)

LOGGER_NAME = 'shared.step_function_response'


class UnmappedError(Exception):
    """An exception type ``sanitize_error_for_step_function`` has no entry for."""


class ResourceNotFoundException(Exception):
    """Named like the boto3 service exception so the type-name lookup matches it."""


def _module_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.name == LOGGER_NAME]


def _module_messages(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [record.getMessage() for record in _module_records(caplog)]


def _fail_inside_handler(message: str) -> None:
    raise ValueError(message)


def _log_error_while_handling(message: str, *, include_traceback: bool = True) -> None:
    """Call ``log_error`` from inside the ``except`` block, the way the Step Functions handlers do."""
    try:
        _fail_inside_handler(message)
    except ValueError as error:
        log_error(error, 'search handler', include_traceback=include_traceback)


class TestSanitizeErrorForStepFunction:
    @pytest.mark.parametrize(
        ('error', 'expected'),
        [
            (ValueError('bad'), 'Invalid input data: ValueError'),
            (KeyError('keyword'), 'Missing required field: KeyError'),
            (TypeError('bad type'), 'Invalid data type: TypeError'),
            (json.JSONDecodeError('Expecting value', '', 0), 'Invalid JSON format: JSONDecodeError'),
            (ConnectionError('reset'), 'Network connection failed: ConnectionError'),
            (TimeoutError('slow'), 'Operation timed out: TimeoutError'),
        ],
        ids=['ValueError', 'KeyError', 'TypeError', 'JSONDecodeError', 'ConnectionError', 'TimeoutError'],
    )
    def test_maps_known_builtin_types_to_their_safe_phrase(self, error: Exception, expected: str) -> None:
        assert sanitize_error_for_step_function(error) == expected

    def test_maps_boto_client_errors_to_aws_service_error(self) -> None:
        error = ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'slow down'}}, 'PutItem')

        assert sanitize_error_for_step_function(error) == 'AWS service error: ClientError'

    def test_maps_boto_core_errors_to_aws_sdk_error(self) -> None:
        assert sanitize_error_for_step_function(BotoCoreError()) == 'AWS SDK error: BotoCoreError'

    def test_maps_a_service_exception_by_its_class_name(self) -> None:
        error = ResourceNotFoundException('table missing')

        assert sanitize_error_for_step_function(error) == 'Resource not found: ResourceNotFoundException'

    def test_reports_unknown_types_as_unexpected_with_the_type_name(self) -> None:
        assert sanitize_error_for_step_function(UnmappedError('boom')) == 'Unexpected error: UnmappedError'

    def test_never_includes_the_exception_message(self) -> None:
        error = ValueError('api_key=sk-secret-value must not leak')

        assert 'sk-secret-value' not in sanitize_error_for_step_function(error)


def _messages_logged_for_event(caplog: pytest.LogCaptureFixture, event: dict[str, Any] | None) -> list[str]:
    """The messages ``log_error`` emits (traceback line off) for a ``ValueError`` with ``event`` attached."""
    with caplog.at_level(logging.ERROR, logger=LOGGER_NAME):
        log_error(ValueError('x'), 'search handler', event, include_traceback=False)
    return _module_messages(caplog)


class TestLogError:
    def test_logs_the_context_type_and_sanitized_message_at_error_level(self, caplog) -> None:
        with caplog.at_level(logging.ERROR, logger=LOGGER_NAME):
            log_error(ValueError('Missing keyword'), 'search handler', include_traceback=False)

        assert [(record.levelname, record.getMessage()) for record in _module_records(caplog)] == [
            ('ERROR', 'Error in search handler: ValueError - Invalid input data: ValueError'),
        ]

    def test_logs_the_event_with_credential_keys_removed(self, caplog) -> None:
        event = {
            'keyword': 'hotels',
            'api_key': 'sk-live',
            'secret': 'shh',
            'password': 'hunter2',
            'token': 'jwt',
        }

        assert _messages_logged_for_event(caplog, event)[1] == 'Event context: {"keyword": "hotels"}'

    def test_truncates_the_logged_event_to_500_characters(self, caplog) -> None:
        event = {'keyword': 'k' * 1000}

        event_line = _messages_logged_for_event(caplog, event)[1]

        assert event_line == 'Event context: ' + json.dumps(event)[:500]
        assert len(event_line) == len('Event context: ') + 500

    def test_serializes_non_json_event_values_with_str(self, caplog) -> None:
        event = {'started': {1, 2}}

        assert _messages_logged_for_event(caplog, event)[1] == 'Event context: {"started": "{1, 2}"}'

    def test_omits_the_event_line_when_no_event_is_given(self, caplog) -> None:
        assert len(_messages_logged_for_event(caplog, None)) == 1

    def test_omits_the_event_line_when_only_credential_keys_remain(self, caplog) -> None:
        assert len(_messages_logged_for_event(caplog, {'api_key': 'sk-live'})) == 1
        assert 'sk-live' not in caplog.text

    def test_appends_the_active_traceback_by_default(self, caplog) -> None:
        with caplog.at_level(logging.ERROR, logger=LOGGER_NAME):
            _log_error_while_handling('inside handler')

        traceback_line = _module_messages(caplog)[-1]
        assert traceback_line.startswith('Traceback:\nTraceback (most recent call last):')
        assert traceback_line.rstrip().endswith("ValueError: inside handler")

    def test_skips_the_traceback_line_when_disabled(self, caplog) -> None:
        with caplog.at_level(logging.ERROR, logger=LOGGER_NAME):
            _log_error_while_handling('inside handler', include_traceback=False)

        assert not any(message.startswith('Traceback:') for message in _module_messages(caplog))


class TestStepFunctionSuccess:
    def test_returns_the_payload_with_status_success(self) -> None:
        result = step_function_success({'keyword': 'hotels', 'citations': 3})

        assert result == {'status': 'success', 'keyword': 'hotels', 'citations': 3}

    def test_payload_status_overrides_the_default(self) -> None:
        """``**data`` is spread after ``status``, so a caller's own status wins."""
        assert step_function_success({'status': 'partial'}) == {'status': 'partial'}

    def test_returns_status_only_for_an_empty_payload(self) -> None:
        assert step_function_success({}) == {'status': 'success'}

    def test_logs_the_context_at_info_level_when_given(self, caplog) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            step_function_success({}, context='deduplication for hotels')

        assert [(record.levelname, record.getMessage()) for record in _module_records(caplog)] == [
            ('INFO', 'Success: deduplication for hotels'),
        ]

    def test_logs_nothing_without_a_context(self, caplog) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            step_function_success({'keyword': 'hotels'})

        assert _module_records(caplog) == []
