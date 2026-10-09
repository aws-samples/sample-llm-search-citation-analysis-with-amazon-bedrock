"""Content Studio group briefs with a market-filtered scope (``scope.market_ids``).

``POST /content-studio/generate-batch`` takes ``market_ids`` like every run
scope: the brief is resolved to the selected markets' keywords only, the
manifest's canonical brief and every child keep the filter, and because the
request fingerprint covers it, the same ``batch_id`` cannot be replayed with
another market list. ``POST /content-studio/generate`` keeps it the same way.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.content_brief_fixtures import (
    active_keyword,
    build_batch_request,
    build_scoped_content_brief,
    keyword_scope,
)
from testing.content_studio_fixtures import (
    content_generation_event,
    content_studio_resource,
    load_content_studio_module,
    stateful_batch_table,
    stateful_content_table,
)
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response
from testing.markets_fixtures import BRAZIL, CHILE

_mod = load_content_studio_module('content_studio_batch_markets_under_test')

_CHILE_ID = CHILE['market_id']
_KEYWORDS = [
    active_keyword('keyword-1', 'vuelos santiago altiplano air', market_id=_CHILE_ID),
    active_keyword('keyword-2', 'altiplano air equipaje', market_id=_CHILE_ID),
    active_keyword('keyword-3', 'voos altiplano air sao paulo', market_id=BRAZIL['market_id']),
]
"""Two Chilean keywords and one Brazilian keyword."""

_IN_CHILE = {'market_ids': [_CHILE_ID]}
_FIRST_IN_CHILE = keyword_scope('keyword-1', **_IN_CHILE)
_BOTH_IN_CHILE = keyword_scope('keyword-1', 'keyword-2', **_IN_CHILE)


@dataclass
class _Store:
    """Durable content rows and batch manifests that repeated submissions share."""

    content: tuple[MagicMock, dict[str, dict[str, Any]]] = field(default_factory=stateful_content_table)
    batches: tuple[MagicMock, dict[str, dict[str, Any]]] = field(default_factory=stateful_batch_table)

    def submit(self, scope: dict[str, object]) -> tuple[int, dict[str, Any]]:
        """Submit the default batch with ``scope`` over ``_KEYWORDS``."""
        tables = content_studio_resource(content_table=self.content[0], keyword_items=_KEYWORDS, batch_table=self.batches[0])
        event = api_gateway_event('POST', '/content-studio/generate-batch', body=build_batch_request(scope=scope))
        with patch.object(_mod, 'dynamodb', tables):
            return parse_response(_mod._api_handler(event, None))

    @property
    def manifest(self) -> dict[str, Any]:
        return self.batches[1]['batch-1']

    def child_scopes(self) -> list[object]:
        """The scope of every queued child brief, in batch order."""
        rows = sorted(self.content[1].values(), key=lambda row: row['batch_position'])
        return [row['idea_data']['scope'] for row in rows]


@pytest.fixture
def submitted() -> _Store:
    """A store that already accepted the default batch of the first Chilean keyword."""
    store = _Store()
    store.submit(_FIRST_IN_CHILE)
    return store


class TestMarketFilteredBatch:
    def test_queues_one_child_per_selected_keyword_of_the_market(self) -> None:
        status, body = _Store().submit(_BOTH_IN_CHILE)

        assert (status, [child['keyword_id'] for child in body['children']]) == (202, ['keyword-2', 'keyword-1'])

    def test_keeps_the_markets_in_the_manifests_canonical_scope(self) -> None:
        store = _Store()

        store.submit(_FIRST_IN_CHILE)

        assert store.manifest['canonical_brief']['scope'] == _FIRST_IN_CHILE

    def test_keeps_the_markets_in_every_child_scope(self) -> None:
        store = _Store()

        store.submit(_BOTH_IN_CHILE)

        assert store.child_scopes() == [keyword_scope('keyword-2', **_IN_CHILE), _FIRST_IN_CHILE]

    def test_names_children_apart_from_the_same_batch_without_a_market_filter(self) -> None:
        _status, with_market = _Store().submit(_FIRST_IN_CHILE)
        _status, without_market = _Store().submit(keyword_scope('keyword-1'))

        assert with_market['children'][0]['id'] != without_market['children'][0]['id']

    def test_replays_the_same_market_filtered_batch_as_existing_children(self, submitted: _Store) -> None:
        status, body = submitted.submit(_FIRST_IN_CHILE)

        assert (status, body['accepted_count'], body['existing_count']) == (202, 0, 1)

    def test_refuses_the_batch_id_again_with_another_market_list(self, submitted: _Store) -> None:
        status, body = submitted.submit(keyword_scope('keyword-1', market_ids=[_CHILE_ID, 'global']))

        assert (status, body) == (409, {
            'error': 'batch_id has already been used for a different batch request', 'field': 'batch_id',
        })


class TestMarketFilteredBatchRefusals:
    def test_refuses_a_selected_keyword_of_another_market(self) -> None:
        status, body = _Store().submit(keyword_scope('keyword-1', 'keyword-3', **_IN_CHILE))

        assert (status, body) == (400, {
            'error': 'scope.keyword_ids must contain only active existing keywords of the selected markets',
            'field': 'scope.keyword_ids',
        })

    def test_refuses_an_empty_market_list_on_its_field(self) -> None:
        status, body = _Store().submit(keyword_scope('keyword-1', market_ids=[]))

        assert (status, body) == (400, {
            'error': 'scope.market_ids must be a non-empty array of market ids', 'field': 'scope.market_ids',
        })

    def test_queues_nothing_when_the_scope_is_refused(self) -> None:
        store = _Store()

        store.submit(keyword_scope('keyword-3', **_IN_CHILE))

        assert (store.content[1], store.batches[1]) == ({}, {})


class TestMarketFilteredSingleBrief:
    def test_generate_stores_the_markets_keywords_and_filter_of_a_group_brief(self) -> None:
        content_table = fake_table()
        members = [{**keyword, 'group_ids': {'group-1'}} for keyword in _KEYWORDS]
        resource = content_studio_resource(content_table=content_table, keyword_items=members)
        idea = build_scoped_content_brief(scope={'mode': 'groups', 'group_ids': ['group-1'], **_IN_CHILE})

        with patch.object(_mod, 'dynamodb', resource):
            status, _body = parse_response(_mod._generate_content(content_generation_event(idea), None))

        stored = content_table.put_item.call_args.kwargs['Item']['idea_data']
        assert (status, stored['scope']['market_ids'], stored['keyword_ids']) == (200, [_CHILE_ID], ['keyword-2', 'keyword-1'])
