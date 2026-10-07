"""Tests for POST /api/reports/insights/regenerate: Admin only, a group with keywords, the worker started asynchronously."""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import EndpointConnectionError

from testing.admin_authz_fixtures import caller_event, invoke
from testing.handler_fixtures import handler_fixture

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_PATH = '/api/reports/insights/regenerate'
_WORKER = 'CitationAnalysis-ReportInsights'
_GROUP_KEYWORDS = [{'id': 'k1', 'keyword': 'hotel coruña', 'group_ids': {'group-coruna'}}]

regenerate_module = handler_fixture(
    _API_DIR,
    'regenerate-report-insights.py',
    'regenerate_report_insights_under_test',
    env={'REPORT_INSIGHTS_FUNCTION_NAME': _WORKER, 'DYNAMODB_TABLE_KEYWORDS': 'keywords', 'CORS_ORIGIN_PARAM': ''},
)


@pytest.fixture
def active_keywords() -> list[dict]:
    """The active keywords the group resolves against; one keyword of `group-coruna` unless a test empties it."""
    return list(_GROUP_KEYWORDS)


@pytest.fixture
def lambda_client(regenerate_module, active_keywords):
    """The Lambda client the handler starts the worker with, over `active_keywords`."""
    client = MagicMock()
    client.invoke.return_value = {'StatusCode': 202}
    with (
        patch('shared.keyword_groups.query_active_keywords', return_value=active_keywords),
        patch.object(regenerate_module, 'lambda_client', client),
    ):
        yield client


def _request(body: object, groups: str | None = 'Admin') -> dict:
    return caller_event('POST', _PATH, groups=groups, body=body, resource=_PATH)


class TestAuthorization:
    @pytest.mark.parametrize('groups', ['Users', None], ids=['Users group', 'no group'])
    def test_refuses_a_caller_who_is_not_an_admin(self, regenerate_module, lambda_client, groups: str | None) -> None:
        status, _body = invoke(regenerate_module, _request({'group_id': 'group-coruna'}, groups))

        assert status == 403
        lambda_client.invoke.assert_not_called()


class TestAccepted:
    def test_answers_202_for_an_admin(self, regenerate_module, lambda_client) -> None:
        response = invoke(regenerate_module, _request({'group_id': 'group-coruna'}))

        assert response == (202, {'status': 'accepted', 'group_id': 'group-coruna'})

    def test_starts_the_worker_asynchronously_for_the_group(self, regenerate_module, lambda_client) -> None:
        invoke(regenerate_module, _request({'group_id': 'group-coruna'}))

        assert lambda_client.invoke.call_args.kwargs == {
            'FunctionName': _WORKER,
            'InvocationType': 'Event',
            'Payload': json.dumps({'group_id': 'group-coruna'}).encode(),
        }


class TestRejected:
    @pytest.mark.parametrize('body', [{}, {'group_id': ''}, {'group_id': 'x' * 65}], ids=['missing', 'empty', 'too long'])
    def test_answers_400_without_a_valid_group(self, regenerate_module, lambda_client, body: dict) -> None:
        status, payload = invoke(regenerate_module, _request(body))

        assert (status, payload.get('field')) == (400, 'group_id')
        lambda_client.invoke.assert_not_called()

    def test_answers_400_for_a_group_without_active_keywords(self, regenerate_module, lambda_client, active_keywords) -> None:
        active_keywords.clear()

        status, payload = invoke(regenerate_module, _request({'group_id': 'group-coruna'}))

        assert (status, payload['error']) == (400, 'The group has no active keyword to write a narrative for.')
        lambda_client.invoke.assert_not_called()

    def test_answers_503_when_the_worker_cannot_be_started(self, regenerate_module, lambda_client) -> None:
        lambda_client.invoke.side_effect = EndpointConnectionError(endpoint_url='https://lambda.example')

        status, payload = invoke(regenerate_module, _request({'group_id': 'group-coruna'}))

        assert (status, payload) == (503, {'error': 'Could not start the narrative generation'})
