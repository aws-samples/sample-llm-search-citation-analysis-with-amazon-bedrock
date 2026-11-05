"""``invoke_bedrock`` under a request deadline: bounded client, no sleep past the budget, typed error."""

import os
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ReadTimeoutError

from shared.request_deadline import Deadline
from testing.bedrock_model_fixtures import bedrock_error, converse_reply, runtime_client
from testing.module_loader import load_handler_module

_HERE = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture(autouse=True)
def clear_bedrock_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in list(os.environ.keys()):
        if key.startswith(("BEDROCK_TIER_", "BEDROCK_MODEL_")):
            monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv('DYNAMODB_TABLE_PROVIDER_CONFIG', raising=False)


@pytest.fixture
def models_module():
    return load_handler_module(_HERE, 'models.py', 'models_deadline_under_test')


class _Clock:
    """A clock the test moves by hand (and that ``time.sleep`` advances when patched to it)."""

    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _bounded(models_module, side_effect) -> tuple[MagicMock, MagicMock]:
    """Patch ``boto3.client`` (the factory of deadline-bound clients); the factory and the client."""
    client = runtime_client(side_effect)
    factory = MagicMock(return_value=client)
    models_module.boto3 = MagicMock(client=factory)
    return factory, client


class TestBoundedClient:
    def test_waits_at_most_the_budget_left_less_the_margin(self, models_module) -> None:
        factory, _ = _bounded(models_module, [converse_reply({'text': 'ok'})])

        models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(20.5, _Clock()))

        assert factory.call_args.kwargs['config'].read_timeout == 19

    def test_turns_botocore_retries_off(self, models_module) -> None:
        factory, _ = _bounded(models_module, [converse_reply({'text': 'ok'})])

        models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(20, _Clock()))

        assert factory.call_args.kwargs['config'].retries == {'mode': 'standard', 'max_attempts': 1}

    def test_connects_within_two_seconds(self, models_module) -> None:
        factory, _ = _bounded(models_module, [converse_reply({'text': 'ok'})])

        models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(20, _Clock()))

        assert factory.call_args.kwargs['config'].connect_timeout == 2

    def test_returns_the_answer_text_when_bedrock_answers_in_time(self, models_module) -> None:
        _bounded(models_module, [converse_reply({'text': 'fine'})])

        answer = models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(20, _Clock()))

        assert answer == 'fine'

    def test_reuses_the_client_of_the_same_timeout(self, models_module) -> None:
        factory, _ = _bounded(models_module, [converse_reply({'text': 'a'}), converse_reply({'text': 'b'})])
        clock = _Clock()

        models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(20, clock))
        models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(20, clock))

        assert factory.call_count == 1

    def test_keeps_the_default_client_without_a_deadline(self, models_module) -> None:
        factory, _ = _bounded(models_module, [])
        models_module._bedrock_client = runtime_client([converse_reply({'text': 'worker'})])

        answer = models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS)

        assert (answer, factory.call_count) == ('worker', 0)


class TestRunningOutOfTime:
    def test_raises_the_deadline_error_when_bedrock_does_not_answer_in_time(self, models_module) -> None:
        _bounded(models_module, ReadTimeoutError(endpoint_url='https://bedrock-runtime'))

        with pytest.raises(models_module.BedrockDeadlineError, match='did not answer within 19 s'):
            models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(20, _Clock()))

    def test_does_not_call_bedrock_when_the_budget_is_nearly_spent(self, models_module) -> None:
        _, client = _bounded(models_module, [converse_reply({'text': 'late'})])

        with pytest.raises(models_module.BedrockDeadlineError, match='No time left'):
            models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(3.5, _Clock()))

        assert client.converse.call_count == 0

    def test_deadline_error_is_a_bedrock_invocation_error(self, models_module) -> None:
        assert issubclass(models_module.BedrockDeadlineError, models_module.BedrockInvocationError)


class TestThrottlingUnderDeadline:
    def test_gives_up_instead_of_sleeping_past_the_budget(self, models_module) -> None:
        _, client = _bounded(models_module, [bedrock_error('ThrottlingException', 'slow'), converse_reply()])

        with (
            patch.object(models_module.time, 'sleep') as sleep,
            pytest.raises(models_module.BedrockDeadlineError, match='throttling'),
        ):
            models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(5, _Clock()))

        assert (client.converse.call_count, sleep.call_count) == (1, 0)

    def test_retries_after_backoff_while_the_budget_has_room(self, models_module) -> None:
        _, client = _bounded(models_module, [bedrock_error('ThrottlingException', 'slow'), converse_reply({'text': 'ok'})])

        with patch.object(models_module.time, 'sleep'):
            answer = models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(20, _Clock()))

        assert (answer, client.converse.call_count) == ('ok', 2)

    def test_second_attempt_waits_only_what_is_left_after_the_backoff(self, models_module) -> None:
        factory, _ = _bounded(models_module, [bedrock_error('ThrottlingException', 'slow'), converse_reply({'text': 'ok'})])
        clock = _Clock()

        with (
            patch.object(models_module.random, 'uniform', return_value=0.0),
            patch.object(models_module.time, 'sleep', side_effect=clock.advance),
        ):
            models_module.invoke_bedrock('q', models_module.ModelRole.ANALYSIS, deadline=Deadline(20, clock))

        assert [call.kwargs['config'].read_timeout for call in factory.call_args_list] == [19, 18]
