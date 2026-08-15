"""Unicode validation tests for keyword promotion requests."""

import importlib
import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.abspath(os.path.join(_API_DIR, '..'))
_MODULE_NAME = 'promote_keywords_under_test_unicode'
_TABLE_ENV_VARS = ('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
_TEST_TABLE_NAME = 'test-keywords-table'


def _load_handler():
    if _LAMBDA_DIR not in sys.path:
        sys.path.insert(0, _LAMBDA_DIR)
    sys.modules['shared.api_response'] = importlib.import_module('shared.api_response')
    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_API_DIR, 'promote-keywords.py')
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope='module')
def promotion_handler():
    saved = {name: os.environ.get(name) for name in _TABLE_ENV_VARS}
    for name in _TABLE_ENV_VARS:
        os.environ[name] = _TEST_TABLE_NAME

    with patch('boto3.resource', MagicMock()):
        yield _load_handler()

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    sys.modules.pop(_MODULE_NAME, None)


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
