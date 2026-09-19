"""
Tests for get-recommendations.py's _annotate_with_status helper — the
left-join from generated recommendations to the status table.

The helper attaches `id` (deterministic hash) and `status` to every
recommendation. When the status table isn't configured, every rec
defaults to status='new'. When a status row exists, the row's
status, notes, etc. override the default.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

from shared.utils import recommendation_id
from testing.env import cleared_env
from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture
def mod():
    """get-recommendations.py with boto3 patched out at module level."""
    with (
        patch.dict(os.environ, {
            'DYNAMODB_TABLE_SEARCH_RESULTS': 't',
            'DYNAMODB_TABLE_CITATIONS': 't',
            'DYNAMODB_TABLE_CRAWLED_CONTENT': 't',
        }),
        patch('boto3.resource', return_value=MagicMock()),
        patch('boto3.client', return_value=MagicMock()),
    ):
        return load_handler_module(_API_DIR, 'get-recommendations.py')


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


def _annotate_without_status_table(mod, recs):
    """Run the join with no status table configured."""
    with cleared_env('RECOMMENDATION_STATUS_TABLE'):
        mod._annotate_with_status(recs)


def _annotate_with_status_rows(mod, recs, rows_by_id):
    """Run the join against a status module whose `list_statuses` answers `rows_by_id`.

    `_annotate_with_status` loads `recommendation-status.py` through importlib;
    the loader is intercepted so the fake module is what it gets back.
    """
    fake_status_module = MagicMock()
    fake_status_module.list_statuses.return_value = rows_by_id
    fake_spec = MagicMock()
    fake_spec.loader = MagicMock()
    with (
        patch.dict(os.environ, {'RECOMMENDATION_STATUS_TABLE': 'test'}),
        patch('importlib.util.spec_from_file_location', return_value=fake_spec),
        patch('importlib.util.module_from_spec', return_value=fake_status_module),
    ):
        mod._annotate_with_status(recs)


# --- id annotation -------------------------------------------------------


def test_annotate_attaches_deterministic_id_to_each_rec(mod):
    rec = _make_rec()
    expected = recommendation_id(rec)
    recs = [rec]
    _annotate_without_status_table(mod, recs)
    assert recs[0]['id'] == expected


def test_annotate_assigns_status_new_when_no_status_table_configured(mod):
    recs = [_make_rec()]
    _annotate_without_status_table(mod, recs)
    assert recs[0]['status'] == 'new'


def test_annotate_assigns_distinct_ids_to_recs_with_distinct_titles(mod):
    a = _make_rec(title='A')
    b = _make_rec(title='B')
    recs = [a, b]
    _annotate_without_status_table(mod, recs)
    assert recs[0]['id'] != recs[1]['id']


# --- status join (when table configured) ---------------------------------


def test_annotate_joins_status_row_when_table_returns_match(mod):
    rec = _make_rec(title='Pitch X')
    rec_id = recommendation_id(rec)
    recs = [rec]

    _annotate_with_status_rows(mod, recs, {
        rec_id: {
            'recommendation_id': rec_id,
            'status': 'in_progress',
            'notes': 'reaching out next week',
            'updated_at': '2026-05-15T10:00:00Z',
        },
    })

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
    recs = [rec]

    _annotate_with_status_rows(mod, recs, {
        rec_id: {
            'recommendation_id': rec_id,
            'status': 'done',
            'completed_at': '2026-05-15T10:00:00Z',
            'related_keyword': 'best running shoes',
            'related_content_id': 'content-42',
        },
    })

    assert recs[0]['completed_at'] == '2026-05-15T10:00:00Z'
    assert recs[0]['related_keyword'] == 'best running shoes'
    assert recs[0]['related_content_id'] == 'content-42'


def test_annotate_handles_empty_recommendations_list(mod):
    recs = []
    _annotate_without_status_table(mod, recs)
    assert recs == []
