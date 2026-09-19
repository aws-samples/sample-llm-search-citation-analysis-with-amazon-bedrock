"""Unicode validation tests for keyword promotion requests."""

from unittest.mock import MagicMock, patch

import pytest

from testing.events import api_gateway_event, parse_response
from testing.promotion_fixtures import promotion_handler_fixture

promotion_handler = promotion_handler_fixture('promote_keywords_under_test_unicode')

# Lone UTF-16 surrogates, which no UTF-8 encoder (DynamoDB's included) accepts.
HIGH_SURROGATE = chr(0xD800)
LOW_SURROGATE = chr(0xDFFF)


def _invoke(module, table, keyword):
    event = api_gateway_event('POST', '/api/keywords/promote', body={'keywords': [{'keyword': keyword}]})
    with patch.object(module, 'keywords_table', table):
        response = module.handler(event, None)
    return parse_response(response)


@pytest.mark.parametrize(
    'keyword',
    [HIGH_SURROGATE, LOW_SURROGATE, f'alpha{HIGH_SURROGATE}'],
    ids=['high-surrogate', 'low-surrogate', 'surrogate-after-text'],
)
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
