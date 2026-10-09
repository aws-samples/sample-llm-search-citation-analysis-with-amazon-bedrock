"""The optional request-level ``market_id`` of ``POST /api/keywords/promote``.

Promoted research keywords take the market of the request, with the rules of
``manage-keywords``: ``''``, ``null``, ``'global'`` or no field is the global
market (no attribute is stored), any other id must be a configured market
(BrandConfig item ``markets``), and a refusal is a 400 on ``market_id`` before
the Keywords table is read. Keywords already stored are never re-marketed.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.dynamodb_stubs import fake_table
from testing.keyword_groups_fixtures import load_with_groups_table, reset_with_no_keywords
from testing.keyword_promotion_fixtures import assert_rejected_before_dynamodb, invoke_promotion
from testing.markets_fixtures import BRAZIL, CHILE, markets_item

stored_keywords = MagicMock()
known_groups = MagicMock()
_mod = load_with_groups_table('promote-keywords.py', 'promote_keywords_with_markets', stored_keywords, known_groups)

_CHILE_ID = CHILE['market_id']
_KEYWORDS = [{'keyword': 'vuelos baratos altiplano air'}, {'keyword': 'altiplano air equipaje de mano'}]


@pytest.fixture(autouse=True)
def _empty_tables():
    """No keyword is stored yet; the one destination group the tests name exists."""
    reset_with_no_keywords(stored_keywords, known_groups)
    known_groups.get_item.return_value = {'Item': {'id': 'group-sao-paulo'}}


@pytest.fixture
def market_list() -> Iterator[MagicMock]:
    """The BrandConfig table holding the Chile and Brazil markets, bound to the handler for the test."""
    table = fake_table(get_item={'Item': markets_item(CHILE, BRAZIL)})
    with patch.object(_mod, 'brand_config_table', table):
        yield table


def _promote(**fields: Any) -> tuple[int, Any]:
    return invoke_promotion(_mod, stored_keywords, {'keywords': _KEYWORDS, **fields})


def _written_markets() -> list[Any]:
    """The ``market_id`` of every item ``put_item`` wrote (``None`` = no attribute), in write order."""
    return [call.kwargs['Item'].get('market_id') for call in stored_keywords.put_item.call_args_list]


class TestMarketOfPromotedKeywords:
    def test_stores_the_market_on_every_created_keyword(self, market_list):
        status, _body = _promote(market_id=_CHILE_ID)

        assert (status, _written_markets()) == (200, [_CHILE_ID, _CHILE_ID])

    def test_returns_the_market_on_every_created_keyword(self, market_list):
        _status, body = _promote(market_id=_CHILE_ID)

        assert [item['market_id'] for item in body['created_keywords']] == [_CHILE_ID, _CHILE_ID]

    def test_trims_the_market_id(self, market_list):
        _promote(market_id=f'  {_CHILE_ID} ')

        assert _written_markets() == [_CHILE_ID, _CHILE_ID]

    def test_stores_the_market_on_keywords_created_into_groups(self, market_list):
        _promote(market_id=BRAZIL['market_id'], group_ids=['group-sao-paulo'])

        items = [call.kwargs['Item'] for call in stored_keywords.put_item.call_args_list]
        assert [(item['market_id'], item['group_ids']) for item in items] == [(BRAZIL['market_id'], {'group-sao-paulo'})] * 2

    def test_checks_the_market_against_the_configured_markets(self, market_list):
        _promote(market_id=_CHILE_ID)

        market_list.get_item.assert_called_once_with(Key={'config_id': 'markets'})

    def test_leaves_an_already_stored_keyword_in_its_market(self, market_list):
        stored_keywords.scan.return_value = {'Items': [{'id': 'kw-stored', 'keyword': 'vuelos baratos altiplano air'}]}

        _status, body = _promote(market_id=_CHILE_ID)

        assert (body['skipped_keywords'], _written_markets()) == (
            [{'keyword': 'vuelos baratos altiplano air', 'reason': 'duplicate'}], [_CHILE_ID],
        )
        stored_keywords.update_item.assert_not_called()


class TestGlobalMarket:
    @pytest.mark.parametrize('fields', [{}, {'market_id': None}, {'market_id': ''}, {'market_id': '  '}, {'market_id': 'global'}],
                             ids=['absent', 'null', 'empty', 'blank', 'global'])
    def test_stores_no_market_for_the_global_market(self, market_list, fields):
        status, body = _promote(**fields)

        assert (status, _written_markets()) == (200, [None, None])
        assert ['market_id' in item for item in body['created_keywords']] == [False, False]

    @pytest.mark.parametrize('market_id', [None, '', 'global'], ids=['null', 'empty', 'global'])
    def test_does_not_read_the_market_list_for_the_global_market(self, market_list, market_id):
        _promote(market_id=market_id)

        market_list.get_item.assert_not_called()


class TestMarketRejection:
    def test_rejects_an_unknown_market_with_400_before_reading_the_keywords(self, market_list):
        status, body = _promote(market_id='fr-fr')

        assert (status, body) == (400, {'error': 'Unknown market_id: fr-fr', 'field': 'market_id'})
        assert_rejected_before_dynamodb(stored_keywords)

    @pytest.mark.parametrize('market_id', [7, ['cl-es'], {'id': 'cl-es'}, True], ids=['number', 'list', 'object', 'boolean'])
    def test_rejects_a_market_id_that_is_not_a_string(self, market_list, market_id):
        status, body = _promote(market_id=market_id)

        assert (status, body) == (400, {'error': 'market_id must be a string', 'field': 'market_id'})
        market_list.get_item.assert_not_called()

    def test_reports_an_invalid_keyword_list_before_the_market(self, market_list):
        status, body = invoke_promotion(_mod, stored_keywords, {'keywords': [], 'market_id': 'fr-fr'})

        assert (status, body['field']) == (400, 'keywords')
        market_list.get_item.assert_not_called()

    def test_rejects_every_market_while_none_is_configured(self):
        with patch.object(_mod, 'brand_config_table', fake_table(get_item={})):
            status, body = _promote(market_id=_CHILE_ID)

        assert (status, body) == (400, {'error': f'Unknown market_id: {_CHILE_ID}', 'field': 'market_id'})
