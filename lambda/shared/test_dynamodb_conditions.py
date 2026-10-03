"""Tests for shared.dynamodb_conditions."""

from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.dynamodb_conditions import applied_conditionally, is_conditional_check_failure
from testing.dynamodb_stubs import conditional_check_failure

_THROTTLED = ClientError({'Error': {'Code': 'ThrottlingException'}}, 'PutItem')


class TestIsConditionalCheckFailure:
    def test_recognises_a_failed_condition(self):
        assert is_conditional_check_failure(conditional_check_failure('PutItem')) is True

    def test_rejects_any_other_error_code(self):
        assert is_conditional_check_failure(_THROTTLED) is False


class TestAppliedConditionally:
    def test_returns_true_when_the_write_succeeds(self):
        assert applied_conditionally(MagicMock(return_value={})) is True

    def test_returns_false_when_the_condition_fails(self):
        assert applied_conditionally(MagicMock(side_effect=conditional_check_failure())) is False

    def test_propagates_any_other_client_error_unchanged(self):
        with pytest.raises(ClientError) as raised:
            applied_conditionally(MagicMock(side_effect=_THROTTLED))

        assert raised.value is _THROTTLED
