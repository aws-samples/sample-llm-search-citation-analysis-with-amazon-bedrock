"""
Tests for the ParseKeywords Lambda handler.

Covers:
- Keyword parsing from direct input and DynamoDB
- query_prompts pass-through from the execution input
- query_prompts resolution from DynamoDB for scheduled runs
"""

import os
from unittest.mock import MagicMock, patch

import pytest

from testing.module_loader import load_handler_module

_HERE = os.path.dirname(os.path.abspath(__file__))

# Mock DynamoDB tables at module level
mock_keywords_table = MagicMock()
mock_prompts_table = MagicMock()
mock_dynamodb = MagicMock()


def _table_for_name(name):
    if name == 'test-prompts-table':
        return mock_prompts_table
    return mock_keywords_table


mock_dynamodb.Table.side_effect = _table_for_name


def _mock_boto3_resource(*args, **kwargs):
    return mock_dynamodb


def _mock_boto3_client(*args, **kwargs):
    return MagicMock()


_test_env = {
    'KEYWORDS_TABLE': 'test-keywords-table',
    'QUERY_PROMPTS_TABLE': 'test-prompts-table',
}

# Import the handler module. boto3.resource is stubbed while the file executes,
# so the module-level ``dynamodb`` is already ``mock_dynamodb``.
with patch('boto3.resource', side_effect=_mock_boto3_resource):
    with patch('boto3.client', side_effect=_mock_boto3_client):
        with patch.dict(os.environ, _test_env):
            _handler_mod = load_handler_module(_HERE, 'handler.py', 'parse_keywords_handler')


SAMPLE_PROMPT_ITEMS = [
    {'id': 'prompt-1', 'name': 'Family Traveler', 'template': 'As a family, find {keyword}'},
]

EXPECTED_PROMPTS = [
    {'id': 'prompt-1', 'name': 'Family Traveler', 'template': 'As a family, find {keyword}'},
]

# Three active keywords across two groups; the third belongs to both.
GROUPED_KEYWORD_ITEMS = [
    {'id': 'k1', 'keyword': 'hotel coruna spa', 'group_ids': {'coruna'}},
    {'id': 'k2', 'keyword': 'hotel marino beach', 'group_ids': {'marino'}},
    {'id': 'k3', 'keyword': 'best hotels galicia', 'group_ids': {'coruna', 'marino'}},
]


@pytest.fixture(autouse=True)
def _reset_mocks():
    """Reset table mocks before each test."""
    mock_keywords_table.reset_mock()
    mock_prompts_table.reset_mock()
    mock_prompts_table.query.side_effect = None
    mock_keywords_table.query.return_value = {'Items': []}
    mock_prompts_table.query.return_value = {'Items': SAMPLE_PROMPT_ITEMS}


@pytest.fixture
def handler_module():
    """Provide the handler module with mocked DynamoDB."""
    return _handler_mod


class TestKeywordParsing:
    """Keyword extraction from the different input shapes."""

    def test_parses_direct_keyword_array(self, handler_module):
        """A direct keywords array is normalized into keyword/timestamp pairs."""
        result = handler_module.handler({'keywords': ['best hotels', 'top resorts'], 'query_prompts': []}, {})
        parsed = [item['keyword'] for item in result['keywords']]
        assert parsed == ['best hotels', 'top resorts']

    def test_reads_active_keywords_from_dynamodb_for_scheduled_runs(self, handler_module):
        """source=dynamodb loads the active keywords from the Keywords table."""
        mock_keywords_table.query.return_value = {
            'Items': [{'keyword': 'best hotels malaga'}, {'keyword': 'boutique madrid'}]
        }
        result = handler_module.handler({'source': 'dynamodb'}, {})
        parsed = [item['keyword'] for item in result['keywords']]
        assert parsed == ['best hotels malaga', 'boutique madrid']

    def test_raises_when_no_valid_keywords_found(self, handler_module):
        """Empty keyword input raises instead of starting an empty run."""
        with pytest.raises(ValueError, match='No valid keywords'):
            handler_module.handler({'keywords': ['', '   ']}, {})


class TestQueryPromptResolution:
    """query_prompts output for the ProcessKeywords Map state."""

    def test_passes_through_query_prompts_from_execution_input(self, handler_module):
        """Prompts provided by trigger APIs are forwarded unchanged."""
        prompts = [{'id': 'p1', 'name': 'Custom', 'template': 'Find {keyword}'}]
        result = handler_module.handler({'keywords': ['best hotels'], 'query_prompts': prompts}, {})
        assert result['query_prompts'] == prompts
        mock_prompts_table.query.assert_not_called()

    def test_passes_through_empty_prompt_list_without_loading(self, handler_module):
        """An explicit empty prompt list is respected, not replaced."""
        result = handler_module.handler({'keywords': ['best hotels'], 'query_prompts': []}, {})
        assert result['query_prompts'] == []
        mock_prompts_table.query.assert_not_called()

    def test_loads_enabled_prompts_when_input_has_none(self, handler_module):
        """Scheduled runs (no prompts in input) resolve enabled prompts from DynamoDB."""
        mock_keywords_table.query.return_value = {'Items': [{'keyword': 'best hotels'}]}
        result = handler_module.handler({'source': 'dynamodb'}, {})
        assert result['query_prompts'] == EXPECTED_PROMPTS

    def test_loads_enabled_prompts_for_keyword_subset_schedules(self, handler_module):
        """Keyword-linked schedules ({"keywords": [...]}) also resolve prompts."""
        result = handler_module.handler({'keywords': ['best hotels malaga']}, {})
        assert result['query_prompts'] == EXPECTED_PROMPTS

    def test_returns_empty_prompts_when_no_prompts_are_enabled(self, handler_module):
        """
        A genuinely empty table is a legitimate configuration, not a failure —
        it must stay distinguishable from the error cases below.
        """
        mock_prompts_table.query.return_value = {'Items': []}

        result = handler_module.handler({'keywords': ['best hotels']}, {})

        assert result['query_prompts'] == []


class TestQueryPromptReadFailsClosed:
    """
    REGRESSION (AUDIT-2026-08-19 §2.12).

    `read_enabled_query_prompts` returned `[]` on any exception, and it is the
    sole prompt source for schedule-triggered runs. So a transient DynamoDB
    throttle made the entire nightly run execute with **zero personas**,
    complete, write rows and report success — leaving a hole in the time series
    indistinguishable from "no personas were configured then". Logged at
    WARNING and invisible otherwise.

    The test this replaces asserted the old behavior as intended
    ("degrades to an empty list instead of failing the run"), which is why the
    bug survived: the contract was documented rather than questioned. A failed
    run is recoverable; silently wrong data is not.
    """

    @staticmethod
    def _client_error(code: str):
        from botocore.exceptions import ClientError
        return ClientError({'Error': {'Code': code, 'Message': code}}, 'Query')

    def test_raises_when_the_prompt_read_throttles(self, handler_module):
        """The case from the audit: transient failure must not look like success."""
        mock_prompts_table.query.side_effect = self._client_error('ThrottlingException')

        with pytest.raises(handler_module.QueryPromptReadError):
            handler_module.handler({'keywords': ['best hotels']}, {})

    def test_raises_on_provisioned_throughput_exceeded(self, handler_module):
        mock_prompts_table.query.side_effect = self._client_error(
            'ProvisionedThroughputExceededException'
        )

        with pytest.raises(handler_module.QueryPromptReadError):
            handler_module.handler({'keywords': ['best hotels']}, {})

    def test_raises_on_an_unexpected_error(self, handler_module):
        mock_prompts_table.query.side_effect = RuntimeError('table unavailable')

        with pytest.raises(handler_module.QueryPromptReadError):
            handler_module.handler({'keywords': ['best hotels']}, {})

    def test_returns_empty_prompts_when_the_table_does_not_exist(self, handler_module):
        """
        A missing table or index means the persona feature is not provisioned
        in this deployment — a configuration state, not a failure. Failing here
        would break bootstrap deploys, so this case stays fail-open on purpose.
        """
        mock_prompts_table.query.side_effect = self._client_error('ResourceNotFoundException')

        result = handler_module.handler({'keywords': ['best hotels']}, {})

        assert result['query_prompts'] == []

    def test_does_not_read_prompts_at_all_when_the_input_supplies_them(self, handler_module):
        """
        Trigger-API runs pass prompts in the execution input, so a broken
        prompts table must not fail them — only schedule-driven runs read it.
        """
        mock_prompts_table.query.side_effect = self._client_error('ThrottlingException')
        prompts = [{'id': 'p1', 'name': 'Custom', 'template': 'Find {keyword}'}]

        result = handler_module.handler(
            {'keywords': ['best hotels'], 'query_prompts': prompts}, {}
        )

        assert result['query_prompts'] == prompts



class TestScopeResolution:
    """Group-aware execution input: {"scope": {...}} resolved at run time."""

    def test_resolves_a_group_scope_to_the_active_members_of_that_group(self, handler_module):
        mock_keywords_table.query.return_value = {'Items': GROUPED_KEYWORD_ITEMS}

        result = handler_module.handler({'scope': {'mode': 'groups', 'group_ids': ['coruna']}, 'query_prompts': []}, {})

        assert [item['keyword'] for item in result['keywords']] == ['best hotels galicia', 'hotel coruna spa']

    def test_resolves_a_keyword_id_scope(self, handler_module):
        mock_keywords_table.query.return_value = {'Items': [
            {'id': 'k1', 'keyword': 'alpha'},
            {'id': 'k2', 'keyword': 'beta'},
        ]}

        result = handler_module.handler({'scope': {'mode': 'keywords', 'keyword_ids': ['k2']}, 'query_prompts': []}, {})

        assert [item['keyword'] for item in result['keywords']] == ['beta']

    def test_raises_a_clear_error_for_an_invalid_scope(self, handler_module):
        with pytest.raises(ValueError, match=r'Invalid scope: scope\.mode must be one of'):
            handler_module.handler({'scope': {'mode': 'bogus'}}, {})

    def test_raises_when_the_scope_matches_no_active_keyword(self, handler_module):
        mock_keywords_table.query.return_value = {'Items': [{'id': 'k1', 'keyword': 'alpha', 'group_ids': {'other'}}]}

        with pytest.raises(ValueError, match='No valid keywords'):
            handler_module.handler({'scope': {'mode': 'groups', 'group_ids': ['coruna']}}, {})

    def test_accepts_the_full_v2_schedule_descriptor_as_execution_input(self, handler_module):
        """EventBridge sends the whole descriptor; only `scope` matters here."""
        mock_keywords_table.query.return_value = {'Items': GROUPED_KEYWORD_ITEMS}
        descriptor = {
            'schedule_id': 'sch-1a2b3c4d',
            'display_name': 'Hotel Coruña — weekly',
            'form': {'frequency': 'weekly', 'time': '09:00', 'timezone': 'Europe/Madrid', 'day_of_week': 'MON', 'day_of_month': 1},
            'scope': {'mode': 'groups', 'group_ids': ['marino']},
            'query_prompts': [],
        }

        result = handler_module.handler(descriptor, {})

        assert [item['keyword'] for item in result['keywords']] == ['best hotels galicia', 'hotel marino beach']


class TestNoKeywordCap:
    """Executions are no longer silently truncated to 100 keywords."""

    def test_keeps_every_keyword_when_more_than_100_are_supplied(self, handler_module):
        keywords = [f'keyword {index:03d}' for index in range(180)]

        result = handler_module.handler({'keywords': keywords, 'query_prompts': []}, {})

        assert len(result['keywords']) == 180
        assert result['keywords'][-1]['keyword'] == 'keyword 179'

    def test_reads_every_page_of_the_status_index_for_scheduled_runs(self, handler_module):
        first_page = {'Items': [{'id': f'k{i}', 'keyword': f'kw {i:03d}'} for i in range(100)], 'LastEvaluatedKey': {'id': 'k99'}}
        second_page = {'Items': [{'id': f'k{i}', 'keyword': f'kw {i:03d}'} for i in range(100, 150)]}
        mock_keywords_table.query.side_effect = [first_page, second_page]

        result = handler_module.handler({'source': 'dynamodb', 'query_prompts': []}, {})

        assert len(result['keywords']) == 150
        mock_keywords_table.query.side_effect = None
