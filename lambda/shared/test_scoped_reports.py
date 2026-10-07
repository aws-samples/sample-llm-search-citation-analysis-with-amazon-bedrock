"""
Tests for shared.scoped_reports.

``required_report_scope`` turns the injected scope parameters into the
handler's ``ReportScope`` argument or answers 400 without calling it;
``capped_scope`` keeps the first ``cap`` keywords and describes the cut.
"""

from __future__ import annotations

import inspect
import json
from typing import Any
from unittest.mock import MagicMock

from shared.scope_params import SCOPE_KEYWORDS_CAP, ReportScope
from shared.scoped_reports import capped_scope, optional_scope_keywords, required_report_scope
from testing.assertions import present

_EVENT: dict[str, Any] = {'httpMethod': 'GET', 'path': '/api/x', 'headers': {}}


def _scope(count: int) -> ReportScope:
    keywords = tuple(f'kw {index:03}' for index in range(count))
    return ReportScope(kind='all', keywords=keywords, scope={'mode': 'all'}, label='All keywords')


def stub_handler(event: dict[str, Any], context: Any, report_scope: ReportScope, **params: Any) -> dict[str, Any]:
    return {'kind': report_scope.kind, 'keywords': list(report_scope.keywords), 'params': params}


class TestRequiredReportScope:
    def test_hands_the_resolved_scope_and_the_other_params_to_the_handler(self) -> None:
        handler = required_report_scope(MagicMock)(stub_handler)

        answer = handler(_EVENT, None, keyword='hotel coruna', group_id=None, keyword_ids=None, scope=None, days=30)

        assert answer == {'kind': 'keyword', 'keywords': ['hotel coruna'], 'params': {'days': 30}}

    def test_answers_400_on_the_keyword_field_without_a_scope(self) -> None:
        handler = required_report_scope(MagicMock)(stub_handler)

        response = handler(_EVENT, None, days=30)

        assert present(response)['statusCode'] == 400
        assert json.loads(present(response)['body'])['field'] == 'keyword'

    def test_answers_400_on_contradictory_scopes(self) -> None:
        handler = required_report_scope(MagicMock)(stub_handler)

        response = handler(_EVENT, None, keyword='a', group_id='coruna')

        assert present(response)['statusCode'] == 400

    def test_unwraps_to_the_decorated_handler_so_its_name_reaches_error_logs(self) -> None:
        handler = required_report_scope(MagicMock)(stub_handler)

        assert inspect.unwrap(handler) is stub_handler

    def test_resolves_the_keywords_table_on_every_request(self) -> None:
        keywords_table = MagicMock(return_value=MagicMock())
        handler = required_report_scope(keywords_table)(stub_handler)

        handler(_EVENT, None, keyword='a')
        handler(_EVENT, None, keyword='b')

        assert keywords_table.call_count == 2


def stub_keywords_handler(event: dict[str, Any], context: Any, keywords: list[str] | None, **params: Any) -> dict[str, Any]:
    return {'keywords': keywords, 'params': params}


def _optional(**query: Any) -> dict[str, Any] | None:
    """Call a handler under ``optional_scope_keywords`` with the given query parameters."""
    return optional_scope_keywords(MagicMock)(stub_keywords_handler)(_EVENT, None, **query)


def _rejection_field(response: dict[str, Any] | None) -> tuple[int, str]:
    return present(response)['statusCode'], json.loads(present(response)['body'])['field']


class TestOptionalScopeKeywords:
    """Action Center and Prompt Insights: a scope narrows the keywords, no scope keeps the handler's default."""

    def test_hands_the_scopes_keyword_texts_and_the_other_params_to_the_handler(self) -> None:
        assert _optional(keyword='hotel coruna', group_id=None, use_llm=False) == {
            'keywords': ['hotel coruna'], 'params': {'use_llm': False},
        }

    def test_hands_none_without_a_scope_so_the_handler_applies_its_default(self) -> None:
        assert _optional(keyword=None, group_id=None, limit=20) == {'keywords': None, 'params': {'limit': 20}}

    def test_answers_400_on_the_scope_field_for_contradictory_scopes_without_calling_the_handler(self) -> None:
        assert _rejection_field(_optional(keyword='a', group_id='coruna')) == (400, 'scope')


class TestCappedScope:
    def test_keeps_every_keyword_under_the_cap(self) -> None:
        keywords, fields = capped_scope(_scope(2))

        assert (keywords, fields['keywords_truncated']) == (['kw 000', 'kw 001'], False)

    def test_cuts_the_keywords_at_the_default_cap(self) -> None:
        keywords, fields = capped_scope(_scope(SCOPE_KEYWORDS_CAP + 1))

        assert (len(keywords), fields['keywords_truncated']) == (SCOPE_KEYWORDS_CAP, True)

    def test_cuts_the_keywords_at_a_given_cap(self) -> None:
        keywords, _fields = capped_scope(_scope(3), cap=2)

        assert keywords == ['kw 000', 'kw 001']

    def test_describes_the_whole_scope(self) -> None:
        _keywords, fields = capped_scope(_scope(3), cap=2)

        assert fields['scope'] == {'mode': 'all', 'kind': 'all', 'label': 'All keywords', 'keyword_count': 3}
