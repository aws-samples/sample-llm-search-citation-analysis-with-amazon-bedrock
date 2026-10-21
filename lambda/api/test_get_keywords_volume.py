"""
Volume test for ``GET /api/keywords``.

The route answers one Keywords-table scan page (at most 1,000 items and
DynamoDB's 1 MB page) plus a ``next_token``, so its size never grows with the
table. A full page of realistic keywords (accented Spanish text, a market,
twenty group memberships) must still fit one page budget.
"""

import json
import os
from unittest.mock import MagicMock, patch

from testing.env import KEYWORDS_TABLE_ENV
from testing.handler_fixtures import handler_fixture
from testing.response_size import assert_within_page_budget

_API_DIR = os.path.dirname(os.path.abspath(__file__))

get_keywords_module = handler_fixture(
    _API_DIR, 'get-keywords.py', 'get_keywords_volume_under_test', env=KEYWORDS_TABLE_ENV, scope='function',
)


def _heavy_keyword(index: int) -> dict[str, object]:
    return {
        'id': f'5c1d7a52-0f0e-4b8e-9d8c-{index:012d}',
        'keyword': f'mejor hotel con spa en La Coruña para familias número {index}',
        'status': 'active',
        'priority': 'normal',
        'market_id': 'es-es',
        'group_ids': {f'grupo-{group:02d}-galicia' for group in range(20)},
        'created_at': f'2026-10-21T11:45:{index % 60:02d}.000000Z',
        'updated_at': f'2026-10-21T11:45:{index % 60:02d}.000000Z',
    }


def test_stays_within_page_budget_when_a_full_scan_page_holds_heavy_keywords(get_keywords_module):
    table = MagicMock()
    table.scan.return_value = {'Items': [_heavy_keyword(index) for index in range(1_000)], 'LastEvaluatedKey': {'id': 'k'}}

    with patch.object(get_keywords_module, 'keywords_table', table):
        response = get_keywords_module.handler({'httpMethod': 'GET', 'path': '/api/keywords', 'headers': {}}, None)

    assert json.loads(response['body'])['count'] == 1_000
    assert_within_page_budget(response)
