"""
Tests for manage-bedrock-models.py — Settings > Bedrock models.

The contract (.kiro/specs/bedrock-model-picker.md): GET /models lists the three
tiers and the selectable global Claude profiles; POST /validate tests a model
(quota first, then a live Converse call in adaptive, then budget style) and
always answers 200 with a reason; PUT saves a re-tested model per tier or
resets it to the default. Every route is Admin-only and ``{id}`` must be
``bedrock``. AWS is stubbed on the module-level clients.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from decimal import Decimal
from types import ModuleType
from typing import Any
from unittest.mock import patch

import pytest
from botocore.exceptions import ReadTimeoutError

from testing.admin_authz_fixtures import caller_event, invoke
from testing.bedrock_model_fixtures import (
    ACCOUNT_ID,
    ACCOUNT_QUOTAS,
    FABLE_5,
    HAIKU_4_5,
    HAIKU_5_5,
    IAM_DENIED,
    LEGACY_MODEL,
    MARKETPLACE_DENIED,
    NEEDS_ADAPTIVE,
    NEEDS_BUDGET,
    OPUS_4_6,
    OPUS_5,
    OPUS_5_5,
    RETENTION_REFUSED,
    SONNET_4_6,
    SONNET_5_5,
    SONNET_5_5_TOKENS,
    THROTTLED_QUOTAS,
    UNREAD_QUOTA,
    FakeClock,
    bedrock_error,
    converse_reply,
    dynamodb_over,
    expected_quota,
    paginated,
    profile,
    quota_page,
    quotas_client,
    quotas_row,
    refusal,
    rows_table,
    runtime_client,
    tier_row,
    timestamp_hours_ago,
)
from testing.handler_fixtures import handler_fixture

_API_DIR = os.path.dirname(os.path.abspath(__file__))

module = handler_fixture(
    _API_DIR, 'manage-bedrock-models.py', 'manage_bedrock_models_under_test',
    env={'CORS_ORIGIN_PARAM': '', 'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config'},
)

FAST_ROLES = ['summarization', 'extraction', 'generation', 'research_evaluation']


class Aws:
    """The stubbed AWS clients of one test, and the ProviderConfig rows they serve."""

    def __init__(self, handler_module: ModuleType) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.table = rows_table(self.rows)
        self.table.update_item.side_effect = self._update
        self.runtime = runtime_client([converse_reply()])
        self.quotas = quotas_client(quota_page(*ACCOUNT_QUOTAS))
        self.bedrock = paginated({'inferenceProfileSummaries': []})
        self._patches = [
            patch.object(handler_module, 'dynamodb', dynamodb_over(self.table)),
            patch.object(handler_module, 'bedrock_runtime', self.runtime),
            patch.object(handler_module, 'service_quotas', self.quotas),
            patch.object(handler_module, 'bedrock', self.bedrock),
        ]

    def _update(self, **kwargs: Any) -> dict[str, Any]:
        """Stand-in for ``update_item`` that echoes the stored attributes (``ReturnValues='ALL_NEW'``)."""
        values = kwargs['ExpressionAttributeValues']
        row = {'provider_id': kwargs['Key']['provider_id'], 'model_updated_at': values[':ts'], 'updated_at': values[':ts']}
        if ':model' in values:
            row['model'] = values[':model']
        if ':style' in values:
            row.update(request_style=values[':style'], tested_at=values[':ts'])
        return {'Attributes': row}

    def converse_answers(self, *answers: Any) -> None:
        self.runtime.converse.side_effect = list(answers)

    def quota_pages(self, *outcomes: Any) -> None:
        """Successive ``list_service_quotas`` answers: pages (``quota_page``) or errors."""
        self.quotas.list_service_quotas.side_effect = list(outcomes)

    def one_page_then_throttled(self, *quotas: dict[str, Any]) -> None:
        """Service Quotas answers one page of ``quotas`` (more to come), then throttles."""
        self.quota_pages(quota_page(*quotas, next_token='page-2'), THROTTLED_QUOTAS)

    def store_quotas(self, *quotas: dict[str, Any], **attributes: Any) -> None:
        """A ``bedrock-quotas`` row holding ``quotas`` and ``attributes``."""
        self.rows['bedrock-quotas'] = quotas_row(*quotas, **attributes)

    def page_tokens(self) -> list[str | None]:
        """The ``NextToken`` each ``list_service_quotas`` call continued from (``None``: the first page)."""
        return [call.kwargs.get('NextToken') for call in self.quotas.list_service_quotas.call_args_list]

    @property
    def quota_row(self) -> dict[str, Any]:
        return self.rows['bedrock-quotas']

    def converse_styles(self) -> list[str]:
        """The style of each Converse call, read from its ``thinking`` field."""
        return [
            call.kwargs.get('additionalModelRequestFields', {}).get('thinking', {}).get('type', 'budget')
            for call in self.runtime.converse.call_args_list
        ]

    def __enter__(self) -> Aws:
        for active in self._patches:
            active.start()
        return self

    def __exit__(self, *exc: object) -> None:
        for active in reversed(self._patches):
            active.stop()


@pytest.fixture
def aws(module: ModuleType) -> Iterator[Aws]:
    module._quota_cache.clear()
    with Aws(module) as stubs:
        yield stubs


def _event(method: str, path: str, *, body: Any = None, groups: str | None = 'Admin', provider_id: str = 'bedrock') -> dict:
    return caller_event(
        method, path, groups=groups, body=body,
        path_params={'id': provider_id}, resource=path.replace(f'/{provider_id}', '/{id}', 1),
    )


def _list(module: ModuleType) -> tuple[int, Any]:
    return invoke(module, _event('GET', '/api/providers/bedrock/models'))


def _validate(module: ModuleType, model: Any, tier: Any = 'balanced') -> tuple[int, Any]:
    return invoke(module, _event('POST', '/api/providers/bedrock/validate', body={'tier': tier, 'model': model}))


def _save(module: ModuleType, body: dict) -> tuple[int, Any]:
    return invoke(module, _event('PUT', '/api/providers/bedrock', body=body))


# =============================================================================
# GET /api/providers/bedrock/models
# =============================================================================

class TestListModels:
    def test_lists_the_fast_tier_on_its_default_model(self, module, aws) -> None:
        _status, body = _list(module)

        assert body['tiers'][0] == {
            'tier': 'fast', 'model': HAIKU_5_5, 'default_model': HAIKU_5_5, 'is_default': True,
            'request_style': 'adaptive', 'model_updated_at': None, 'tested_at': None, 'roles': FAST_ROLES,
        }

    def test_lists_fast_balanced_and_deep_in_that_order(self, module, aws) -> None:
        _status, body = _list(module)

        assert [tier['tier'] for tier in body['tiers']] == ['fast', 'balanced', 'deep']

    def test_shows_a_saved_model_with_its_tested_style_and_timestamps(self, module, aws) -> None:
        aws.rows['bedrock-balanced'] = tier_row(
            'balanced', model=HAIKU_4_5, request_style='budget',
            model_updated_at='2026-10-08T09:00:00Z', tested_at='2026-10-08T09:00:00Z',
        )

        _status, body = _list(module)

        assert body['tiers'][1] == {
            'tier': 'balanced', 'model': HAIKU_4_5, 'default_model': SONNET_5_5, 'is_default': False,
            'request_style': 'budget', 'model_updated_at': '2026-10-08T09:00:00Z',
            'tested_at': '2026-10-08T09:00:00Z', 'roles': ['analysis', 'research_planning'],
        }

    def test_offers_active_global_claude_profiles_by_clean_name_sorted(self, module, aws) -> None:
        aws.bedrock.get_paginator.return_value.paginate.return_value = [
            {'inferenceProfileSummaries': [
                profile(SONNET_5_5, 'Global Anthropic Claude Sonnet 5.5'),
                profile('global.anthropic.claude-opus-4-5-20251101-v1:0', 'GLOBAL Anthropic Claude Opus 4.5'),
            ]},
            {'inferenceProfileSummaries': [
                profile('global.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Global Claude Sonnet 4.5'),
                profile(OPUS_5_5, 'Global Anthropic Claude Opus 5.5', status='LEGACY'),
                profile('us.anthropic.claude-haiku-5-5', 'US Anthropic Claude Haiku 5.5'),
                profile('global.amazon.nova-2-lite-v1:0', 'Global Amazon Nova 2 Lite'),
            ]},
        ]

        status, body = _list(module)

        assert (status, body['models']) == (200, [
            {'id': 'global.anthropic.claude-opus-4-5-20251101-v1:0', 'name': 'Claude Opus 4.5'},
            {'id': 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', 'name': 'Claude Sonnet 4.5'},
            {'id': SONNET_5_5, 'name': 'Claude Sonnet 5.5'},
        ])

    def test_lists_only_system_defined_profiles(self, module, aws) -> None:
        _list(module)

        aws.bedrock.get_paginator.return_value.paginate.assert_called_once_with(typeEquals='SYSTEM_DEFINED')

    def test_answers_502_without_account_details_when_listing_fails(self, module, aws) -> None:
        aws.bedrock.get_paginator.return_value.paginate.side_effect = bedrock_error(
            'AccessDeniedException', IAM_DENIED, 'ListInferenceProfiles',
        )

        status, body = _list(module)

        assert status == 502
        assert body['error'] == 'Could not list Bedrock models'
        assert ACCOUNT_ID not in body['details']
        assert 'arn:' not in body['details']


# =============================================================================
# POST /api/providers/bedrock/validate
# =============================================================================

class TestValidateSuccess:
    def test_reports_an_adaptive_model_with_its_quota(self, module, aws) -> None:
        with patch.object(module.time, 'perf_counter', side_effect=[10.0, 10.93]):
            status, body = _validate(module, SONNET_5_5)

        assert (status, body) == (200, {
            'valid': True, 'model': SONNET_5_5, 'request_style': 'adaptive', 'latency_ms': 930,
            'quota': expected_quota(6000000),
            'reason': None, 'error': None,
        })

    def test_sends_the_short_test_prompt_at_low_effort(self, module, aws) -> None:
        _validate(module, SONNET_5_5)

        assert aws.runtime.converse.call_args.kwargs == {
            'modelId': SONNET_5_5,
            'messages': [{'role': 'user', 'content': [{'text': 'Reply with the single word OK.'}]}],
            'inferenceConfig': {'maxTokens': 1064},
            'additionalModelRequestFields': {'thinking': {'type': 'adaptive'}, 'output_config': {'effort': 'low'}},
        }

    def test_falls_back_to_budget_style_when_adaptive_is_refused(self, module, aws) -> None:
        aws.converse_answers(refusal(NEEDS_BUDGET), converse_reply())

        _status, body = _validate(module, HAIKU_4_5)

        assert (body['valid'], body['request_style'], aws.converse_styles()) == (True, 'budget', ['adaptive', 'budget'])

    def test_reads_both_per_minute_quotas_of_the_model(self, module, aws) -> None:
        _status, body = _validate(module, HAIKU_4_5)

        assert body['quota'] == expected_quota(5000000, 10000)

    def test_matches_quota_names_that_carry_a_v1_suffix(self, module, aws) -> None:
        _status, body = _validate(module, OPUS_4_6)

        assert body['quota']['tokens_per_minute'] == 3000000

    def test_reports_a_null_quota_when_the_complete_reading_has_none_for_the_model(self, module, aws) -> None:
        _status, body = _validate(module, SONNET_4_6)

        assert (body['valid'], body['quota']) == (True, expected_quota())

    def test_reports_an_unknown_quota_while_the_reading_is_incomplete(self, module, aws) -> None:
        aws.one_page_then_throttled(UNREAD_QUOTA)

        _status, body = _validate(module, SONNET_5_5)

        assert (body['valid'], body['quota']) == (True, expected_quota(complete=False))

    def test_still_tests_the_model_when_the_quotas_cannot_be_listed(self, module, aws) -> None:
        aws.quota_pages(bedrock_error('AccessDeniedException', 'no', 'ListServiceQuotas'))

        _status, body = _validate(module, SONNET_5_5)

        assert (body['valid'], body['quota']['tokens_per_minute'], body['quota']['complete']) == (True, None, False)

    def test_still_tests_the_model_without_listing_when_the_stored_quotas_cannot_be_read(self, module, aws) -> None:
        aws.table.get_item.side_effect = bedrock_error('InternalServerError', 'boom', 'GetItem')

        _status, body = _validate(module, SONNET_5_5)

        assert (body['valid'], body['quota']['complete'], aws.quotas.list_service_quotas.call_count) == (True, False, 0)

    def test_gives_up_on_the_second_request_style_when_it_cannot_finish_in_time(self, module, aws) -> None:
        clock = FakeClock()
        aws.runtime.converse.side_effect = clock.ticking(15.0, refusal(NEEDS_BUDGET), converse_reply())

        with patch.object(module, '_clock', clock):
            _status, body = _validate(module, HAIKU_4_5)

        assert (body['valid'], body['reason'], aws.runtime.converse.call_count) == (False, 'error', 1)
        assert 'ran out of time' in body['error']


class TestValidateFailure:
    @pytest.mark.parametrize(
        ('answers', 'reason'),
        [
            pytest.param([bedrock_error('AccessDeniedException', MARKETPLACE_DENIED)], 'not_subscribed', id='not_subscribed'),
            pytest.param([bedrock_error('AccessDeniedException', IAM_DENIED)], 'access_denied', id='access_denied'),
            pytest.param([bedrock_error('ThrottlingException', 'Too many tokens, please wait')], 'throttled', id='throttled'),
            pytest.param([bedrock_error('ServiceQuotaExceededException', 'Too many requests, please wait')], 'throttled',
                         id='too_many_requests'),
            pytest.param([bedrock_error('ResourceNotFoundException', LEGACY_MODEL)], 'unavailable', id='legacy'),
            pytest.param([refusal(LEGACY_MODEL)], 'unavailable', id='legacy_as_validation'),
            pytest.param([refusal(RETENTION_REFUSED)], 'unsupported', id='retention_mode'),
            pytest.param([refusal(NEEDS_BUDGET), refusal(NEEDS_ADAPTIVE)], 'unsupported', id='neither_style'),
            pytest.param([bedrock_error('ModelErrorException', 'The model failed')], 'error', id='other_error'),
        ],
    )
    def test_names_the_reason_the_model_cannot_be_used(self, module, aws, answers, reason) -> None:
        aws.converse_answers(*answers)

        status, body = _validate(module, SONNET_5_5)

        assert (status, body['valid'], body['request_style'], body['reason']) == (200, False, None, reason)

    def test_explains_a_slow_answer_as_busy_rather_than_unreachable(self, module, aws) -> None:
        aws.converse_answers(ReadTimeoutError(endpoint_url='https://bedrock-runtime.example'))

        _, body = _validate(module, SONNET_5_5)

        assert (body['reason'], body['error']) == (
            'error', 'The model took longer than 8 s to answer; it may be busy right now. Try again.',
        )

    def test_explains_a_missing_subscription(self, module, aws) -> None:
        aws.converse_answers(bedrock_error('AccessDeniedException', MARKETPLACE_DENIED))

        _status, body = _validate(module, FABLE_5)

        assert 'not subscribed' in body['error']

    def test_hides_arns_and_account_ids_in_an_access_denied_error(self, module, aws) -> None:
        aws.converse_answers(bedrock_error('AccessDeniedException', IAM_DENIED))

        _status, body = _validate(module, SONNET_5_5)

        assert ACCOUNT_ID not in body['error']
        assert 'arn:' not in body['error']
        assert 'bedrock:InvokeModel' in body['error']

    def test_reports_no_capacity_without_calling_a_model_whose_quota_is_zero(self, module, aws) -> None:
        _status, body = _validate(module, OPUS_5)

        assert (body['reason'], body['quota']['tokens_per_minute'], aws.runtime.converse.call_count) == ('no_capacity', 0, 0)

    def test_does_not_retry_a_throttled_test(self, module, aws) -> None:
        aws.converse_answers(bedrock_error('ThrottlingException', 'Too many tokens'))

        _validate(module, SONNET_5_5)

        assert aws.runtime.converse.call_count == 1

    @pytest.mark.parametrize(
        ('tier', 'model'),
        [
            pytest.param('turbo', SONNET_5_5, id='unknown_tier'),
            pytest.param(None, SONNET_5_5, id='missing_tier'),
            pytest.param('fast', 'us.anthropic.claude-haiku-5-5', id='regional_profile'),
            pytest.param('fast', 'global.amazon.nova-2-lite-v1:0', id='not_claude'),
            pytest.param('fast', None, id='missing_model'),
        ],
    )
    def test_answers_400_for_a_malformed_tier_or_model(self, module, aws, tier, model) -> None:
        status, _body = _validate(module, model, tier)

        assert (status, aws.runtime.converse.call_count) == (400, 0)


# =============================================================================
# The quota reading (ProviderConfig row bedrock-quotas)
# =============================================================================

class TestQuotaReading:
    def test_continues_from_the_stored_token(self, module, aws) -> None:
        aws.store_quotas(next_token='page-7', complete=False)

        module.advance_quota_reading(5.0)

        assert aws.quotas.list_service_quotas.call_args_list[0].kwargs == {
            'ServiceCode': 'bedrock', 'MaxResults': 100, 'NextToken': 'page-7',
        }

    def test_keeps_the_quotas_already_read_and_stores_values_as_decimals(self, module, aws) -> None:
        aws.store_quotas(UNREAD_QUOTA, next_token='page-7', complete=False)
        aws.quota_pages(quota_page(SONNET_5_5_TOKENS))

        module.advance_quota_reading(5.0)

        assert aws.quota_row['quotas'] == {
            UNREAD_QUOTA['QuotaName']: {'code': 'L-OPUS45DAY', 'value': Decimal(285713280)},
            SONNET_5_5_TOKENS['QuotaName']: {'code': 'L-SONNET55', 'value': Decimal(6000000)},
        }

    def test_records_a_completed_cycle_without_a_token(self, module, aws) -> None:
        aws.quota_pages(quota_page(UNREAD_QUOTA, next_token='page-2'), quota_page(SONNET_5_5_TOKENS))

        with patch.object(module, 'get_timestamp', return_value='2026-10-08T12:00:00.000000Z'):
            module.advance_quota_reading(5.0)

        assert (aws.page_tokens(), aws.quota_row['complete'], aws.quota_row['completed_at'], 'next_token' in aws.quota_row) == (
            [None, 'page-2'], True, '2026-10-08T12:00:00.000000Z', False,
        )

    def test_stops_when_the_budget_is_spent_and_saves_the_next_token(self, module, aws) -> None:
        clock = FakeClock()
        pages = [quota_page(next_token=f'page-{number}') for number in range(2, 6)]
        aws.quotas.list_service_quotas.side_effect = clock.ticking(2.0, *pages)

        with patch.object(module, '_clock', clock):
            module.advance_quota_reading(5.0)

        assert (aws.page_tokens(), aws.quota_row['next_token'], aws.quota_row['complete']) == (
            [None, 'page-2', 'page-3'], 'page-4', False,
        )

    def test_stops_early_when_throttled_and_saves_the_progress(self, module, aws) -> None:
        aws.one_page_then_throttled(SONNET_5_5_TOKENS)

        module.advance_quota_reading(5.0)

        assert (aws.quota_row['next_token'], list(aws.quota_row['quotas'])) == ('page-2', [SONNET_5_5_TOKENS['QuotaName']])

    def test_makes_no_call_while_a_complete_reading_is_less_than_a_day_old(self, module, aws) -> None:
        aws.store_quotas(complete=True, completed_at=timestamp_hours_ago(23))

        module.advance_quota_reading(5.0)

        assert (aws.quotas.list_service_quotas.call_count, aws.table.put_item.call_count) == (0, 0)

    def test_starts_a_new_cycle_from_the_first_page_once_the_reading_is_a_day_old(self, module, aws) -> None:
        aws.store_quotas(complete=True, completed_at=timestamp_hours_ago(25))

        module.advance_quota_reading(5.0)

        assert aws.page_tokens() == [None]

    def test_answers_from_the_previous_map_while_a_new_cycle_runs(self, module, aws) -> None:
        aws.store_quotas(SONNET_5_5_TOKENS, complete=True, completed_at=timestamp_hours_ago(25))
        aws.one_page_then_throttled(UNREAD_QUOTA)

        _status, body = _validate(module, SONNET_5_5)

        assert (body['quota'], aws.quota_row['next_token']) == (expected_quota(6000000), 'page-2')

    def test_advances_an_incomplete_reading_on_every_call_despite_the_container_cache(self, module, aws) -> None:
        aws.quota_pages(quota_page(next_token='page-2'), THROTTLED_QUOTAS, quota_page(SONNET_5_5_TOKENS))

        module.quota_reading(5.0)
        reading = module.quota_reading(5.0)

        assert (reading.complete, reading.quotas[SONNET_5_5_TOKENS['QuotaName']].value) == (True, 6000000)

    def test_keeps_a_complete_reading_ten_minutes_in_the_container(self, module, aws) -> None:
        clock = FakeClock()
        with patch.object(module, '_clock', clock):
            for now in (0.0, 599.0, 600.0):
                clock.now = now
                module.quota_reading(5.0)

        assert aws.table.get_item.call_count == 2

    def test_the_model_list_advances_the_reading(self, module, aws) -> None:
        _list(module)

        assert (aws.page_tokens(), aws.quota_row['complete']) == ([None], True)


# =============================================================================
# PUT /api/providers/bedrock
# =============================================================================

class TestSave:
    @pytest.mark.parametrize('model', [None, '', ' ', SONNET_5_5])
    def test_resets_the_tier_to_its_default_without_a_test(self, module, aws, model) -> None:
        status, body = _save(module, {'tier': 'balanced', 'model': model})

        assert (status, body['model'], body['is_default'], aws.runtime.converse.call_count) == (200, SONNET_5_5, True, 0)

    def test_removes_the_override_from_the_tier_row(self, module, aws) -> None:
        _save(module, {'tier': 'balanced', 'model': None})

        assert aws.table.update_item.call_args.kwargs['UpdateExpression'] == (
            'SET model_updated_at = :ts, updated_at = :ts REMOVE model, request_style, tested_at'
        )

    def test_stores_the_tested_model_and_style(self, module, aws) -> None:
        aws.converse_answers(refusal(NEEDS_BUDGET), converse_reply())

        _save(module, {'tier': 'deep', 'model': HAIKU_4_5})

        update = aws.table.update_item.call_args.kwargs
        assert (update['Key'], update['ExpressionAttributeValues'][':model'], update['ExpressionAttributeValues'][':style']) == (
            {'provider_id': 'bedrock-deep'}, HAIKU_4_5, 'budget',
        )

    def test_answers_with_the_updated_tier(self, module, aws) -> None:
        status, body = _save(module, {'tier': 'deep', 'model': OPUS_4_6})

        assert (status, body['tier'], body['model'], body['is_default'], body['request_style']) == (
            200, 'deep', OPUS_4_6, False, 'adaptive',
        )
        assert body['tested_at'] == body['model_updated_at']

    def test_refuses_a_model_that_fails_the_test_with_its_reason(self, module, aws) -> None:
        aws.converse_answers(bedrock_error('AccessDeniedException', MARKETPLACE_DENIED))

        status, body = _save(module, {'tier': 'fast', 'model': FABLE_5})

        assert (status, body['error'], body['reason']) == (400, 'Model check failed', 'not_subscribed')
        assert aws.table.update_item.call_count == 0

    def test_saves_without_a_test_when_validation_is_off(self, module, aws) -> None:
        _save(module, {'tier': 'fast', 'model': SONNET_4_6, 'validate': False})

        assert (aws.runtime.converse.call_count, aws.table.update_item.call_args.kwargs['UpdateExpression']) == (
            0, 'SET model = :model, model_updated_at = :ts, updated_at = :ts REMOVE request_style, tested_at',
        )

    def test_answers_500_when_the_row_cannot_be_written(self, module, aws) -> None:
        aws.table.update_item.side_effect = bedrock_error('InternalServerError', 'boom', 'UpdateItem')

        status, body = _save(module, {'tier': 'fast', 'model': None})

        assert (status, body['error']) == (500, 'Failed to save model')

    def test_answers_400_for_a_model_outside_the_allowed_profiles(self, module, aws) -> None:
        status, _body = _save(module, {'tier': 'fast', 'model': 'arn:aws:bedrock:us-west-2::foundation-model/x'})

        assert (status, aws.table.update_item.call_count) == (400, 0)


# =============================================================================
# Access
# =============================================================================

_ROUTES = [
    pytest.param('GET', '/api/providers/bedrock/models', None, id='list'),
    pytest.param('POST', '/api/providers/bedrock/validate', {'tier': 'fast', 'model': HAIKU_5_5}, id='validate'),
    pytest.param('PUT', '/api/providers/bedrock', {'tier': 'fast', 'model': None}, id='save'),
]


class TestAccess:
    @pytest.mark.parametrize(('method', 'path', 'body'), _ROUTES)
    def test_refuses_a_caller_outside_the_admin_group(self, module, aws, method, path, body) -> None:
        status, _body = invoke(module, _event(method, path, body=body, groups=None))

        assert (status, aws.runtime.converse.call_count, aws.table.update_item.call_count) == (403, 0, 0)

    @pytest.mark.parametrize(('method', 'path', 'body'), _ROUTES)
    def test_answers_404_for_another_provider_id(self, module, aws, method, path, body) -> None:
        status, _body = invoke(module, _event(method, path.replace('bedrock', 'openai'), body=body, provider_id='openai'))

        assert status == 404
