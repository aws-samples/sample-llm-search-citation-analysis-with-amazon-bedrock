"""Loading and stubs shared by the suites of handlers that read the keyword-groups table.

``manage-keyword-groups.py``, ``manage-keywords.py`` and ``promote-keywords.py``
open the Keywords table and the KeywordGroups table at import time. Each suite
keeps one module-level ``MagicMock`` per table and loads its handler against
them with :func:`load_with_groups_table`.
"""

from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

from testing.dynamodb_stubs import fake_dynamodb_resource, reset_tables
from testing.env import KEYWORDS_TABLE_ENV
from testing.module_loader import load_handler_module

_API_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api')

GROUPS_TABLE_NAME = 'test-keyword-groups'

# The Cognito claims the authorizer attaches for a signed-in user.
SIGNED_IN_CLAIMS: Mapping[str, str] = {'cognito:username': 'user@example.com'}


def load_with_groups_table(filename: str, module_name: str, keywords_table: MagicMock, groups_table: MagicMock) -> ModuleType:
    """Load ``filename`` as ``module_name`` with its groups table bound to ``groups_table``.

    Every other table the handler opens is ``keywords_table``; the table env
    vars are only in place while the file executes.
    """
    resource = fake_dynamodb_resource(keywords_table, by_name={GROUPS_TABLE_NAME: groups_table})
    with patch('boto3.resource', return_value=resource), patch.dict(os.environ, {
        **KEYWORDS_TABLE_ENV,
        'DYNAMODB_TABLE_KEYWORD_GROUPS': GROUPS_TABLE_NAME,
        'CORS_ORIGIN_PARAM': '',
    }):
        return load_handler_module(_API_DIR, filename, module_name)


def reset_with_no_keywords(keywords_table: MagicMock, groups_table: MagicMock) -> None:
    """Forget both stubs' calls and configuration; then the keywords scan finds nothing and puts succeed."""
    reset_tables(keywords_table, groups_table)
    keywords_table.scan.return_value = {'Items': []}
    keywords_table.put_item.return_value = {}


def membership_update(keyword_id: str, group_ids: Iterable[str], operation: str, return_values: str) -> dict[str, Any]:
    """The ``update_item`` keyword arguments of one conditional ``ADD``/``DELETE group_ids`` write."""
    return {
        'Key': {'id': keyword_id},
        'UpdateExpression': f'{operation} group_ids :gids',
        'ConditionExpression': 'attribute_exists(#id)',
        'ExpressionAttributeNames': {'#id': 'id'},
        'ExpressionAttributeValues': {':gids': set(group_ids)},
        'ReturnValues': return_values,
    }
