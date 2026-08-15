"""
Tests for the ParseKeywords Lambda handler.

Covers:
- Keyword parsing from direct input and DynamoDB
- query_prompts pass-through from the execution input
- query_prompts resolution from DynamoDB for scheduled runs
"""

import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Make `from shared.xxx import` resolve (layer puts shared/ at /opt/python/shared/)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))  # lambda/

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


# Import the handler module
_handler_spec = importlib.util.spec_from_file_location(
    'parse_keywords_handler',
    os.path.join(os.path.dirname(__file__), 'handler.py')
)
_handler_mod = importlib.util.module_from_spec(_handler_spec)

_test_env = {
    'KEYWORDS_TABLE': 'test-keywords-table',
    'QUERY_PROMPTS_TABLE': 'test-prompts-table',
}

with patch('boto3.resource', side_effect=_mock_boto3_resource):
    with patch('boto3.client', side_effect=_mock_boto3_client):
        with patch.dict(os.environ, _test_env):
            _handler_spec.loader.exec_module(_handler_mod)

_handler_mod.dynamodb = mock_dynamodb


SAMPLE_PROMPT_ITEMS = [
    {'id': 'prompt-1', 'name': 'Family Traveler', 'template': 'As a family, find {keyword}'},
]

EXPECTED_PROMPTS = [
    {'id': 'prompt-1', 'name': 'Family Traveler', 'template': 'As a family, find {keyword}'},
]


@pytest.fixture(autouse=True)
def _reset_mocks():
    """Reset table mocks before each test."""
    mock_keywords_table.reset_mock()
    mock_prompts_table.reset_mock()
    mock_prompts_table.query.side_effect = None
    mock_keywords_table.query.return_value = {'Items': []}
    mock_prompts_table.query.return_value = {'Items': SAMPLE_PROMPT_ITEMS}


@pytest.fixture()
def handler_module():
    """Provide the handler module with mocked DynamoDB."""
    _handler_mod.dynamodb = mock_dynamodb
    yield _handler_mod


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

    def test_returns_empty_prompts_when_prompt_table_query_fails(self, handler_module):
        """A prompt lookup failure degrades to an empty list instead of failing the run."""
        mock_prompts_table.query.side_effect = RuntimeError('table unavailable')
        result = handler_module.handler({'keywords': ['best hotels']}, {})
        assert result['query_prompts'] == []
