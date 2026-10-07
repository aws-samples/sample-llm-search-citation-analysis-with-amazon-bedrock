"""
Scope tests for get-recommendations.py — GET /api/recommendations.

The Action Center takes the report scope every KPI endpoint accepts
(``keyword`` | ``group_id`` | ``keyword_ids`` | ``scope=all``). These pin
that a scoped request analyses the scope's keywords and nothing else, that a
scope resolving to no active keyword is refused on the scope field, that the
LLM pass is told the same keywords, and that a request without a scope still
reads the first 20 active keywords exactly as before.

The Keywords table lists ``ACTIVE_KEYWORDS`` (``testing.report_scope_fixtures``)
and the SearchResults partitions answer from the rows a test stages.
"""

from __future__ import annotations

import os
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.events import parse_response
from testing.report_scope_fixtures import (
    REPORT_TABLES_ENV,
    ScopedReport,
    brand,
    load_scoped_handler,
    result,
    scoped_report,
)
from testing.search_results_fixtures import key_parts

_HERE = os.path.dirname(os.path.abspath(__file__))

BRAND_CONFIG = {'tracked_brands': {'first_party': ['Hotel Coruna'], 'competitors': ['Rival Inn']}}

_RIVAL_ONLY = [brand('Rival Inn', 'competitor', 2, 1)]

# The brand is missing from the two hotel keywords (one per group) and leads
# 'best hotels galicia', which is in both groups.
GAP_ROWS = {
    'hotel coruna spa': [result('hotel coruna spa', 'openai', _RIVAL_ONLY)],
    'hotel marino beach': [result('hotel marino beach', 'openai', _RIVAL_ONLY)],
    'best hotels galicia': [result('best hotels galicia', 'openai', [brand('Hotel Coruna', 'first_party')])],
}

MARINO_KEYWORDS = ['best hotels galicia', 'hotel marino beach']


@pytest.fixture(scope='module')
def recommendations() -> ModuleType:
    return load_scoped_handler(_HERE, 'get-recommendations.py')


@contextmanager
def action_center(module: ModuleType) -> Iterator[ScopedReport]:
    """The handler over ``GAP_ROWS``, with the status join answering no rows.

    The table names stay in the environment for the call: without a scope the
    loader reads ``DYNAMODB_TABLE_KEYWORDS`` per request to discover the active keywords.
    """
    with (
        patch.dict(os.environ, REPORT_TABLES_ENV),
        scoped_report(module, BRAND_CONFIG, search_rows=GAP_ROWS) as report,
        patch.object(module, 'load_sibling_function', return_value=MagicMock(return_value={})),
    ):
        yield report


def _queried_keywords(report: ScopedReport) -> list[str]:
    """The SearchResults partitions the request read, sorted."""
    return sorted(key_parts(call.kwargs['KeyConditionExpression'])[0] for call in report.tables['search'].query.call_args_list)


def _recommended_keywords(body: Mapping[str, Any]) -> set[str]:
    """Every keyword any recommendation of ``body`` names."""
    return {keyword for rec in body['recommendations'] for keyword in rec.get('keywords', [])}


class TestGroupScope:
    def test_names_only_keywords_of_the_requested_group(self, recommendations):
        with action_center(recommendations) as report:
            body = report.body({'group_id': 'marino'})

        assert _recommended_keywords(body) == {'hotel marino beach'}

    def test_never_mentions_a_keyword_outside_the_requested_group(self, recommendations):
        with action_center(recommendations) as report:
            response = report.call({'group_id': 'marino'})

        assert 'hotel coruna spa' not in response['body']

    def test_reads_only_the_partitions_of_the_requested_group(self, recommendations):
        with action_center(recommendations) as report:
            report.call({'group_id': 'marino'})
            queried = _queried_keywords(report)

        assert queried == MARINO_KEYWORDS

    def test_answers_400_on_the_scope_field_for_an_unknown_group(self, recommendations):
        with action_center(recommendations) as report:
            status, body = parse_response(report.call({'group_id': 'nope'}))

        assert (status, body) == (400, {'error': 'No active keywords match the selected scope (1 group(s)).', 'field': 'scope'})

    def test_answers_400_on_the_scope_field_for_two_scopes_at_once(self, recommendations):
        with action_center(recommendations) as report:
            status, body = parse_response(report.call({'keyword': 'hotel coruna spa', 'group_id': 'marino'}))

        assert (status, body) == (400, {'error': 'Use only one of keyword, group_id, keyword_ids, scope', 'field': 'scope'})


class TestSingleKeywordScope:
    def test_reads_only_that_keywords_partition(self, recommendations):
        with action_center(recommendations) as report:
            report.call({'keyword': 'hotel coruna spa'})
            queried = _queried_keywords(report)

        assert queried == ['hotel coruna spa']

    def test_recommends_for_that_keyword_alone(self, recommendations):
        with action_center(recommendations) as report:
            body = report.body({'keyword': 'hotel coruna spa'})

        assert _recommended_keywords(body) == {'hotel coruna spa'}


class TestNoScope:
    def test_loads_the_first_twenty_active_keywords_as_before(self, recommendations):
        loader = MagicMock(return_value=[])
        with action_center(recommendations) as report, patch.object(recommendations, 'load_recent_search_results', loader):
            report.call(None)
            resource = recommendations.dynamodb

        loader.assert_called_once_with(resource, recommendations.SEARCH_RESULTS_TABLE, max_keywords=20, keywords=None)

    def test_discovers_the_active_keywords_from_the_keywords_table(self, recommendations):
        with action_center(recommendations) as report:
            report.call(None)
            queried = _queried_keywords(report)

        assert queried == ['best hotels galicia', 'hotel coruna spa', 'hotel marino beach']

    def test_keeps_the_unscoped_response_shape(self, recommendations):
        with action_center(recommendations) as report:
            body = report.body(None)

        assert sorted(body) == ['by_priority', 'generated_at', 'llm_enhanced', 'recommendations', 'total_count']
        assert _recommended_keywords(body) == {'hotel coruna spa', 'hotel marino beach'}


class TestLlmPass:
    @pytest.fixture
    def llm_call(self, recommendations) -> tuple[MagicMock, dict[str, Any]]:
        """``generate_llm_recommendations`` as the marino group's ``use_llm=true`` request called it, and the body."""
        llm = MagicMock(return_value=[{'type': 'llm', 'priority': 'high', 'title': 'From the model'}])
        with action_center(recommendations) as report, patch.object(recommendations, 'generate_llm_recommendations', llm):
            body = report.body({'group_id': 'marino', 'use_llm': 'true'})
        return llm, body

    def test_passes_the_scopes_keywords_to_the_llm_pass(self, llm_call):
        llm, _body = llm_call

        config, _context, keywords = llm.call_args.args
        assert (config, keywords) == (BRAND_CONFIG, MARINO_KEYWORDS)

    def test_returns_the_llm_recommendations_next_to_the_rules(self, llm_call):
        _llm, body = llm_call

        assert body['llm_enhanced'] == [{'type': 'llm', 'priority': 'high', 'title': 'From the model'}]

    def test_passes_no_keywords_to_the_llm_pass_without_a_scope(self, recommendations):
        llm = MagicMock(return_value=[])
        with action_center(recommendations) as report, patch.object(recommendations, 'generate_llm_recommendations', llm):
            report.call({'use_llm': 'true'})

        assert llm.call_args.args[2] is None


def _llm_prompt(module: ModuleType, keywords: list[str] | None) -> str:
    """The prompt ``generate_llm_recommendations`` sends to Bedrock for ``keywords``."""
    with patch.object(module, 'invoke_bedrock', return_value='[]') as bedrock:
        module.generate_llm_recommendations(BRAND_CONFIG, '[]', keywords)
    return bedrock.call_args.args[0]


class TestLlmPrompt:
    def test_names_the_scoped_keywords_before_the_brand_configuration(self, recommendations):
        prompt = _llm_prompt(recommendations, MARINO_KEYWORDS)

        assert (
            'Keywords In Scope (recommend for these only):\n- best hotels galicia\n- hotel marino beach\n\nBrand Configuration:'
            in prompt
        )

    def test_sends_the_unscoped_prompt_without_a_scope_section(self, recommendations):
        scoped = _llm_prompt(recommendations, ['hotel marino beach'])

        unscoped = _llm_prompt(recommendations, None)

        assert unscoped == scoped.replace('Keywords In Scope (recommend for these only):\n- hotel marino beach\n\n', '')
        assert 'Keywords In Scope' not in unscoped
