"""The shared send-time ledger that paces one provider's requests across every Lambda slot."""

from __future__ import annotations

import logging
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from shared import provider_pacing
from shared.provider_pacing import claim_send_time, provider_min_interval_seconds, wait_for_send_slot

NOW = 1_800_000_000.0


def _conditional_failure() -> ClientError:
    return ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'UpdateItem')


def _ledger(next_send_at: float | None) -> MagicMock:
    """A ProviderConfig table whose pacer item says the provider is free from ``next_send_at`` (``None``: no item)."""
    table = MagicMock()
    item = {} if next_send_at is None else {'Item': {'provider_id': 'pacer#perplexity', 'next_send_at': Decimal(str(next_send_at))}}
    table.get_item.return_value = item
    return table


class TestProviderMinInterval:
    @pytest.mark.parametrize(('raw', 'expected'), [
        pytest.param(None, 0.0, id='unset'),
        pytest.param('', 0.0, id='blank'),
        pytest.param('1.1', 1.1, id='fraction'),
        pytest.param(' 12 ', 12.0, id='padded'),
        pytest.param('0', 0.0, id='zero'),
    ])
    def test_reads_the_interval_from_the_environment(self, monkeypatch, raw, expected):
        monkeypatch.delenv('PROVIDER_MIN_INTERVAL_SECONDS', raising=False)
        if raw is not None:
            monkeypatch.setenv('PROVIDER_MIN_INTERVAL_SECONDS', raw)

        assert provider_min_interval_seconds() == expected

    @pytest.mark.parametrize('raw', ['-1', 'soon'])
    def test_does_not_pace_and_warns_when_the_interval_is_unusable(self, monkeypatch, caplog, raw):
        monkeypatch.setenv('PROVIDER_MIN_INTERVAL_SECONDS', raw)

        with caplog.at_level(logging.WARNING, logger=provider_pacing.__name__):
            interval = provider_min_interval_seconds()

        assert interval == 0.0
        assert '[PACING_CONFIG]' in caplog.text


class TestClaimSendTime:
    def test_sends_at_once_and_opens_the_ledger_when_the_provider_was_never_paced(self):
        table = _ledger(None)

        slot = claim_send_time(table, 'perplexity', 1.0, now=lambda: NOW)

        assert slot == NOW
        table.update_item.assert_called_once_with(
            Key={'provider_id': 'pacer#perplexity'},
            UpdateExpression='SET next_send_at = :next',
            ConditionExpression='attribute_not_exists(next_send_at)',
            ExpressionAttributeValues={':next': Decimal(str(NOW + 1.0))},
        )

    def test_waits_its_turn_behind_the_previous_claim(self):
        table = _ledger(NOW + 0.4)

        slot = claim_send_time(table, 'perplexity', 1.0, now=lambda: NOW)

        assert slot == NOW + 0.4
        assert table.update_item.call_args.kwargs['ExpressionAttributeValues'] == {
            ':next': Decimal(str(NOW + 1.4)), ':previous': Decimal(str(NOW + 0.4)),
        }
        assert table.update_item.call_args.kwargs['ConditionExpression'] == 'next_send_at = :previous'

    def test_does_not_pay_an_idle_provider_back_with_a_burst(self):
        table = _ledger(NOW - 50)

        slot = claim_send_time(table, 'firecrawl', 12.0, now=lambda: NOW)

        assert slot == NOW
        assert table.update_item.call_args.kwargs['ExpressionAttributeValues'][':next'] == Decimal(str(NOW + 12.0))

    def test_claims_again_when_another_slot_took_the_turn_first(self):
        table = _ledger(NOW)
        table.update_item.side_effect = [_conditional_failure(), {}]

        slot = claim_send_time(table, 'perplexity', 1.0, now=lambda: NOW)

        assert slot == NOW
        assert table.get_item.call_count == 2

    @pytest.mark.parametrize(('failure', 'reported'), [
        pytest.param(_conditional_failure(), 'contended', id='every-claim-lost'),
        pytest.param(ClientError({'Error': {'Code': 'ProvisionedThroughputExceededException'}}, 'UpdateItem'), 'unavailable', id='dynamodb-error'),
        pytest.param(EndpointConnectionError(endpoint_url='https://dynamodb.example'), 'unavailable', id='network-error'),
    ])
    def test_sends_unpaced_and_says_why_when_the_ledger_cannot_be_claimed(self, caplog, failure, reported):
        table = _ledger(NOW)
        table.update_item.side_effect = failure

        with caplog.at_level(logging.WARNING, logger=provider_pacing.__name__):
            slot = claim_send_time(table, 'perplexity', 1.0, now=lambda: NOW)

        assert slot == NOW
        assert reported in caplog.text

    def test_gives_up_claiming_after_the_contention_budget(self):
        table = _ledger(NOW)
        table.update_item.side_effect = _conditional_failure()

        claim_send_time(table, 'perplexity', 1.0, now=lambda: NOW)

        assert table.update_item.call_count == provider_pacing.MAX_CLAIM_ATTEMPTS


class TestWaitForSendSlot:
    def test_sleeps_until_the_claimed_slot(self):
        table = _ledger(NOW + 2.5)
        sleep = MagicMock()

        waited = wait_for_send_slot(table, 'perplexity', 1.0, now=lambda: NOW, sleep=sleep)

        assert waited == 2.5
        sleep.assert_called_once_with(2.5)

    def test_does_not_sleep_when_the_slot_is_now(self):
        sleep = MagicMock()

        waited = wait_for_send_slot(_ledger(None), 'perplexity', 1.0, now=lambda: NOW, sleep=sleep)

        assert waited == 0.0
        sleep.assert_not_called()

    def test_does_not_touch_the_ledger_when_the_provider_is_unpaced(self):
        table = MagicMock()

        waited = wait_for_send_slot(table, 'brave', 0.0, now=lambda: NOW, sleep=MagicMock())

        assert waited == 0.0
        table.get_item.assert_not_called()

    def test_caps_a_runaway_slot(self):
        sleep = MagicMock()

        waited = wait_for_send_slot(_ledger(NOW + 10_000), 'perplexity', 1.0, now=lambda: NOW, sleep=sleep)

        assert waited == provider_pacing.MAX_WAIT_SECONDS
        sleep.assert_called_once_with(provider_pacing.MAX_WAIT_SECONDS)
