"""
Tests for get-recommendations.py's _annotate_with_status helper — the
left-join from generated recommendations to the status table.

The helper attaches `id` (deterministic hash) and `status` to every
recommendation. When the status table isn't configured, every rec
defaults to status='new'. When a status row exists, the row's
status, notes, etc. override the default.
"""

import importlib
import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Mount shared layer / fall back to lambda/ source tree.
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')
_LAMBDA_DIR = os.path.join(_REPO, 'lambda')
if os.path.isdir(_LAYER_PY) and _LAYER_PY not in sys.path:
    sys.path.insert(0, _LAYER_PY)
elif _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

_layer_api_response = importlib.import_module('shared.api_response')
sys.modules['shared.api_response'] = _layer_api_response

from shared.utils import recommendation_id

_API_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_get_recommendations():
    """Load get-recommendations.py with boto3 patched out at module level."""
    mock_dynamodb = MagicMock()
    mock_dynamodb.Table.return_value = MagicMock()
    mock_bedrock = MagicMock()

    spec = importlib.util.spec_from_file_location(
        'get_recommendations_under_test',
        os.path.join(_API_DIR, 'get-recommendations.py'),
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules['get_recommendations_under_test'] = mod

    with patch.dict(os.environ, {
        'DYNAMODB_TABLE_SEARCH_RESULTS': 't',
        'DYNAMODB_TABLE_CITATIONS': 't',
        'DYNAMODB_TABLE_CRAWLED_CONTENT': 't',
    }):
        with patch('boto3.resource', return_value=mock_dynamodb):
            with patch('boto3.client', return_value=mock_bedrock):
                spec.loader.exec_module(mod)

    return mod


@pytest.fixture
def mod():
    return _load_get_recommendations()


def _make_rec(rec_type='gap', title='Pitch outdoor publishers', keywords=None):
    return {
        'type': rec_type,
        'priority': 'high',
        'title': title,
        'description': 'd',
        'action': 'a',
        'impact': 'i',
        'keywords': keywords or [],
    }


# --- id annotation -------------------------------------------------------


def test_annotate_attaches_deterministic_id_to_each_rec(mod):
    rec = _make_rec()
    expected = recommendation_id(rec)
    recs = [rec]
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop('RECOMMENDATION_STATUS_TABLE', None)
        mod._annotate_with_status(recs)
    assert recs[0]['id'] == expected


def test_annotate_assigns_status_new_when_no_status_table_configured(mod):
    recs = [_make_rec()]
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop('RECOMMENDATION_STATUS_TABLE', None)
        mod._annotate_with_status(recs)
    assert recs[0]['status'] == 'new'


def test_annotate_assigns_distinct_ids_to_recs_with_distinct_titles(mod):
    a = _make_rec(title='A')
    b = _make_rec(title='B')
    recs = [a, b]
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop('RECOMMENDATION_STATUS_TABLE', None)
        mod._annotate_with_status(recs)
    assert recs[0]['id'] != recs[1]['id']


# --- status join (when table configured) ---------------------------------


def test_annotate_joins_status_row_when_table_returns_match(mod):
    rec = _make_rec(title='Pitch X')
    rec_id = recommendation_id(rec)

    fake_status_module = MagicMock()
    fake_status_module.list_statuses.return_value = {
        rec_id: {
            'recommendation_id': rec_id,
            'status': 'in_progress',
            'notes': 'reaching out next week',
            'updated_at': '2026-05-15T10:00:00Z',
        },
    }

    recs = [rec]
    with patch.dict(os.environ, {'RECOMMENDATION_STATUS_TABLE': 'test'}):
        with patch('importlib.util.spec_from_file_location') as fake_spec:
            with patch('importlib.util.module_from_spec', return_value=fake_status_module):
                fake_spec.return_value = MagicMock()
                fake_spec.return_value.loader = MagicMock()
                mod._annotate_with_status(recs)

    assert recs[0]['status'] == 'in_progress'
    assert recs[0]['notes'] == 'reaching out next week'


def test_annotate_falls_back_to_new_status_when_join_lookup_fails(mod):
    rec = _make_rec()
    recs = [rec]
    with patch.dict(os.environ, {'RECOMMENDATION_STATUS_TABLE': 'test'}):
        with patch(
            'importlib.util.spec_from_file_location',
            side_effect=RuntimeError('boom'),
        ):
            mod._annotate_with_status(recs)
    # Even though the env var is set, the broken loader is non-fatal.
    assert recs[0]['status'] == 'new'


def test_annotate_propagates_optional_fields_from_status_row(mod):
    rec = _make_rec(title='Pitch X')
    rec_id = recommendation_id(rec)

    fake_status_module = MagicMock()
    fake_status_module.list_statuses.return_value = {
        rec_id: {
            'recommendation_id': rec_id,
            'status': 'done',
            'completed_at': '2026-05-15T10:00:00Z',
            'related_keyword': 'best running shoes',
            'related_content_id': 'content-42',
        },
    }

    recs = [rec]
    with patch.dict(os.environ, {'RECOMMENDATION_STATUS_TABLE': 'test'}):
        with patch('importlib.util.spec_from_file_location') as fake_spec:
            with patch('importlib.util.module_from_spec', return_value=fake_status_module):
                fake_spec.return_value = MagicMock()
                fake_spec.return_value.loader = MagicMock()
                mod._annotate_with_status(recs)

    assert recs[0]['completed_at'] == '2026-05-15T10:00:00Z'
    assert recs[0]['related_keyword'] == 'best running shoes'
    assert recs[0]['related_content_id'] == 'content-42'


def test_annotate_handles_empty_recommendations_list(mod):
    recs = []
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop('RECOMMENDATION_STATUS_TABLE', None)
        mod._annotate_with_status(recs)
    assert recs == []
