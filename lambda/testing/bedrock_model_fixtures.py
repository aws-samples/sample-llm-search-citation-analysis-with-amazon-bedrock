"""Bedrock ids, refusals, Converse replies and AWS stubs for the model-picker tests.

Shared by ``shared/test_models.py`` (runtime resolution and the self-correcting
retry) and ``api/test_manage_bedrock_models.py`` (Settings > Bedrock models).
The refusal texts are the ones Bedrock returned in the live checks of
2026-10-08, trimmed to the part the code recognises.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock

from botocore.exceptions import ClientError

HAIKU_5_5 = 'global.anthropic.claude-haiku-5-5'
SONNET_5_5 = 'global.anthropic.claude-sonnet-5-5'
OPUS_5_5 = 'global.anthropic.claude-opus-5-5'
HAIKU_4_5 = 'global.anthropic.claude-haiku-4-5-20251001-v1:0'
SONNET_4_6 = 'global.anthropic.claude-sonnet-4-6'
OPUS_4_6 = 'global.anthropic.claude-opus-4-6-v1'
OPUS_5 = 'global.anthropic.claude-opus-5'
FABLE_5 = 'global.anthropic.claude-fable-5'

ACCOUNT_ID = '123456789012'
ROLE_ARN = f'arn:aws:sts::{ACCOUNT_ID}:assumed-role/CitationAnalysis-API-ConfigMgmt/session'

NEEDS_ADAPTIVE = 'The model returned the following errors: `temperature` is deprecated for this model.'
NEEDS_BUDGET = 'The model returned the following errors: adaptive thinking is not supported on this model'
OUTPUT_CONFIG_REFUSED = 'The model returned the following errors: output_config.effort: Extra inputs are not permitted'
RETENTION_REFUSED = "The model returned the following errors: data retention mode 'default' is not available for this model"
MARKETPLACE_DENIED = (
    'Model access is denied due to IAM user or service role is not authorized to perform the required '
    'AWS Marketplace actions (aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe) to enable access to this model.'
)
IAM_DENIED = (
    f'User: {ROLE_ARN} is not authorized to perform: bedrock:InvokeModel on resource: '
    f'arn:aws:bedrock:us-west-2:{ACCOUNT_ID}:inference-profile/{SONNET_5_5}'
)
LEGACY_MODEL = 'This model version has reached the end of its life. Please upgrade to an active model.'


def bedrock_error(code: str, message: str, operation: str = 'Converse') -> ClientError:
    """The ``ClientError`` boto3 raises when ``operation`` fails with ``code``."""
    return ClientError({'Error': {'Code': code, 'Message': message}}, operation)


def refusal(message: str) -> ClientError:
    """A ``ValidationException`` from Converse carrying ``message``."""
    return bedrock_error('ValidationException', message)


def converse_reply(*blocks: dict) -> dict:
    """A ``converse`` response whose message holds ``blocks`` (one ``OK`` text block by default)."""
    return {'output': {'message': {'content': list(blocks or ({'text': 'OK'},))}}}


def runtime_client(side_effect: Any) -> MagicMock:
    """A ``bedrock-runtime`` client whose ``converse`` follows ``side_effect`` (replies and/or errors)."""
    client = MagicMock()
    client.converse.side_effect = side_effect
    return client


def tier_row(tier: str, **attributes: Any) -> dict[str, Any]:
    """A ProviderConfig ``bedrock-<tier>`` row with ``attributes``."""
    return {'provider_id': f'bedrock-{tier}', **attributes}


def rows_table(rows: dict[str, dict[str, Any]]) -> MagicMock:
    """A ProviderConfig table stub over ``rows`` (by ``provider_id``): ``get_item`` reads them, ``put_item`` stores."""
    table = MagicMock()
    table.get_item.side_effect = lambda **kwargs: (
        {'Item': dict(rows[kwargs['Key']['provider_id']])} if kwargs['Key']['provider_id'] in rows else {}
    )
    table.put_item.side_effect = lambda **kwargs: rows.__setitem__(kwargs['Item']['provider_id'], dict(kwargs['Item']))
    return table


def dynamodb_over(table: MagicMock) -> MagicMock:
    """A ``boto3.resource('dynamodb')`` whose every ``Table(...)`` is ``table``."""
    resource = MagicMock()
    resource.Table.return_value = table
    return resource


def paginated(*pages: Mapping[str, Any]) -> MagicMock:
    """A client whose ``get_paginator(...).paginate(...)`` yields ``pages``."""
    client = MagicMock()
    client.get_paginator.return_value.paginate.return_value = list(pages)
    return client


def profile(profile_id: str, name: str, status: str = 'ACTIVE') -> dict[str, str]:
    """One ``list_inference_profiles`` summary."""
    return {'inferenceProfileId': profile_id, 'inferenceProfileName': name, 'status': status}


def quota(name: str, value: float, code: str = 'L-TEST0000') -> dict[str, Any]:
    """One ``list_service_quotas`` entry for a global cross-region Anthropic quota."""
    return {'QuotaName': f'Global cross-region model inference {name}', 'QuotaCode': code, 'Value': value}


def quota_page(*quotas: Mapping[str, Any], next_token: str | None = None) -> dict[str, Any]:
    """One ``list_service_quotas`` response; ``next_token`` when more pages follow."""
    page: dict[str, Any] = {'Quotas': [dict(entry) for entry in quotas]}
    if next_token is not None:
        page['NextToken'] = next_token
    return page


def quotas_client(*outcomes: Any) -> MagicMock:
    """A ``service-quotas`` client whose successive ``list_service_quotas`` calls follow ``outcomes`` (pages / errors)."""
    client = MagicMock()
    client.list_service_quotas.side_effect = list(outcomes)
    return client


def quotas_row(*quotas: Mapping[str, Any], **attributes: Any) -> dict[str, Any]:
    """The ProviderConfig ``bedrock-quotas`` row holding ``quotas`` as stored (``Decimal`` values)."""
    stored = {entry['QuotaName']: {'code': entry['QuotaCode'], 'value': Decimal(int(entry['Value']))} for entry in quotas}
    return {'provider_id': 'bedrock-quotas', 'quotas': stored, **attributes}


def timestamp_hours_ago(hours: float) -> str:
    """An ISO timestamp (``Z``) ``hours`` before now."""
    return (datetime.now(UTC) - timedelta(hours=hours)).isoformat().replace('+00:00', 'Z')


class FakeClock:
    """A monotonic clock the test moves: ``_clock`` reads ``now``; :meth:`ticking` makes calls take time."""

    def __init__(self, now: float = 0.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def ticking(self, seconds: float, *outcomes: Any) -> Callable[..., Any]:
        """A ``side_effect`` that spends ``seconds`` per call, then returns (or raises) the next of ``outcomes``."""
        remaining = list(outcomes)

        def answer(**_request: Any) -> Any:
            self.now += seconds
            outcome = remaining.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        return answer


THROTTLED_QUOTAS = bedrock_error('TooManyRequestsException', 'Rate exceeded', 'ListServiceQuotas')


def expected_quota(tokens: int | None = None, requests: int | None = None, *, complete: bool = True) -> dict[str, Any]:
    """The ``quota`` a model test answers with."""
    return {'tokens_per_minute': tokens, 'requests_per_minute': requests, 'complete': complete}


#: Sonnet 5.5 at 6M tokens/min, and a quota no model test reads.
SONNET_5_5_TOKENS = quota('tokens per minute for Anthropic Claude Sonnet 5.5', 6000000.0, 'L-SONNET55')
UNREAD_QUOTA = quota('tokens per day for Anthropic Claude Opus 4.5', 285713280.0, 'L-OPUS45DAY')

#: The account's quotas in the tests; Opus 5 at 0 tokens/min is the "no capacity" account.
ACCOUNT_QUOTAS = (
    SONNET_5_5_TOKENS,
    quota('tokens per minute for Anthropic Claude Haiku 4.5', 5000000.0),
    quota('requests per minute for Anthropic Claude Haiku 4.5', 10000.0),
    quota('tokens per minute for Anthropic Claude Opus 4.6 V1', 3000000.0),
    quota('tokens per minute for Anthropic Claude Opus 5', 0.0),
    UNREAD_QUOTA,
)
