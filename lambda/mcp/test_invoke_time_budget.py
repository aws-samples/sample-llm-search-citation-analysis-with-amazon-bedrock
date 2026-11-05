"""The MCP request's time budget (2.42.0): a router is waited for only as long as the request has left."""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import MagicMock, patch

import invoke
import pytest
from botocore.exceptions import ReadTimeoutError
from catalogue import find_operation

from shared.request_deadline import Deadline, activate_deadline, clear_request_deadline, current_deadline

_TIMED_OUT = ReadTimeoutError(endpoint_url='https://lambda.eu-west-1.amazonaws.com')

#: The unpatched client factory, kept before any test patches ``invoke.lambda_client``.
real_lambda_client = invoke.lambda_client


@pytest.fixture
def budget() -> Iterator[None]:
    """``activate_deadline`` inside the test; the deadline is cleared afterwards."""
    yield
    clear_request_deadline()


def _list_groups(caller) -> dict:
    return invoke.run_operation('list_keyword_groups', find_operation('list_keyword_groups'), {}, caller)


class TestRouterTimeout:
    def test_answers_a_router_that_does_not_answer_in_time_with_upstream_timeout(self, api, caller) -> None:
        api.client.invoke.side_effect = _TIMED_OUT

        result = _list_groups(caller)

        assert (result['isError'], result['structuredContent']['error']) == (True, 'upstream_timeout')

    def test_warns_that_a_write_may_still_complete(self, api, caller) -> None:
        api.client.invoke.side_effect = _TIMED_OUT

        assert _list_groups(caller)['structuredContent']['details'] == invoke.UPSTREAM_TIMEOUT_MESSAGE

    def test_audits_the_call_as_an_upstream_timeout(self, api, caller, audit) -> None:
        api.client.invoke.side_effect = _TIMED_OUT

        _list_groups(caller)

        assert [line['outcome'] for line in audit()] == ['upstream_timeout']

    @pytest.mark.usefixtures('budget')
    def test_asks_no_router_when_the_request_has_no_time_left(self, api, caller) -> None:
        activate_deadline(Deadline(0.5))

        result = _list_groups(caller)

        assert (result['structuredContent']['error'], api.client.invoke.call_count) == ('upstream_timeout', 0)

    @pytest.mark.usefixtures('budget')
    def test_waits_for_the_router_only_the_time_the_request_has_left(self, api, caller) -> None:
        activate_deadline(Deadline(10.5))

        with patch.object(invoke, 'lambda_client', MagicMock(return_value=api.client)) as factory:
            _list_groups(caller)

        assert factory.call_args.args == (9,)


class TestLambdaClient:
    @pytest.fixture
    def built(self) -> Iterator[MagicMock]:
        with patch.object(invoke.boto3, 'client') as client, patch.dict(invoke._lambda_clients, clear=True):
            real_lambda_client(12)
            yield client

    def test_never_retries_an_invoke(self, built) -> None:
        assert built.call_args.kwargs['config'].retries == {'total_max_attempts': 1}

    def test_reads_for_the_timeout_it_was_asked_for(self, built) -> None:
        assert built.call_args.kwargs['config'].read_timeout == 12

    def test_reuses_the_client_of_a_timeout(self, built) -> None:
        real_lambda_client(12)

        assert built.call_count == 1


class TestHandlerDeadline:
    def test_starts_the_requests_deadline_from_the_lambda_context(self, mcp_handler) -> None:
        context = MagicMock()
        context.get_remaining_time_in_millis.return_value = 29_000
        seen: list[float] = []

        def serve(_event: dict) -> dict:
            seen.append(current_deadline().remaining())
            return {}

        with patch.object(mcp_handler, '_serve', side_effect=serve):
            mcp_handler.handler({}, context)

        assert seen == [pytest.approx(25, abs=0.5)]

    def test_clears_the_deadline_when_the_request_ends(self, mcp_handler) -> None:
        context = MagicMock()
        context.get_remaining_time_in_millis.return_value = 5_000

        with patch.object(mcp_handler, '_serve', return_value={}):
            mcp_handler.handler({}, context)

        assert current_deadline().remaining() == pytest.approx(25, abs=0.5)
