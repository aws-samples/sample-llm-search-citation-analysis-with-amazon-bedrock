"""Pure comparison and validation tests for KPI alerts."""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal

import pytest

from shared.kpi_alerts import (
    DEFAULT_ALERT_SETTINGS,
    KPI_VERSION,
    compare_snapshots,
    deterministic_alert_id,
    deterministic_content_change_id,
    marker_in_window,
    resolve_settings,
    snapshot_metrics,
    ttl_for_timestamp,
    validate_settings,
)
from shared.kpi_engine import answers_from_rows
from testing.search_result_fixtures import successful_answer_row

PREVIOUS_TIMESTAMP = '2026-09-01T10:00:00Z'
CURRENT_TIMESTAMP = '2026-09-02T10:00:00Z'
#: 254 characters with a 64-character local part: the longest deliverable address (RFC 5321).
LONGEST_EMAIL = f'{"a" * 64}@{"b" * 63}.{"c" * 63}.{"d" * 57}.com'
#: 255 characters, every label within the pattern's 63-character limit.
TOO_LONG_EMAIL = f'{"a" * 64}@{"b" * 63}.{"c" * 63}.{"d" * 58}.com'


def _snapshot() -> dict:
    return {
        'group_id': 'group-1',
        'snapshot_at': PREVIOUS_TIMESTAMP,
        'kpi_version': KPI_VERSION,
        'kpis': {
            'mention_rate': 80.0,
            'average_position': 2.0,
            'visibility_score': 50.0,
        },
        'keywords': [
            {'keyword': 'hotel spa', 'mentioned': True},
            {'keyword': 'hotel beach', 'mentioned': False},
        ],
        'competitors': [
            {'name': 'Old Rival', 'best_position': 2},
            {'name': 'Far Rival', 'best_position': 7},
        ],
    }


def _current() -> dict:
    current = deepcopy(_snapshot())
    current['snapshot_at'] = CURRENT_TIMESTAMP
    return current


def _settings(**overrides: object) -> dict:
    return {**DEFAULT_ALERT_SETTINGS, **overrides}


def _of_type(alerts: list[dict], alert_type: str) -> list[dict]:
    return [alert for alert in alerts if alert['type'] == alert_type]


class TestMentionRateDrop:
    def test_creates_warning_when_drop_equals_threshold(self) -> None:
        current = _current()
        current['kpis']['mention_rate'] = 70.0

        alerts = compare_snapshots(_snapshot(), current, _settings())

        assert _of_type(alerts, 'mention_rate_drop') == [{
            'type': 'mention_rate_drop',
            'severity': 'warning',
            'previous': 80.0,
            'current': 70.0,
            'delta': 10.0,
            'threshold': 10.0,
            'entity': 'group-1',
            'message': 'Mention rate fell by 10.0 points.',
        }]

    def test_creates_no_warning_when_drop_is_below_threshold(self) -> None:
        current = _current()
        current['kpis']['mention_rate'] = 70.1

        alerts = compare_snapshots(_snapshot(), current, _settings())

        assert _of_type(alerts, 'mention_rate_drop') == []

    def test_rounds_the_drop_to_hundredths(self) -> None:
        current = _current()
        current['kpis']['mention_rate'] = 69.9876

        alert = _of_type(compare_snapshots(_snapshot(), current, _settings()), 'mention_rate_drop')[0]

        assert alert['delta'] == 10.01

    @pytest.mark.parametrize('side', ['previous', 'current'])
    def test_creates_no_warning_when_either_run_has_no_mention_rate(self, side: str) -> None:
        previous = _snapshot()
        current = _current()
        current['kpis']['mention_rate'] = 0.0
        {'previous': previous, 'current': current}[side]['kpis']['mention_rate'] = None

        assert _of_type(compare_snapshots(previous, current, _settings()), 'mention_rate_drop') == []


class TestPositionLoss:
    def test_creates_warning_when_average_position_loss_equals_threshold(self) -> None:
        current = _current()
        current['kpis']['average_position'] = 3.0

        alert = _of_type(compare_snapshots(_snapshot(), current, _settings()), 'position_loss')[0]

        assert (alert['previous'], alert['current'], alert['delta'], alert['threshold']) == (2.0, 3.0, 1.0, 1.0)
        assert alert['message'] == 'Average position worsened by 1.0 positions.'

    def test_rounds_the_position_loss_to_hundredths(self) -> None:
        current = _current()
        current['kpis']['average_position'] = 3.3333

        alert = _of_type(compare_snapshots(_snapshot(), current, _settings()), 'position_loss')[0]

        assert alert['delta'] == 1.33

    @pytest.mark.parametrize('invalid_rank', [None, 0, 999, 'not-a-rank'])
    def test_creates_no_warning_when_current_rank_is_invalid(self, invalid_rank: object) -> None:
        current = _current()
        current['kpis']['average_position'] = invalid_rank

        alerts = compare_snapshots(_snapshot(), current, _settings())

        assert _of_type(alerts, 'position_loss') == []


class TestNewCompetitorTop:
    def test_creates_warning_for_each_competitor_newly_entering_top_n(self) -> None:
        current = _current()
        current['competitors'] = [
            {'name': 'Far Rival', 'best_position': 3},
            {'name': 'New Rival', 'best_position': 1},
        ]

        alerts = _of_type(compare_snapshots(_snapshot(), current, _settings()), 'new_competitor_top')

        assert [(alert['entity'], alert['previous'], alert['current']) for alert in alerts] == [
            ('Far Rival', 7.0, 3.0),
            ('New Rival', None, 1.0),
        ]

    def test_creates_no_warning_for_competitor_already_in_top_n(self) -> None:
        alerts = compare_snapshots(_snapshot(), _current(), _settings())

        assert _of_type(alerts, 'new_competitor_top') == []


class TestKeywordLostMention:
    def test_creates_warning_for_each_previously_mentioned_active_keyword_now_missing(self) -> None:
        current = _current()
        current['keywords'][0]['mentioned'] = False

        alerts = _of_type(compare_snapshots(_snapshot(), current, _settings()), 'keyword_lost_mention')

        assert alerts == [{
            'type': 'keyword_lost_mention',
            'severity': 'warning',
            'previous': True,
            'current': False,
            'delta': -1,
            'threshold': 1,
            'entity': 'hotel spa',
            'message': 'The brand is no longer mentioned for keyword: hotel spa',
        }]

    def test_creates_no_warning_while_the_keyword_stays_mentioned(self) -> None:
        assert _of_type(compare_snapshots(_snapshot(), _current(), _settings()), 'keyword_lost_mention') == []


class TestImprovementAfterContentChange:
    def test_creates_info_when_improvement_equals_threshold_inside_marker_window(self) -> None:
        current = _current()
        current['kpis']['visibility_score'] = 55.0
        marker = {
            'id': deterministic_content_change_id('group-1', '2026-09-01T12:00:00Z'),
            'group_id': 'group-1',
            'changed_at': '2026-09-01T12:00:00Z',
            'description': 'Published spa landing page',
            'url': 'https://example.com/spa',
            'ttl': ttl_for_timestamp('2026-09-01T12:00:00Z'),
        }

        alert = _of_type(
            compare_snapshots(_snapshot(), current, _settings(), content_change=marker),
            'improvement_after_content_change',
        )[0]

        assert alert['severity'] == 'info'
        assert alert['delta'] == 5.0
        assert alert['content_change'] == marker
        assert alert['message'] == 'Visibility score improved by 5.0 points after a content change.'

    @pytest.mark.parametrize('changed_at', [PREVIOUS_TIMESTAMP, '2026-09-02T10:00:01Z'])
    def test_creates_no_info_when_marker_is_outside_window(self, changed_at: str) -> None:
        current = _current()
        current['kpis']['visibility_score'] = 60.0
        marker = {'changed_at': changed_at, 'description': 'Update'}

        alerts = compare_snapshots(_snapshot(), current, _settings(), content_change=marker)

        assert _of_type(alerts, 'improvement_after_content_change') == []

    def test_accepts_marker_at_current_run_boundary(self) -> None:
        marker = {'changed_at': CURRENT_TIMESTAMP}

        assert marker_in_window(marker, PREVIOUS_TIMESTAMP, CURRENT_TIMESTAMP) is True


class TestBaselineAndDisabledSettings:
    def test_first_snapshot_creates_no_alerts(self) -> None:
        assert compare_snapshots(None, _current(), _settings()) == []

    def test_disabled_settings_create_no_alerts(self) -> None:
        current = _current()
        current['kpis']['mention_rate'] = 0.0

        assert compare_snapshots(_snapshot(), current, _settings(enabled=False)) == []

    @pytest.mark.parametrize('stale', ['previous', 'current'])
    def test_snapshots_measured_with_other_kpi_definitions_create_no_alerts(self, stale: str) -> None:
        """The first snapshot after a KPI change is a new baseline."""
        previous = _snapshot()
        current = _current()
        current['kpis']['mention_rate'] = 0.0
        current['keywords'][0]['mentioned'] = False
        {'previous': previous, 'current': current}[stale]['kpi_version'] = KPI_VERSION - 1

        assert compare_snapshots(previous, current, _settings()) == []

    def test_a_snapshot_without_a_kpi_version_is_not_compared(self) -> None:
        previous = _snapshot()
        del previous['kpi_version']
        current = _current()
        current['kpis']['mention_rate'] = 0.0

        assert compare_snapshots(previous, current, _settings()) == []


def _row(keyword: str, *brands: tuple[str, str, int], provider: str = 'openai') -> dict:
    return successful_answer_row(
        keyword=keyword,
        timestamp=CURRENT_TIMESTAMP,
        provider=provider,
        brands=brands,
        citations=['https://hotel-sol.com/spa'],
    )


class TestSnapshotMetrics:
    ANSWERS = {
        'hotel spa': answers_from_rows([
            _row('hotel spa', ('Hotel Sol', 'first_party', 2), ('Rival', 'competitor', 1)),
            _row('hotel spa', ('Rival', 'competitor', 3), provider='gemini'),
        ]),
        'hotel beach': answers_from_rows([_row('hotel beach', ('Rival', 'competitor', 2), ('Guide', 'other', 1))]),
    }

    def test_measures_snapshots_with_the_kpi_definitions_of_2_21(self) -> None:
        assert KPI_VERSION == 2

    def test_records_the_kpi_version(self) -> None:
        assert snapshot_metrics(self.ANSWERS)['kpi_version'] == KPI_VERSION

    def test_pools_the_group_kpis_over_every_answer(self) -> None:
        kpis = snapshot_metrics(self.ANSWERS, ['hotel-sol.com'])['kpis']

        assert (kpis['answers'], kpis['mention_rate'], kpis['average_position'], kpis['citation_rate']) == (3, 33.3, 2.0, 100.0)

    def test_records_whether_each_keyword_mentions_the_brand(self) -> None:
        assert snapshot_metrics(self.ANSWERS)['keywords'] == [
            {'keyword': 'hotel spa', 'mentioned': True, 'average_position': 2.0},
            {'keyword': 'hotel beach', 'mentioned': False, 'average_position': None},
        ]

    def test_records_the_best_position_of_each_competitor_only(self) -> None:
        assert snapshot_metrics(self.ANSWERS)['competitors'] == [{'name': 'Rival', 'best_position': 1}]


class TestSettingsValidation:
    def test_normalizes_and_deduplicates_valid_emails(self) -> None:
        candidate = _settings(notification_emails=[' Ops+KPI@Example.COM ', 'ops+kpi@example.com'])

        settings, error, field = validate_settings(candidate)

        assert error is None
        assert field is None
        assert settings is not None
        assert settings['notification_emails'] == ['ops+kpi@example.com']

    def test_normalizes_dynamodb_numbers_in_stored_settings(self) -> None:
        stored = {
            **_settings(),
            'mention_rate_drop': Decimal('12.5'),
            'position_loss': Decimal(2),
            'competitor_top_n': Decimal(4),
            'improvement_after_content_change': Decimal('7.5'),
        }

        resolved = resolve_settings(stored)

        assert resolved['mention_rate_drop'] == 12.5
        assert resolved['position_loss'] == 2.0
        assert resolved['competitor_top_n'] == 4
        assert resolved['improvement_after_content_change'] == 7.5

    def test_reads_the_mention_rate_drop_stored_under_its_former_name(self) -> None:
        stored = {name: value for name, value in _settings().items() if name != 'mention_rate_drop'}

        assert resolve_settings({**stored, 'citation_rate_drop': Decimal(15)})['mention_rate_drop'] == 15.0

    def test_prefers_the_current_name_over_the_former_one(self) -> None:
        stored = {**_settings(mention_rate_drop=Decimal(20)), 'citation_rate_drop': Decimal(15)}

        assert resolve_settings(stored)['mention_rate_drop'] == 20.0

    def test_defaults_a_setting_stored_under_neither_name(self) -> None:
        stored = {name: value for name, value in _settings().items() if name != 'position_loss'}

        assert resolve_settings(stored)['position_loss'] == 1.0

    def test_accepts_decimal_thresholds_at_inclusive_bounds(self) -> None:
        candidate = _settings(
            mention_rate_drop=Decimal('0.1'),
            position_loss=Decimal('2.5'),
            competitor_top_n=10,
            improvement_after_content_change=Decimal('100.0'),
        )

        settings, error, field = validate_settings(candidate)

        assert settings == _settings(
            mention_rate_drop=0.1,
            position_loss=2.5,
            competitor_top_n=10,
            improvement_after_content_change=100.0,
        )
        assert error is None
        assert field is None

    @pytest.mark.parametrize(
        'field_name',
        [
            'mention_rate_drop',
            'position_loss',
            'improvement_after_content_change',
        ],
    )
    def test_rejects_boolean_numeric_thresholds(self, field_name: str) -> None:
        settings, error, field = validate_settings(_settings(**{field_name: True}))

        assert settings is None
        assert error == f'{field_name} must be a finite number'
        assert field == field_name

    def test_accepts_an_email_at_the_address_and_local_part_length_limits(self) -> None:
        settings, error, _field = validate_settings(_settings(notification_emails=[LONGEST_EMAIL]))

        assert (len(LONGEST_EMAIL), len(LONGEST_EMAIL.partition('@')[0])) == (254, 64)
        assert error is None
        assert settings is not None
        assert settings['notification_emails'] == [LONGEST_EMAIL]

    @pytest.mark.parametrize(
        ('emails', 'message'),
        [
            ('ops@example.com', 'notification_emails must be an array of email addresses'),
            ([7], 'notification_emails must be an array of email addresses'),
            ([f'ops{index}@example.com' for index in range(101)], 'notification_emails accepts at most 100 entries'),
        ],
    )
    def test_rejects_malformed_email_lists_with_their_message(self, emails: object, message: str) -> None:
        assert validate_settings(_settings(notification_emails=emails)) == (None, message, 'notification_emails')

    @pytest.mark.parametrize(
        'email',
        [
            '',
            'missing-at.example.com',
            'a@localhost',
            'two@@example.com',
            '.alice@example.com',
            'alice.@example.com',
            'al..ice@example.com',
            f'{"a" * 65}@example.com',
            TOO_LONG_EMAIL,
        ],
    )
    def test_rejects_invalid_email_addresses(self, email: str) -> None:
        settings, error, field = validate_settings(_settings(notification_emails=[email]))

        assert settings is None
        assert error == 'notification_emails contains an invalid email address'
        assert field == 'notification_emails'

    @pytest.mark.parametrize(
        ('field_name', 'value'),
        [
            ('mention_rate_drop', 0),
            ('mention_rate_drop', 100.1),
            ('mention_rate_drop', float('nan')),
            ('position_loss', 0),
            ('position_loss', 100.1),
            ('position_loss', float('inf')),
            ('position_loss', '2.5'),
            ('improvement_after_content_change', 0),
            ('improvement_after_content_change', 100.1),
            ('improvement_after_content_change', float('-inf')),
            ('competitor_top_n', 0),
            ('competitor_top_n', 11),
            ('competitor_top_n', 1.5),
            ('competitor_top_n', True),
        ],
    )
    def test_rejects_thresholds_outside_bounds(self, field_name: str, value: object) -> None:
        settings, error, field = validate_settings(_settings(**{field_name: value}))

        assert settings is None
        assert error is not None
        assert field == field_name


class TestDurableIdentityAndRetention:
    def test_builds_stable_alert_id_for_same_entity(self) -> None:
        first = deterministic_alert_id('exec-1', 'group-1', 'position_loss', 'Hotel Spa')
        second = deterministic_alert_id('exec-1', 'group-1', 'position_loss', 'hotel spa')

        assert first == second
        assert first == 'alert-4d1525a29a5b351baf92933801f2400d'

    def test_changes_alert_id_for_different_execution(self) -> None:
        first = deterministic_alert_id('exec-1', 'group-1', 'position_loss', 'hotel spa')
        second = deterministic_alert_id('exec-2', 'group-1', 'position_loss', 'hotel spa')

        assert first != second

    def test_builds_stable_content_change_id_for_group_timestamp(self) -> None:
        first = deterministic_content_change_id('group-1', '2026-10-01T10:00:00Z')
        second = deterministic_content_change_id('group-1', '2026-10-01T10:00:00Z')

        assert first == second
        assert first == 'change-9a43216f26b0ec30a5155fa455915c49'

    def test_changes_content_change_id_for_different_timestamp(self) -> None:
        first = deterministic_content_change_id('group-1', '2026-10-01T10:00:00Z')
        second = deterministic_content_change_id('group-1', '2026-10-02T10:00:00Z')

        assert first != second

    def test_expires_snapshot_exactly_365_days_after_run(self) -> None:
        assert ttl_for_timestamp('2026-01-01T00:00:00Z') == 1798761600

    def test_refuses_a_ttl_for_a_timestamp_that_is_not_iso_8601(self) -> None:
        with pytest.raises(ValueError, match=r"^Invalid isoformat string: 'yesterday'$"):
            ttl_for_timestamp('yesterday')
