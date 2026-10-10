"""Worker-level tests for complete-run snapshot and alert behavior."""

from __future__ import annotations

import logging
import os
from collections.abc import Generator
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared.kpi_alerts import DEFAULT_ALERT_SETTINGS, deterministic_alert_id
from shared.kpi_engine import Answer, answers_from_rows
from testing.dynamodb_stubs import conditional_check_failure, fake_dynamodb_resource, fake_table
from testing.handler_fixtures import handler_fixture
from testing.map_run_fixtures import RESULTS_BUCKET, fake_s3_objects
from testing.markets_fixtures import CHILE, markets_item
from testing.search_result_fixtures import successful_answer_row

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_SUMMARY_HANDLER_DIR = os.path.join(os.path.dirname(_HANDLER_DIR), 'generate-summary')
_RUN_TIMESTAMP = '2026-10-01T10:00:00Z'
_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'search',
    'DYNAMODB_TABLE_KEYWORDS': 'keywords',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'groups',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'brand-config',
    'DYNAMODB_TABLE_KPI_SNAPSHOTS': 'snapshots',
    'DYNAMODB_TABLE_KPI_ALERTS': 'alerts',
    'DYNAMODB_TABLE_ALERT_SETTINGS': 'settings',
    'DYNAMODB_TABLE_CONTENT_CHANGES': 'changes',
    'KPI_ALERTS_TOPIC_ARN': 'arn:aws:sns:us-east-1:123456789012:kpi-alerts',
}

worker_module = handler_fixture(
    _HANDLER_DIR,
    'handler.py',
    'kpi_alert_worker_under_test',
    env=_ENV,
)
summary_module = handler_fixture(
    _SUMMARY_HANDLER_DIR,
    'handler.py',
    'generate_summary_for_kpi_alerts_under_test',
    env={},
)


def _event(status: str = 'completed') -> dict:
    return {
        'execution_id': 'exec-1',
        'execution_input': {'scope': {'mode': 'all'}},
        'report': {
            'execution_id': 'exec-1',
            'timestamp': '2026-10-01T10:05:00Z',
            'status': status,
            'run_metadata': {
                'timestamp': _RUN_TIMESTAMP,
                'timestamps': [_RUN_TIMESTAMP],
                'processed_keywords': [
                    {'keyword': 'shared keyword', 'timestamp': _RUN_TIMESTAMP},
                ],
            },
        },
    }


def _row(provider: str, *brands: tuple[str, str, int]) -> dict:
    """One engine answer to the shared keyword in the evaluated run."""
    return successful_answer_row(
        keyword='shared keyword',
        timestamp=_RUN_TIMESTAMP,
        provider=provider,
        brands=brands,
        citations=['https://hotel-mine.com/rooms'],
    )


def _answers() -> list[Answer]:
    """Two answers: the hotel 2nd behind the rival, then the rival alone."""
    return answers_from_rows([
        _row('openai', ('Rival', 'competitor', 1), ('Hotel Mine', 'first_party', 2)),
        _row('gemini', ('Rival', 'competitor', 3)),
    ])


def _single_group_tables(**tables: MagicMock) -> tuple[MagicMock, MagicMock, MagicMock]:
    """The snapshots and alerts tables and a resource serving them (plus ``tables``, by name)."""
    snapshots = MagicMock()
    alerts = MagicMock()
    resource = fake_dynamodb_resource(by_name={
        'snapshots': snapshots,
        'alerts': alerts,
        **tables,
    })
    return snapshots, alerts, resource


_ALERTS_DISABLED = {**DEFAULT_ALERT_SETTINGS, 'enabled': False}
_EMAIL_SETTINGS = {**DEFAULT_ALERT_SETTINGS, 'notification_emails': ['ops@example.com']}
#: A rule result for a group; each test names its ``entity``.
_MENTION_RATE_DROP = {
    'type': 'mention_rate_drop',
    'severity': 'warning',
    'previous': 64.0,
    'current': 52.0,
    'delta': 12.0,
    'threshold': 10.0,
    'message': 'Mention rate fell by 12.0 points.',
}
_SHARED_KEYWORD_IN_TWO_GROUPS = [{
    'id': 'keyword-1',
    'keyword': 'shared keyword',
    'group_ids': {'group-1', 'group-2'},
}]


#: The brand configuration of the hotel: its owned domain, no tracked competitor.
_HOTEL_BRAND_CONFIG = {'first_party_domains': ['hotel-mine.com']}


def _complete_group_patches(
    worker_module,
    resource: MagicMock,
    settings: dict,
    answers: list[Answer] | None,
    brand_config: dict = _HOTEL_BRAND_CONFIG,
):
    return patch.multiple(
        worker_module,
        query_active_keywords=MagicMock(return_value=[{
            'id': 'keyword-1',
            'keyword': 'shared keyword',
            'group_ids': {'group-1'},
        }]),
        _load_groups=MagicMock(return_value=[{'id': 'group-1', 'name': 'Group One'}]),
        _settings=MagicMock(return_value=settings),
        get_brand_config=MagicMock(return_value=brand_config),
        _load_run_answers=MagicMock(return_value={'shared keyword': answers}),
        dynamodb=resource,
    )


@contextmanager
def _complete_group_run(
    worker_module,
    resource: MagicMock,
    settings: dict,
    previous_snapshot: dict | None = None,
    *,
    answers: list[Answer] | None = None,
    brand_config: dict = _HOTEL_BRAND_CONFIG,
) -> Generator[None, None, None]:
    """One complete group whose exact-run answers are `_answers()` unless given, with notification stubbed out."""
    with (
        _complete_group_patches(worker_module, resource, settings, _answers() if answers is None else answers, brand_config),
        patch.object(worker_module, '_previous_snapshot', return_value=previous_snapshot),
        patch.object(worker_module, '_notify', return_value={'status': 'not_sent'}),
    ):
        yield


def _run_complete_group(
    worker_module,
    resource: MagicMock,
    settings: dict,
    previous_snapshot: dict | None,
) -> dict:
    """Run the worker over one complete group whose exact-run answers are `_answers()`."""
    with _complete_group_run(worker_module, resource, settings, previous_snapshot):
        return worker_module.handler(_event(), None)


def _recorded_snapshot(worker_module) -> dict:
    """The snapshot the worker stores for the complete group, with alerts disabled and no previous snapshot."""
    snapshots, _alerts, resource = _single_group_tables()
    _run_complete_group(worker_module, resource, _ALERTS_DISABLED, None)
    return snapshots.put_item.call_args.kwargs['Item']

class TestRunEligibility:
    def test_skips_degraded_report_without_reading_tables(self, worker_module) -> None:
        resource = MagicMock()
        worker_module.dynamodb = resource

        result = worker_module.handler(_event('completed_degraded'), None)

        assert result['status'] == 'skipped'
        assert result['reason'] == 'report_not_comparable'
        assert resource.method_calls == []

    def test_skips_generate_summary_degraded_report_before_reading_tables(
        self,
        worker_module,
        summary_module,
    ) -> None:
        summary_module.SUMMARY_BUCKET = ''
        report = summary_module.handler({
            'execution_id': 'exec-1',
            'keyword_results': [{
                'status': 'success',
                'keyword': 'shared keyword',
                'timestamp': _RUN_TIMESTAMP,
                'provider_summary': {
                    'result_count': 2,
                    'by_provider': {
                        'openai': {'queries': 1, 'citations': 1},
                        'claude': {'queries': 1, 'citations': 0, 'failures': 1},
                    },
                },
                'deduplicated_citations': [],
                'crawled_results': [],
            }],
        }, None)
        event = _event()
        event['report'] = report
        resource = MagicMock()
        worker_module.dynamodb = resource

        result = worker_module.handler(event, None)

        assert report['status'] == 'completed_degraded'
        assert result == {
            'status': 'skipped',
            'reason': 'report_not_comparable',
            'groups_evaluated': 0,
            'snapshots_recorded': 0,
            'alerts_created': 0,
            'skipped_partial': 0,
        }
        assert resource.method_calls == []

    def test_skips_ambiguous_timestamp_without_reading_tables(self, worker_module) -> None:
        event = _event()
        event['report']['run_metadata']['timestamp'] = None
        resource = MagicMock()
        worker_module.dynamodb = resource

        result = worker_module.handler(event, None)

        assert result['reason'] == 'run_timestamp_missing_or_ambiguous'
        assert resource.method_calls == []

    def test_counts_touched_group_as_partial_when_active_member_was_not_processed(self, worker_module) -> None:
        members = {
            worker_module.GroupMarket('group-1', 'global'): [
                {'keyword': 'processed'},
                {'keyword': 'not processed'},
            ],
        }

        complete, skipped = worker_module._complete_groups(
            {'group-1'},
            ['processed'],
            members,
            None,
        )

        assert complete == []
        assert skipped == 1

    def test_marks_every_membership_of_shared_keyword_as_touched(self, worker_module) -> None:
        groups = [{'id': 'group-1'}, {'id': 'group-2'}]

        touched = worker_module._touched_groups({}, ['shared keyword'], _SHARED_KEYWORD_IN_TWO_GROUPS, groups)

        assert touched == {'group-1', 'group-2'}


class TestCompleteSnapshotEvaluation:
    def test_queries_shared_keyword_once_for_two_complete_groups(self, worker_module) -> None:
        snapshots = MagicMock()
        resource = fake_dynamodb_resource(by_name={'snapshots': snapshots})
        groups = [
            {'id': 'group-1', 'name': 'Group One'},
            {'id': 'group-2', 'name': 'Group Two'},
        ]
        load_answers = MagicMock(return_value={'shared keyword': _answers()})

        with (
            patch.object(worker_module, 'query_active_keywords', return_value=_SHARED_KEYWORD_IN_TWO_GROUPS),
            patch.object(worker_module, '_load_groups', return_value=groups),
            patch.object(worker_module, '_settings', return_value=_ALERTS_DISABLED),
            patch.object(worker_module, 'get_brand_config', return_value={}),
            patch.object(worker_module, '_load_run_answers', load_answers),
            patch.object(worker_module, '_previous_snapshot', return_value=None),
            patch.object(worker_module, '_notify', return_value={'status': 'not_sent'}),
            patch.object(worker_module, 'dynamodb', resource),
        ):
            result = worker_module.handler(_event(), None)

        assert load_answers.call_args.args == (['shared keyword'], _RUN_TIMESTAMP)
        assert snapshots.put_item.call_count == 2
        assert result['snapshots_recorded'] == 2
        assert result['skipped_partial'] == 0

    def test_records_snapshot_when_alerts_are_disabled(self, worker_module) -> None:
        snapshots, alerts, resource = _single_group_tables()

        result = _run_complete_group(
            worker_module,
            resource,
            _ALERTS_DISABLED,
            {'snapshot_at': '2026-09-01T10:00:00Z'},
        )

        stored_snapshot = snapshots.put_item.call_args.kwargs['Item']
        assert snapshots.put_item.call_count == 1
        assert (
            stored_snapshot['group_id'],
            stored_snapshot['snapshot_at'],
            stored_snapshot['ttl'],
        ) == ('group-1', _RUN_TIMESTAMP, 1822384800)
        assert alerts.put_item.call_count == 0
        assert result['alerts_created'] == 0

    def test_persists_nested_snapshot_metrics_as_decimals(self, worker_module) -> None:
        snapshots, _alerts, resource = _single_group_tables()

        _run_complete_group(worker_module, resource, _ALERTS_DISABLED, None)

        stored_snapshot = snapshots.put_item.call_args.kwargs['Item']
        assert (stored_snapshot['kpi_version'], stored_snapshot['kpis']['visibility_score']) == (2, Decimal('45.0'))
        assert stored_snapshot['keywords'] == [{
            'keyword': 'shared keyword',
            'mentioned': True,
            'average_position': Decimal('2.0'),
        }]

    def test_measures_the_citation_kpis_against_the_owned_domains(self, worker_module) -> None:
        assert _recorded_snapshot(worker_module)['kpis']['citation_rate'] == Decimal('100.0')

    def test_reads_the_owned_domains_from_the_brand_config_table(self, worker_module) -> None:
        _snapshots, _alerts, resource = _single_group_tables()
        brand_config = MagicMock(return_value={})

        with (
            _complete_group_run(worker_module, resource, _ALERTS_DISABLED),
            patch.object(worker_module, 'get_brand_config', brand_config),
        ):
            worker_module.handler(_event(), None)

        brand_config.assert_called_once_with('brand-config')

    def test_records_the_best_position_of_each_competitor(self, worker_module) -> None:
        assert _recorded_snapshot(worker_module)['competitors'] == [{'name': 'Rival', 'best_position': 1}]

    def test_limits_the_snapshot_competitors_to_the_configured_ones(self, worker_module) -> None:
        snapshots, _alerts, resource = _single_group_tables()
        answers = answers_from_rows([_row('openai', ('Rival', 'competitor', 1), ('Guide', 'competitor', 2))])

        with _complete_group_run(worker_module, resource, _ALERTS_DISABLED, answers=answers,
                                 brand_config={'tracked_brands': {'competitors': ['rival']}}):
            worker_module.handler(_event(), None)

        assert snapshots.put_item.call_args.kwargs['Item']['competitors'] == [{'name': 'Rival', 'best_position': 1}]

    def test_persists_exact_alert_shape_with_compared_run_timestamp(self, worker_module) -> None:
        _snapshots, alerts, resource = _single_group_tables()
        specification = {**_MENTION_RATE_DROP, 'entity': 'group-1'}

        with (
            patch.object(worker_module, '_content_change', return_value=None),
            patch.object(worker_module, 'compare_snapshots', return_value=[specification]),
        ):
            result = _run_complete_group(
                worker_module,
                resource,
                DEFAULT_ALERT_SETTINGS,
                {'snapshot_at': '2026-09-01T10:00:00Z'},
            )

        assert alerts.put_item.call_args.kwargs == {
            'Item': {
                'id': 'alert-80dedc654d7f56f1015ec86c395380bd',
                'group_id': 'group-1',
                'group_name': 'Group One',
                'market_id': 'global',
                'execution_id': 'exec-1',
                'created_at': _RUN_TIMESTAMP,
                'run_timestamp': _RUN_TIMESTAMP,
                'status': 'open',
                'acknowledged': False,
                'ttl': 1822384800,
                'type': 'mention_rate_drop',
                'severity': 'warning',
                'previous': Decimal('64.0'),
                'current': Decimal('52.0'),
                'delta': Decimal('12.0'),
                'threshold': Decimal('10.0'),
                'entity': 'group-1',
                'message': 'Mention rate fell by 12.0 points.',
            },
            'ConditionExpression': 'attribute_not_exists(id)',
        }
        assert result['alerts_created'] == 1

    def test_names_the_run_and_the_snapshotted_groups_for_the_insights_step(self, worker_module) -> None:
        _snapshots, _alerts, resource = _single_group_tables()

        result = _run_complete_group(worker_module, resource, _ALERTS_DISABLED, None)

        assert (result['run_timestamp'], result['snapshot_group_ids']) == (_RUN_TIMESTAMP, ['group-1'])

    def test_names_no_snapshotted_group_when_the_only_group_is_partial(self, worker_module) -> None:
        with _complete_group_patches(worker_module, fake_dynamodb_resource(), DEFAULT_ALERT_SETTINGS, None):
            result = worker_module.handler(_event(), None)

        assert result['snapshot_group_ids'] == []

    def test_names_no_snapshotted_group_when_no_touched_group_is_complete(self, worker_module) -> None:
        with (
            patch.object(worker_module, 'query_active_keywords', return_value=[]),
            patch.object(worker_module, '_load_groups', return_value=[{'id': 'group-1', 'name': 'Group One'}]),
            patch.object(worker_module, 'dynamodb', fake_dynamodb_resource()),
        ):
            result = worker_module.handler(_event(), None)

        assert (result['run_timestamp'], result['snapshot_group_ids']) == (_RUN_TIMESTAMP, [])

    @pytest.mark.parametrize('answers', [None, []], ids=['read failed', 'no engine answered'])
    def test_skips_group_when_a_keyword_has_no_exact_run_answers(self, worker_module, answers) -> None:
        resource = fake_dynamodb_resource()

        with _complete_group_patches(
            worker_module,
            resource,
            DEFAULT_ALERT_SETTINGS,
            answers,
        ):
            result = worker_module.handler(_event(), None)

        assert result['groups_evaluated'] == 0
        assert result['snapshots_recorded'] == 0
        assert result['skipped_partial'] == 1


class TestLoadRunAnswers:
    def test_reads_each_keywords_answers_in_the_run(self, worker_module) -> None:
        search = MagicMock()
        search.query.return_value = {'Items': [_row('openai', ('Rival', 'competitor', 1)), _row('brave')]}
        worker_module.dynamodb = fake_dynamodb_resource(by_name={'search': search})

        answers = worker_module._load_run_answers(['shared keyword'], _RUN_TIMESTAMP)

        assert [(answer.provider, answer.timestamp) for answer in answers['shared keyword']] == [('openai', _RUN_TIMESTAMP)]

    def test_marks_a_keyword_that_cannot_be_read(self, worker_module, caplog) -> None:
        search = MagicMock()
        search.query.side_effect = ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'slow down'}}, 'Query')
        worker_module.dynamodb = fake_dynamodb_resource(by_name={'search': search})

        with caplog.at_level(logging.ERROR):
            answers = worker_module._load_run_answers(['shared keyword'], _RUN_TIMESTAMP)

        assert answers == {'shared keyword': None}
        assert [record.getMessage() for record in caplog.records] == ['Exact-run answers query failed for one keyword']

    def test_reads_nothing_for_no_keywords(self, worker_module) -> None:
        assert worker_module._load_run_answers([], _RUN_TIMESTAMP) == {}


class TestIdempotentAlertWrites:
    @staticmethod
    def _put_alert_into(worker_module, table: MagicMock) -> bool:
        """Write `alert-1` through the worker with `table` as the alerts table."""
        worker_module.dynamodb = fake_dynamodb_resource(by_name={'alerts': table})
        return worker_module._put_new_alert({'id': 'alert-1'})

    def test_reports_new_alert_when_conditional_write_succeeds(self, worker_module) -> None:
        table = MagicMock()

        created = self._put_alert_into(worker_module, table)

        assert created is True
        assert table.put_item.call_args.kwargs['ConditionExpression'] == 'attribute_not_exists(id)'

    def test_reports_duplicate_when_alert_id_already_exists(self, worker_module) -> None:
        table = MagicMock()
        table.put_item.side_effect = conditional_check_failure('PutItem', message='duplicate')

        assert self._put_alert_into(worker_module, table) is False


_ALERT = {'severity': 'warning', 'message': 'Alert'}


class TestNotification:
    def test_publishes_one_plain_text_message_for_new_alerts_with_emails(self, worker_module) -> None:
        worker_module.sns = MagicMock()
        alerts = [{
            'severity': 'warning',
            'message': 'Mention rate fell.',
        }]

        result = worker_module._notify(alerts, 'exec-1', _EMAIL_SETTINGS)

        assert result == {'status': 'published'}
        assert worker_module.sns.publish.call_count == 1
        assert worker_module.sns.publish.call_args.kwargs['Message'] == (
            'Citation Analysis detected 1 new KPI alert(s) for execution exec-1.\n'
            '- [WARNING] Mention rate fell.'
        )
        assert len(worker_module.sns.publish.call_args.kwargs['Subject']) <= 100

    def test_keeps_persisted_alerts_when_notification_fails(self, worker_module) -> None:
        worker_module.sns = MagicMock()
        worker_module.sns.publish.side_effect = RuntimeError('SNS unavailable')

        result = worker_module._notify([_ALERT], 'exec-1', _EMAIL_SETTINGS)

        assert result == {'status': 'failed'}

    def test_does_not_publish_when_no_email_is_configured(self, worker_module) -> None:
        worker_module.sns = MagicMock()

        result = worker_module._notify([_ALERT], 'exec-1', DEFAULT_ALERT_SETTINGS)

        assert result == {'status': 'not_sent', 'reason': 'no_configured_emails'}
        assert worker_module.sns.publish.call_count == 0


_FULL_REPORT_KEY = 'execution-summaries/20261001100500-exec-1.json'


def _compact_event(status: str = 'completed', s3_location: str | None = f's3://{RESULTS_BUCKET}/{_FULL_REPORT_KEY}') -> dict:
    """What the workflow sends since GenerateSummary returns the compact report."""
    event = _event(status)
    report = event['report']
    report['run_metadata'] = {'timestamp': _RUN_TIMESTAMP, 'timestamps': [_RUN_TIMESTAMP], 'keyword_count': 1}
    if s3_location is not None:
        report['s3_location'] = s3_location
    return event


class TestFullReportFromS3:
    """The compact report has no per-keyword identity; the full one is read back from S3."""

    def test_evaluates_the_run_from_the_full_report_stored_at_its_s3_location(self, worker_module) -> None:
        s3 = fake_s3_objects({(RESULTS_BUCKET, _FULL_REPORT_KEY): _event()['report']})
        _snapshots, _alerts, resource = _single_group_tables()

        with (
            _complete_group_run(worker_module, resource, _ALERTS_DISABLED),
            patch.object(worker_module, 's3', s3),
        ):
            result = worker_module.handler(_compact_event(), None)

        assert (result['status'], result['snapshots_recorded']) == ('completed', 1)

    def test_skips_with_a_reason_when_the_full_report_cannot_be_read(self, worker_module) -> None:
        with patch.object(worker_module, 's3', fake_s3_objects({})):
            result = worker_module.handler(_compact_event(), None)

        assert (result['status'], result['reason']) == ('skipped', 'full_report_unreadable')

    def test_skips_with_a_reason_when_the_compact_report_names_no_s3_location(self, worker_module) -> None:
        with patch.object(worker_module, 's3', fake_s3_objects({})):
            result = worker_module.handler(_compact_event(s3_location=None), None)

        assert (result['status'], result['reason']) == ('skipped', 'full_report_location_missing')

    def test_does_not_read_s3_for_a_report_that_is_not_comparable(self, worker_module) -> None:
        s3 = fake_s3_objects({})

        with patch.object(worker_module, 's3', s3):
            result = worker_module.handler(_compact_event('completed_with_errors'), None)

        assert result['reason'] == 'report_not_comparable'
        s3.get_object.assert_not_called()


# --- Markets (2.37.0): snapshots and alerts per (group, market) ---------------------

# One group with a global keyword, a Chilean one and a Brazilian one.
_MARKET_KEYWORDS = [
    {'id': 'k1', 'keyword': 'cheap flights', 'group_ids': {'altiplano'}},
    {'id': 'k2', 'keyword': 'vuelos baratos', 'group_ids': {'altiplano'}, 'market_id': 'cl-es'},
    {'id': 'k3', 'keyword': 'passagens baratas', 'group_ids': {'altiplano'}, 'market_id': 'br-pt'},
]
_ALL_MARKETS_PROCESSED = ['cheap flights', 'vuelos baratos', 'passagens baratas']
_ALERTS_ENABLED = {**DEFAULT_ALERT_SETTINGS, 'enabled': True}


def _market_event(processed: list[str], scope: dict | None = None) -> dict:
    event = _event()
    event['execution_input'] = {'scope': scope or {'mode': 'all'}}
    event['report']['run_metadata']['processed_keywords'] = [{'keyword': keyword, 'timestamp': _RUN_TIMESTAMP} for keyword in processed]
    return event


class MarketRun:
    """One worker invocation over ``_MARKET_KEYWORDS``, recording snapshots, alerts and the lookups by key."""

    def __init__(
        self,
        module,
        event: dict,
        *,
        settings: dict = _ALERTS_DISABLED,
        specifications: list | None = None,
        brand_config: dict | None = None,
        markets: tuple[dict, ...] = (),
        answers: list[Answer] | None = None,
    ) -> None:
        self.brand_config_table = fake_table(get_item={'Item': markets_item(*markets)})
        self.snapshots, self.alerts, resource = _single_group_tables(**{'brand-config': self.brand_config_table})
        self.previous = MagicMock(return_value={'snapshot_at': '2026-09-01T10:00:00Z'})
        self.content_change = MagicMock(return_value=None)
        run_answers = {keyword: _answers() if answers is None else answers for keyword in _ALL_MARKETS_PROCESSED}
        with patch.multiple(
            module,
            query_active_keywords=MagicMock(return_value=_MARKET_KEYWORDS),
            _load_groups=MagicMock(return_value=[{'id': 'altiplano', 'name': 'Altiplano'}]),
            _settings=MagicMock(return_value=settings),
            get_brand_config=MagicMock(return_value=brand_config or {}),
            _load_run_answers=MagicMock(return_value=run_answers),
            _previous_snapshot=self.previous,
            _content_change=self.content_change,
            _notify=MagicMock(return_value={'status': 'not_sent'}),
            compare_snapshots=MagicMock(return_value=specifications or []),
            dynamodb=resource,
        ):
            self.result = module.handler(event, None)

    def snapshot_field(self, name: str) -> list:
        return [call.kwargs['Item'][name] for call in self.snapshots.put_item.call_args_list]

    def competitors_by_market(self) -> dict[str, list[str]]:
        """The competitor names of each snapshot, by its market."""
        return {
            market_id: [row['name'] for row in competitors]
            for market_id, competitors in zip(self.snapshot_field('market_id'), self.snapshot_field('competitors'), strict=True)
        }

    def alert_items(self) -> list[dict]:
        return [call.kwargs['Item'] for call in self.alerts.put_item.call_args_list]


class TestSnapshotPerMarket:
    def test_keys_the_global_snapshot_by_the_plain_group_id_and_others_by_group_and_market(self, worker_module) -> None:
        run = MarketRun(worker_module, _market_event(_ALL_MARKETS_PROCESSED))

        assert run.snapshot_field('group_id') == ['altiplano#br-pt', 'altiplano#cl-es', 'altiplano']
        assert run.snapshot_field('market_id') == ['br-pt', 'cl-es', 'global']

    def test_measures_each_market_from_its_own_keywords(self, worker_module) -> None:
        run = MarketRun(worker_module, _market_event(_ALL_MARKETS_PROCESSED))

        assert [[row['keyword'] for row in keywords] for keywords in run.snapshot_field('keywords')] == [
            ['passagens baratas'], ['vuelos baratos'], ['cheap flights'],
        ]

    def test_compares_each_market_with_its_own_previous_snapshot(self, worker_module) -> None:
        run = MarketRun(worker_module, _market_event(_ALL_MARKETS_PROCESSED))

        assert [call.args[0] for call in run.previous.call_args_list] == ['altiplano#br-pt', 'altiplano#cl-es', 'altiplano']

    def test_names_every_snapshotted_pair_and_each_group_once_for_the_insights_step(self, worker_module) -> None:
        result = MarketRun(worker_module, _market_event(_ALL_MARKETS_PROCESSED)).result

        assert (result['snapshot_group_ids'], result['snapshots_recorded']) == (['altiplano'], 3)
        assert result['snapshot_scopes'] == [
            {'group_id': 'altiplano', 'market_id': market_id} for market_id in ('br-pt', 'cl-es', 'global')
        ]

    @pytest.mark.parametrize(('scope', 'skipped'), [
        pytest.param(None, 2, id='every-market'),
        pytest.param({'mode': 'groups', 'group_ids': ['altiplano'], 'market_ids': ['cl-es']}, 0, id='scope-market'),
        pytest.param({'mode': 'all', 'market_ids': ['cl-es', 'global']}, 1, id='scope-market-not-run'),
    ])
    def test_snapshots_the_covered_market_and_counts_only_scoped_markets_as_partial(self, worker_module, scope, skipped) -> None:
        run = MarketRun(worker_module, _market_event(['vuelos baratos'], scope))

        assert (run.snapshot_field('group_id'), run.result['skipped_partial']) == (['altiplano#cl-es'], skipped)

    @pytest.mark.parametrize(('execution_input', 'market_ids'), [
        pytest.param({'scope': {'market_ids': ['cl-es']}, 'requested_scope': {'market_ids': ['global']}}, {'cl-es', 'global'}, id='both'),
        pytest.param({'scope': {'market_ids': ['cl-es']}, 'requested_scope': {'mode': 'all'}}, None, id='one-unfiltered'),
        pytest.param({'source': 'dynamodb'}, None, id='no-scope'),
    ])
    def test_reads_the_scope_markets_from_every_scope_field(self, worker_module, execution_input, market_ids) -> None:
        assert worker_module._scope_market_ids(execution_input) == market_ids


class TestTrackedCompetitorsPerMarket:
    """A snapshot's competitors are the configured ones: the brand config's list plus the market's own."""

    @pytest.fixture
    def run(self, worker_module) -> MarketRun:
        answers = answers_from_rows([
            _row('openai', ('Sky Airline', 'competitor', 1), ('Condor Sur', 'competitor', 2), ('JetPuma', 'competitor', 3)),
        ])
        return MarketRun(
            worker_module,
            _market_event(_ALL_MARKETS_PROCESSED),
            brand_config={'tracked_brands': {'competitors': ['Condor Sur']}},
            markets=(CHILE,),
            answers=answers,
        )

    def test_keeps_the_markets_extra_competitor_in_that_markets_snapshot(self, run) -> None:
        assert run.competitors_by_market()['cl-es'] == ['Sky Airline', 'Condor Sur']

    def test_keeps_only_the_configured_competitors_in_the_other_snapshots(self, run) -> None:
        by_market = run.competitors_by_market()

        assert (by_market['global'], by_market['br-pt']) == (['Condor Sur'], ['Condor Sur'])

    def test_reads_the_markets_once_from_the_brand_config_table(self, run) -> None:
        run.brand_config_table.get_item.assert_called_once_with(Key={'config_id': 'markets'})


class TestAlertsPerMarket:
    def test_stores_the_plain_group_id_and_the_market_with_a_market_aware_id(self, worker_module) -> None:
        run = MarketRun(worker_module, _market_event(['vuelos baratos']), settings=_ALERTS_ENABLED,
                        specifications=[{**_MENTION_RATE_DROP, 'entity': 'altiplano'}])

        alert = run.alert_items()[0]
        assert (alert['group_id'], alert['market_id']) == ('altiplano', 'cl-es')
        assert alert['id'] == deterministic_alert_id('exec-1', 'altiplano', 'mention_rate_drop', 'altiplano', market_id='cl-es')

    def test_raises_distinct_alerts_for_each_market_of_one_group(self, worker_module) -> None:
        run = MarketRun(worker_module, _market_event(_ALL_MARKETS_PROCESSED), settings=_ALERTS_ENABLED,
                        specifications=[{**_MENTION_RATE_DROP, 'entity': 'altiplano'}])

        assert len({alert['id'] for alert in run.alert_items()}) == 3

    def test_reads_content_changes_by_the_plain_group_id(self, worker_module) -> None:
        run = MarketRun(worker_module, _market_event(['vuelos baratos']), settings=_ALERTS_ENABLED)

        assert run.content_change.call_args.args[0] == 'altiplano'

    @pytest.mark.parametrize(('market_id', 'line'), [
        ('cl-es', '- [WARNING] [cl-es] Mention rate fell.'),
        ('global', '- [WARNING] Mention rate fell.'),
    ])
    def test_names_the_market_of_a_non_global_alert_in_the_email(self, worker_module, market_id, line) -> None:
        message = worker_module._message([{'severity': 'warning', 'message': 'Mention rate fell.', 'market_id': market_id}], 'exec-1')

        assert message.splitlines()[1] == line
