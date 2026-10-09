"""The optional ``scope.market_ids`` of a Content Studio group brief.

A brief scope (``groups`` or ``keywords`` mode) may carry ``market_ids``, the
filter every run and schedule scope takes: validated by the same function as
``shared.keyword_groups.validate_scope``, kept in the canonical scope (so batch
payload hashes and content ids depend on it) and applied when the members are
resolved through ``resolve_scope``.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from shared.content_brief import ContentBriefValidationIssue, canonicalize_group_brief, single_keyword_brief
from shared.keyword_groups import validate_scope
from testing.assertions import present
from testing.content_brief_fixtures import active_keyword, build_scoped_content_brief, keyword_scope
from testing.dynamodb_stubs import fake_table
from testing.markets_fixtures import BRAZIL, CHILE

_CHILE_ID = CHILE['market_id']
_BRAZIL_ID = BRAZIL['market_id']
_GROUP = {'id': 'group-1', 'name': 'Altiplano Air routes'}
_MEMBERS = [
    active_keyword('keyword-1', 'vuelos santiago altiplano air', group_ids={'group-1'}, market_id=_CHILE_ID),
    active_keyword('keyword-2', 'voos altiplano air sao paulo', group_ids={'group-1'}, market_id=_BRAZIL_ID),
    active_keyword('keyword-3', 'altiplano air baggage', group_ids={'group-1'}),
]
"""One group member per market: Chile, Brazil and the global market."""


def _canonical(scope: dict[str, object]) -> tuple[dict[str, Any] | None, ContentBriefValidationIssue | None]:
    """Canonicalize a group brief of ``scope`` against ``_MEMBERS`` (the group exists)."""
    return canonicalize_group_brief(
        build_scoped_content_brief(scope=scope),
        fake_table(get_item={'Item': _GROUP}),
        fake_table(query={'Items': _MEMBERS}),
        url_validator=MagicMock(return_value=(True, '')),
    )


def _group_scope(**fields: object) -> dict[str, object]:
    return {'mode': 'groups', 'group_ids': ['group-1'], **fields}


class TestGroupScopeMarkets:
    def test_keeps_only_the_group_members_of_the_selected_market(self) -> None:
        canonical, _issue = _canonical(_group_scope(market_ids=[_CHILE_ID]))

        assert present(canonical)['keyword_ids'] == ['keyword-1']

    def test_keeps_the_markets_in_the_canonical_scope(self) -> None:
        canonical, _issue = _canonical(_group_scope(market_ids=[_CHILE_ID, 'global']))

        assert present(canonical)['scope'] == _group_scope(market_ids=[_CHILE_ID, 'global'])

    def test_global_keeps_the_members_without_a_market(self) -> None:
        canonical, _issue = _canonical(_group_scope(market_ids=['global']))

        assert present(canonical)['keywords'] == ['altiplano air baggage']

    def test_keeps_the_members_of_every_listed_market_sorted_by_keyword(self) -> None:
        canonical, _issue = _canonical(_group_scope(market_ids=[_BRAZIL_ID, _CHILE_ID]))

        assert present(canonical)['keywords'] == ['voos altiplano air sao paulo', 'vuelos santiago altiplano air']

    def test_deduplicates_repeated_markets_in_request_order(self) -> None:
        canonical, _issue = _canonical(_group_scope(market_ids=[_BRAZIL_ID, 'global', _BRAZIL_ID]))

        assert present(canonical)['scope']['market_ids'] == [_BRAZIL_ID, 'global']

    def test_keeps_every_member_and_no_market_filter_without_market_ids(self) -> None:
        canonical, _issue = _canonical(_group_scope())

        assert (present(canonical)['scope'], present(canonical)['keyword_ids']) == (
            _group_scope(), ['keyword-3', 'keyword-2', 'keyword-1'],
        )

    def test_rejects_a_group_without_active_members_in_the_selected_markets(self) -> None:
        canonical, issue = _canonical(_group_scope(market_ids=['fr-fr']))

        assert (canonical, issue) == (None, ContentBriefValidationIssue(
            'scope.group_ids', 'Keyword group has no active keywords of the selected markets',
        ))


class TestKeywordScopeMarkets:
    def test_accepts_selected_keywords_of_the_selected_market(self) -> None:
        canonical, _issue = _canonical(keyword_scope('keyword-1', market_ids=[_CHILE_ID]))

        assert present(canonical)['scope'] == keyword_scope('keyword-1', market_ids=[_CHILE_ID])

    def test_rejects_a_selected_keyword_of_another_market(self) -> None:
        canonical, issue = _canonical(keyword_scope('keyword-1', 'keyword-2', market_ids=[_CHILE_ID]))

        assert (canonical, issue) == (None, ContentBriefValidationIssue(
            'scope.keyword_ids', 'scope.keyword_ids must contain only active existing keywords of the selected markets',
        ))

    def test_carries_the_markets_into_each_single_keyword_batch_child(self) -> None:
        canonical, _issue = _canonical(keyword_scope('keyword-1', market_ids=[_CHILE_ID]))

        child = single_keyword_brief(present(canonical), idea_id='child-1', keyword_id='keyword-1', keyword='vuelos')

        assert child['scope'] == keyword_scope('keyword-1', market_ids=[_CHILE_ID])

    def test_single_keyword_batch_child_has_no_market_filter_when_the_brief_has_none(self) -> None:
        canonical, _issue = _canonical(keyword_scope('keyword-3'))

        child = single_keyword_brief(present(canonical), idea_id='child-1', keyword_id='keyword-3', keyword='baggage')

        assert child['scope'] == keyword_scope('keyword-3')


class TestMarketValidation:
    @pytest.mark.parametrize('market_ids', [[], 'cl-es', ['CL'], ['cl-es', 7], [None]],
                             ids=['empty', 'string', 'upper-case', 'number', 'null-entry'])
    def test_refuses_market_ids_on_their_field_with_the_run_scopes_message(self, market_ids: object) -> None:
        _descriptor, run_scope_error = validate_scope(_group_scope(market_ids=market_ids))

        canonical, issue = _canonical(_group_scope(market_ids=market_ids))

        assert (canonical, issue) == (None, ContentBriefValidationIssue('scope.market_ids', str(run_scope_error)))

    def test_refuses_an_empty_market_list_as_a_non_empty_array_of_market_ids(self) -> None:
        _canonical_brief, issue = _canonical(keyword_scope('keyword-1', market_ids=[]))

        assert issue == ContentBriefValidationIssue('scope.market_ids', 'scope.market_ids must be a non-empty array of market ids')

    def test_treats_null_market_ids_as_every_market(self) -> None:
        canonical, _issue = _canonical(_group_scope(market_ids=None))

        assert present(canonical)['scope'] == _group_scope()

    def test_still_refuses_fields_besides_mode_the_ids_and_market_ids(self) -> None:
        _canonical_brief, issue = _canonical(_group_scope(market_ids=[_CHILE_ID], markets=[_CHILE_ID]))

        assert issue == ContentBriefValidationIssue(
            'scope', 'scope for groups mode must contain mode and group_ids, and optionally market_ids',
        )
