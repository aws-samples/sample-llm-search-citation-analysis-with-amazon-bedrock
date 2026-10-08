"""Worker tests for GenerateInsights: which groups get a narrative, what is kept, and that nothing fails the run."""

from __future__ import annotations

import json
import os
from collections.abc import Generator
from contextlib import contextmanager
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

from shared.markets import markets_from_item
from shared.models import BedrockInvocationError
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.handler_fixtures import handler_fixture
from testing.markets_fixtures import BRAZIL, CHILE, markets_item
from testing.report_insights_fixtures import (
    REPORT_INSIGHTS_ENV,
    RUN_TIMESTAMP,
    insight_item,
    model_narrative,
    ranked_answer_row,
    recommendation_item,
)

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_ENGINE_ID = 'engine_play:openai'
_BRAND_CONFIG = {
    'tracked_brands': {'first_party': ['Aurora Airways'], 'competitors': ['Borealis Air']},
    'industry': 'airline',
    'first_party_domains': ['aurora.example'],
}
_KEYWORDS = [
    {'id': 'k1', 'keyword': 'vuelos baratos a lima', 'group_ids': {'group-1', 'group-2'}},
    {'id': 'k2', 'keyword': 'mejor aerolínea de sudamérica', 'group_ids': {'group-1'}},
]
#: OpenAI ranks Aurora Airways first in both keywords and never cites it: one `get_cited` insight over 2 answers.
_ROWS = [ranked_answer_row('vuelos baratos a lima', 'openai', 1)]

worker_module = handler_fixture(_HANDLER_DIR, 'handler.py', 'report_insights_worker_under_test', env=REPORT_INSIGHTS_ENV)


def _workflow_event(*group_ids: str, status: str = 'completed') -> dict:
    """The GenerateInsights payload: KpiAlerts' result for a run that snapshotted ``group_ids``."""
    return {'alerts': {'status': status, 'run_timestamp': RUN_TIMESTAMP, 'snapshot_group_ids': list(group_ids)}}


def _model_reply(narrative: dict) -> str:
    return f'Here is the narrative:\n```json\n{json.dumps(narrative)}\n```'


_VALID_INSIGHT = insight_item('OpenAI ranks Aurora Airways first in 100% of answers.', _ENGINE_ID)
_INVENTED_INSIGHT = insight_item('OpenAI cites Aurora Airways in 45% of answers.', _ENGINE_ID)
_VALID_RECOMMENDATION = recommendation_item('Publish fare pages OpenAI can cite.', _ENGINE_ID)


@contextmanager
def _worker(
    module: ModuleType,
    reply: str | Exception,
    rows: list[dict] | None = None,
    *,
    keywords: list[dict] | None = None,
    search: MagicMock | None = None,
    brand_config_table: MagicMock | None = None,
) -> Generator[MagicMock, None, None]:
    """The worker over `keywords` (`_KEYWORDS`) and `rows`, the model answering `reply`; yields the ReportInsights table.

    `search` replaces the SearchResults stub that answers `rows`; `brand_config_table` holds the market list.
    """
    if search is None:
        search = MagicMock()
        search.query.return_value = {'Items': _ROWS if rows is None else rows}
    narratives = MagicMock()
    resource = fake_dynamodb_resource(by_name={
        'search': search, 'report-insights': narratives, 'brand-config': brand_config_table or MagicMock(),
    })
    bedrock = MagicMock(side_effect=reply) if isinstance(reply, Exception) else MagicMock(return_value=reply)
    with patch.multiple(
        module,
        dynamodb=resource,
        query_active_keywords=MagicMock(return_value=_KEYWORDS if keywords is None else keywords),
        get_brand_config=MagicMock(return_value=_BRAND_CONFIG),
        invoke_bedrock=bedrock,
    ):
        yield narratives


def _stored(narratives: MagicMock) -> dict:
    return narratives.put_item.call_args.kwargs['Item']


def _narratives_written_for(module: ModuleType, event: dict) -> MagicMock:
    """The ReportInsights table after the worker handles `event`, the model answering with one valid insight."""
    with _worker(module, _model_reply(model_narrative([_VALID_INSIGHT]))) as narratives:
        module.handler(event, None)
    return narratives


class TestGroupSelection:
    def test_writes_only_the_groups_the_run_fully_covered(self, worker_module) -> None:
        narratives = _narratives_written_for(worker_module, _workflow_event('group-1'))

        assert [call.kwargs['Item']['scope_key'] for call in narratives.put_item.call_args_list] == ['group#group-1']

    def test_writes_nothing_when_the_kpi_alerts_step_failed(self, worker_module) -> None:
        with _worker(worker_module, _model_reply(model_narrative())) as narratives:
            result = worker_module.handler({'alerts': {'status': 'failed', 'message': 'KPI alert evaluation failed'}}, None)

        assert result == {'status': 'skipped', 'reason': 'no_complete_groups', 'groups': 0}
        narratives.put_item.assert_not_called()

    def test_writes_nothing_when_no_group_was_snapshotted(self, worker_module) -> None:
        with _worker(worker_module, _model_reply(model_narrative())) as narratives:
            result = worker_module.handler(_workflow_event(), None)

        assert result['reason'] == 'no_complete_groups'
        narratives.put_item.assert_not_called()

    def test_writes_four_groups_at_a_time(self, worker_module) -> None:
        pool = MagicMock(wraps=worker_module.ThreadPoolExecutor)
        groups = [f'group-{index}' for index in range(6)]

        with _worker(worker_module, _model_reply(model_narrative())), patch.object(worker_module, 'ThreadPoolExecutor', pool):
            worker_module.handler(_workflow_event(*groups), None)

        assert pool.call_args.kwargs == {'max_workers': 4}

    def test_skips_a_snapshotted_group_without_active_keywords(self, worker_module) -> None:
        with _worker(worker_module, _model_reply(model_narrative())):
            result = worker_module.handler(_workflow_event('group-gone'), None)

        assert (result['skipped'], result['generated']) == (1, 0)


class TestValidation:
    def test_stores_only_the_items_that_pass_validation(self, worker_module) -> None:
        reply = _model_reply(model_narrative([_VALID_INSIGHT, _INVENTED_INSIGHT], [_VALID_RECOMMENDATION]))

        with _worker(worker_module, reply) as narratives:
            worker_module.handler(_workflow_event('group-1'), None)

        assert _stored(narratives)['narrative'] == {'insights': [_VALID_INSIGHT], 'recommendations': [_VALID_RECOMMENDATION]}

    def test_stores_and_reports_the_drop_count(self, worker_module) -> None:
        reply = _model_reply(model_narrative([_VALID_INSIGHT, _INVENTED_INSIGHT]))

        with _worker(worker_module, reply) as narratives:
            result = worker_module.handler(_workflow_event('group-1'), None)

        assert (_stored(narratives)['dropped'], result['dropped']) == (1, 1)

    def test_stores_the_run_model_and_keyword_language(self, worker_module) -> None:
        item = _stored(_narratives_written_for(worker_module, _workflow_event('group-1')))

        assert (item['run_timestamp'], item['model'], item['language']) == (RUN_TIMESTAMP, 'global.anthropic.claude-sonnet-5-5', 'es')


class TestFailures:
    def test_keeps_the_run_when_bedrock_fails(self, worker_module) -> None:
        with _worker(worker_module, BedrockInvocationError('throttled')) as narratives:
            result = worker_module.handler(_workflow_event('group-1'), None)

        assert (result['status'], result['failed'], result['generated']) == ('completed', 1, 0)
        narratives.put_item.assert_not_called()

    def test_counts_output_without_json_as_a_failed_group(self, worker_module) -> None:
        with _worker(worker_module, 'I cannot help with that.') as narratives:
            result = worker_module.handler(_workflow_event('group-1'), None)

        assert result['failed'] == 1
        narratives.put_item.assert_not_called()

    def test_skips_bedrock_when_the_group_has_no_insight(self, worker_module) -> None:
        defended = [{**ranked_answer_row('vuelos baratos a lima', 'openai', 1), 'citations': ['https://aurora.example/fares']}]

        with _worker(worker_module, _model_reply(model_narrative()), rows=defended):
            result = worker_module.handler(_workflow_event('group-1'), None)
            bedrock = worker_module.invoke_bedrock

        assert result['skipped'] == 1
        bedrock.assert_not_called()

    def test_keeps_the_other_groups_when_one_group_fails(self, worker_module) -> None:
        replies = [BedrockInvocationError('throttled'), _model_reply(model_narrative([_VALID_INSIGHT]))]

        with _worker(worker_module, _model_reply(model_narrative())):
            worker_module.invoke_bedrock.side_effect = replies
            with patch.object(worker_module, 'GROUP_WORKERS', 1):
                result = worker_module.handler(_workflow_event('group-1', 'group-2'), None)

        assert (result['failed'], result['generated']) == (1, 1)


class TestRegenerate:
    def test_writes_the_group_narrative_for_its_latest_run(self, worker_module) -> None:
        item = _stored(_narratives_written_for(worker_module, {'group_id': 'group-2'}))

        assert (item['scope_key'], item['run_timestamp']) == ('group#group-2', RUN_TIMESTAMP)


class TestPrompt:
    @pytest.fixture
    def prompt(self, worker_module) -> str:
        with _worker(worker_module, _model_reply(model_narrative())):
            worker_module.handler(_workflow_event('group-1'), None)
            return worker_module.invoke_bedrock.call_args.args[0]

    def test_asks_for_the_keyword_language(self, prompt: str) -> None:
        assert 'Write in Spanish.' in prompt

    def test_passes_the_computed_insight_ids(self, prompt: str) -> None:
        assert f'"id": "{_ENGINE_ID}"' in prompt

    def test_wraps_the_brand_as_untrusted_input(self, prompt: str) -> None:
        assert '<brand>Aurora Airways</brand>' in prompt

    def test_passes_no_cited_answer_url(self, prompt: str) -> None:
        assert 'https://borealis.example/fares' not in prompt

    def test_says_a_sub_brand_gap_is_measured_against_the_best_sub_brand(self, prompt: str) -> None:
        assert 'measured against the best of the brand\'s own sub-brands, not against the KPIs' in prompt

    def test_asks_for_plain_words_instead_of_field_names(self, prompt: str) -> None:
        assert 'in plain words (never the evidence\'s field names)' in prompt


# --- Markets (2.37.0): one narrative per (group, market) ------------------------------

# One group with a keyword per market: global, Chile and Brazil (whose airline goes by a local name).
_MARKET_KEYWORDS = [
    {'id': 'k1', 'keyword': 'cheap flights to lima', 'group_ids': {'altiplano'}},
    {'id': 'k2', 'keyword': 'vuelos baratos a lima', 'group_ids': {'altiplano'}, 'market_id': 'cl-es'},
    {'id': 'k3', 'keyword': 'passagens baratas para lima', 'group_ids': {'altiplano'}, 'market_id': 'br-pt'},
]
_STORED_MARKETS = markets_item(CHILE, {**BRAZIL, 'first_party_aliases': ['Aurora Linhas Aéreas']})


def _queried_keyword(condition) -> str:
    """The keyword a SearchResults ``KeyConditionExpression`` names (``keyword = x`` alone or ANDed)."""
    expression = condition.get_expression()
    if expression['operator'] == 'AND':
        expression = expression['values'][0].get_expression()
    return expression['values'][1]


class MarketWorker:
    """The worker over `_MARKET_KEYWORDS` answering ``event``: what it read, asked and stored."""

    def __init__(self, module: ModuleType, event: dict) -> None:
        self.search = MagicMock()
        self.search.query.side_effect = lambda **kwargs: {
            'Items': [ranked_answer_row(_queried_keyword(kwargs['KeyConditionExpression']), 'openai', 1)],
        }
        self.brand_config = fake_table(get_item={'Item': _STORED_MARKETS})
        reply = _model_reply(model_narrative([_VALID_INSIGHT]))
        with _worker(module, reply, keywords=_MARKET_KEYWORDS, search=self.search, brand_config_table=self.brand_config) as narratives:
            self.result = module.handler(event, None)
            self.prompts = [call.args[0] for call in module.invoke_bedrock.call_args_list]
        self.items = [call.kwargs['Item'] for call in narratives.put_item.call_args_list]

    def scope_keys(self) -> list[str]:
        return sorted(item['scope_key'] for item in self.items)

    def keywords_read(self) -> set[str]:
        return {_queried_keyword(call.kwargs['KeyConditionExpression']) for call in self.search.query.call_args_list}


def _scopes_event(*pairs: tuple[str, str]) -> dict:
    event = _workflow_event(*sorted({group for group, _market in pairs}))
    event['alerts']['snapshot_scopes'] = [{'group_id': group, 'market_id': market} for group, market in pairs]
    return event


class TestNarrativePerMarket:
    def test_writes_one_narrative_per_snapshotted_pair_under_its_market_key(self, worker_module) -> None:
        worker = MarketWorker(worker_module, _scopes_event(('altiplano', 'global'), ('altiplano', 'cl-es')))

        assert worker.scope_keys() == ['group#altiplano', 'group#altiplano#cl-es']

    @pytest.mark.parametrize(('event', 'keyword'), [
        pytest.param(_scopes_event(('altiplano', 'cl-es')), 'vuelos baratos a lima', id='market-pair'),
        pytest.param({'group_id': 'altiplano'}, 'cheap flights to lima', id='regenerate-global'),
    ])
    def test_reads_only_the_keywords_of_the_pairs_market(self, worker_module, event, keyword) -> None:
        assert MarketWorker(worker_module, event).keywords_read() == {keyword}

    def test_writes_in_the_markets_language(self, worker_module) -> None:
        assert MarketWorker(worker_module, _scopes_event(('altiplano', 'br-pt'))).items[0]['language'] == 'pt'

    @pytest.mark.parametrize(('market_id', 'brands'), [
        ('br-pt', '<brand>Aurora Airways, Aurora Linhas Aéreas</brand>'),
        ('global', '<brand>Aurora Airways</brand>'),
    ])
    def test_names_the_markets_local_brand_names_in_the_prompt(self, worker_module, market_id, brands) -> None:
        assert brands in MarketWorker(worker_module, _scopes_event(('altiplano', market_id))).prompts[0]

    def test_does_not_read_the_markets_for_global_pairs_only(self, worker_module) -> None:
        MarketWorker(worker_module, _scopes_event(('altiplano', 'global'))).brand_config.get_item.assert_not_called()

    def test_skips_a_market_that_is_no_longer_configured(self, worker_module) -> None:
        worker = MarketWorker(worker_module, _scopes_event(('altiplano', 'fr-fr')))

        assert (worker.result['skipped'], worker.scope_keys()) == (1, [])

    @pytest.mark.parametrize(('event', 'scope_key'), [
        pytest.param(_workflow_event('altiplano'), 'group#altiplano', id='pre-markets-execution'),
        pytest.param({'group_id': 'altiplano', 'market_id': 'cl-es'}, 'group#altiplano#cl-es', id='regenerate-market'),
    ])
    def test_writes_the_requested_market_narrative(self, worker_module, event, scope_key) -> None:
        assert MarketWorker(worker_module, event).scope_keys() == [scope_key]


class TestOutcome:
    def test_names_the_market_of_a_non_global_outcome(self, worker_module) -> None:
        chile = markets_from_item(markets_item(CHILE))[0]

        assert worker_module.GroupRun('altiplano', [], None, chile).outcome(status='failed') == {
            'group_id': 'altiplano', 'market_id': 'cl-es', 'status': 'failed',
        }

    def test_omits_the_market_of_a_global_outcome(self, worker_module) -> None:
        assert worker_module.GroupRun('altiplano', [], None).outcome(status='failed') == {'group_id': 'altiplano', 'status': 'failed'}
