"""The ``market_id`` and ``concept_id`` references of manual keyword management (2.37.0)."""

import os
from unittest.mock import MagicMock, patch

import pytest

from shared.utils import keyword_id
from testing.dynamodb_stubs import fake_table
from testing.env import KEYWORDS_TABLE_ENV
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.markets_fixtures import BRAZIL, CHILE, markets_item

manage_module = handler_fixture(
    os.path.dirname(os.path.abspath(__file__)), 'manage-keywords.py', 'manage_keywords_under_test_markets',
    env=KEYWORDS_TABLE_ENV, scope='function',
)

SOURCE = {'id': 'source-id', 'keyword': 'cheap flights santiago', 'status': 'active'}
TRANSLATION = {'id': 'translation-id', 'keyword': 'vuelos baratos santiago', 'status': 'active',
               'market_id': 'cl-es', 'concept_id': 'source-id'}
STORED = {'id': 'stored-id', 'keyword': 'passagens baratas', 'status': 'active', 'market_id': 'br-pt', 'concept_id': 'source-id'}


def _keywords_table() -> MagicMock:
    """No stored keyword identities; ``get_item`` finds the rows above by id."""
    table = fake_table(scan={'Items': []})
    rows = {row['id']: row for row in (SOURCE, TRANSLATION, STORED)}
    table.get_item.side_effect = lambda Key, **_kwargs: {'Item': rows[Key['id']]} if Key['id'] in rows else {}
    table.update_item.return_value = {'Attributes': {**STORED}}
    return table


@pytest.fixture
def tables():
    return _keywords_table(), fake_table(get_item={'Item': markets_item(CHILE, BRAZIL)})


def _send(module, tables, method, body, item_id=None):
    keywords, brand_config = tables
    event = api_gateway_event(
        method,
        '/api/keywords' if item_id is None else f'/api/keywords/{item_id}',
        body=body,
        path_params={} if item_id is None else {'id': item_id},
        headers={},
    )
    with patch.object(module, 'keywords_table', keywords), patch.object(module, 'brand_config_table', brand_config):
        return parse_response(module.handler(event, None))


def _written(tables):
    return tables[0].put_item.call_args.kwargs['Item']


def _update(tables):
    return tables[0].update_item.call_args.kwargs


class TestCreateWithMarket:
    def test_stores_a_configured_market(self, manage_module, tables):
        status, body = _send(manage_module, tables, 'POST', {'keyword': 'vuelos a lima', 'market_id': 'cl-es'})

        assert (status, body['market_id'], _written(tables)['market_id']) == (201, 'cl-es', 'cl-es')

    @pytest.mark.parametrize('market_id', ['', None, 'global'], ids=['empty', 'null', 'global'])
    def test_stores_no_market_for_the_global_market(self, manage_module, tables, market_id):
        status, _body = _send(manage_module, tables, 'POST', {'keyword': 'flights to lima', 'market_id': market_id})

        assert status == 201
        assert 'market_id' not in _written(tables)

    def test_does_not_read_the_markets_without_a_market(self, manage_module, tables):
        _send(manage_module, tables, 'POST', {'keyword': 'flights to lima'})

        tables[1].get_item.assert_not_called()

    def test_rejects_an_unknown_market_before_writing(self, manage_module, tables):
        response = _send(manage_module, tables, 'POST', {'keyword': 'vols pour lima', 'market_id': 'fr-fr'})

        assert response == (400, {'error': 'Unknown market_id: fr-fr', 'field': 'market_id'})
        tables[0].put_item.assert_not_called()

    def test_rejects_a_non_string_market(self, manage_module, tables):
        response = _send(manage_module, tables, 'POST', {'keyword': 'vuelos a lima', 'market_id': 7})

        assert response == (400, {'error': 'market_id must be a string', 'field': 'market_id'})


class TestCreateWithConcept:
    def test_stores_the_source_keyword_as_the_concept(self, manage_module, tables):
        status, body = _send(manage_module, tables, 'POST',
                             {'keyword': 'voos baratos santiago', 'market_id': 'br-pt', 'concept_id': 'source-id'})

        assert (status, body['concept_id']) == (201, 'source-id')

    def test_resolves_a_translation_to_the_concept_it_localizes(self, manage_module, tables):
        _send(manage_module, tables, 'POST', {'keyword': 'voos baratos santiago', 'concept_id': 'translation-id'})

        assert _written(tables)['concept_id'] == 'source-id'

    def test_rejects_an_unknown_concept(self, manage_module, tables):
        response = _send(manage_module, tables, 'POST', {'keyword': 'voos baratos', 'concept_id': 'ghost'})

        assert response == (400, {'error': 'Unknown concept_id: ghost', 'field': 'concept_id'})

    def test_rejects_an_over_long_concept(self, manage_module, tables):
        response = _send(manage_module, tables, 'POST', {'keyword': 'voos baratos', 'concept_id': 'x' * 65})

        assert response == (400, {'error': 'concept_id must be at most 64 characters', 'field': 'concept_id'})

    def test_stores_no_concept_when_omitted(self, manage_module, tables):
        _send(manage_module, tables, 'POST', {'keyword': 'voos baratos'})

        assert 'concept_id' not in _written(tables)

    def test_stores_the_deterministic_id_with_the_references(self, manage_module, tables):
        _send(manage_module, tables, 'POST', {'keyword': 'voos baratos', 'concept_id': 'source-id'})

        assert _written(tables)['id'] == keyword_id('voos baratos')


class TestUpdateReferences:
    def test_sets_a_new_market(self, manage_module, tables):
        status, _body = _send(manage_module, tables, 'PUT', {'keyword': 'passagens baratas', 'market_id': 'cl-es'}, 'stored-id')

        assert status == 200
        assert _update(tables)['ExpressionAttributeValues'][':market_id'] == 'cl-es'

    def test_removes_the_market_for_an_empty_value(self, manage_module, tables):
        _send(manage_module, tables, 'PUT', {'keyword': 'passagens baratas', 'market_id': ''}, 'stored-id')

        assert _update(tables)['UpdateExpression'].endswith(' REMOVE market_id')

    def test_leaves_the_references_alone_when_omitted(self, manage_module, tables):
        _send(manage_module, tables, 'PUT', {'keyword': 'passagens baratas'}, 'stored-id')

        assert _update(tables)['UpdateExpression'] == 'SET #kw = :k, updated_at = :u'

    def test_removes_the_concept_and_the_groups_in_one_remove_clause(self, manage_module, tables):
        _send(manage_module, tables, 'PUT', {'keyword': 'passagens baratas', 'concept_id': None, 'group_ids': []}, 'stored-id')

        assert _update(tables)['UpdateExpression'] == 'SET #kw = :k, updated_at = :u REMOVE concept_id, group_ids'

    def test_refuses_a_keyword_localizing_itself(self, manage_module, tables):
        response = _send(manage_module, tables, 'PUT', {'keyword': 'cheap flights santiago', 'concept_id': 'source-id'}, 'source-id')

        assert response == (400, {'error': 'A keyword cannot localize itself', 'field': 'concept_id'})
        tables[0].update_item.assert_not_called()

    def test_refuses_an_unknown_market_without_writing(self, manage_module, tables):
        response = _send(manage_module, tables, 'PUT', {'keyword': 'passagens baratas', 'market_id': 'fr-fr'}, 'stored-id')

        assert response == (400, {'error': 'Unknown market_id: fr-fr', 'field': 'market_id'})
        tables[0].update_item.assert_not_called()

    def test_returns_the_stored_references(self, manage_module, tables):
        _status, body = _send(manage_module, tables, 'PUT', {'keyword': 'passagens baratas'}, 'stored-id')

        assert (body['market_id'], body['concept_id']) == ('br-pt', 'source-id')
