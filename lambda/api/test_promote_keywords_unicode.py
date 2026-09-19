"""Unicode validation tests for keyword promotion requests."""

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from testing.env import KEYWORDS_TABLE_ENV
from testing.handler_fixtures import handler_fixture

_API_DIR = os.path.dirname(os.path.abspath(__file__))

promotion_handler = handler_fixture(
    _API_DIR, 'promote-keywords.py', 'promote_keywords_under_test_unicode', env=KEYWORDS_TABLE_ENV
)


def _invoke(module, table, keyword):
    event = {
        'httpMethod': 'POST',
        'path': '/api/keywords/promote',
        'headers': {},
        'body': json.dumps({'keywords': [{'keyword': keyword}]}),
    }
    with patch.object(module, 'keywords_table', table):
        response = module.handler(event, None)
    return response['statusCode'], json.loads(response['body'])


@pytest.mark.parametrize('keyword', ['\ud800', '\udfff', 'alpha\ud800'])
def test_returns_400_before_dynamodb_when_promoted_keyword_has_unpaired_surrogate(
    promotion_handler, keyword
):
    table = MagicMock()

    status_code, body = _invoke(promotion_handler, table, keyword)

    assert status_code == 400
    assert body['field'] == 'keywords[0].keyword'
    table.scan.assert_not_called()
    table.put_item.assert_not_called()


def test_creates_keyword_when_promoted_text_contains_valid_astral_character(promotion_handler):
    table = MagicMock()
    table.scan.return_value = {'Items': []}

    status_code, body = _invoke(promotion_handler, table, '😀 ALPHA')

    assert status_code == 200
    assert body['created'] == 1
    assert body['created_keywords'][0]['keyword'] == '😀 ALPHA'
    table.put_item.assert_called_once()
