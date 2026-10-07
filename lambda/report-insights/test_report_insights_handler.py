"""Worker tests for GenerateInsights: which groups get a narrative, what is kept, and that nothing fails the run."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

from shared.models import BedrockInvocationError
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.handler_fixtures import handler_fixture
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
def _worker(module: ModuleType, reply: str | Exception, rows: list[dict] | None = None) -> Iterator[MagicMock]:
    """The worker over `_KEYWORDS` and `rows`, the model answering `reply`; yields the ReportInsights table."""
    search = MagicMock()
    search.query.return_value = {'Items': _ROWS if rows is None else rows}
    narratives = MagicMock()
    resource = fake_dynamodb_resource(by_name={'search': search, 'report-insights': narratives})
    bedrock = MagicMock(side_effect=reply) if isinstance(reply, Exception) else MagicMock(return_value=reply)
    with patch.multiple(
        module,
        dynamodb=resource,
        query_active_keywords=MagicMock(return_value=_KEYWORDS),
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

        assert (item['run_timestamp'], item['model'], item['language']) == (RUN_TIMESTAMP, 'global.anthropic.claude-sonnet-4-6', 'es')


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
