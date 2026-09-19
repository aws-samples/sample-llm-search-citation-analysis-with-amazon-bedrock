"""Pure comparison and validation tests for KPI alerts."""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal

import pytest

from shared.kpi_alerts import (
    DEFAULT_ALERT_SETTINGS,
    compare_snapshots,
    deterministic_alert_id,
    deterministic_content_change_id,
    marker_in_window,
    resolve_settings,
    ttl_for_timestamp,
    validate_settings,
)

PREVIOUS_TIMESTAMP = '2026-09-01T10:00:00Z'
CURRENT_TIMESTAMP = '2026-09-02T10:00:00Z'


def _snapshot() -> dict:
    return {
        'group_id': 'group-1',
        'snapshot_at': PREVIOUS_TIMESTAMP,
        'summary': {
            'coverage_rate': 80.0,
            'mean_rank': 2.0,
            'first_party_avg_score': 50.0,
        },
        'keywords': [
            {'keyword': 'hotel spa', 'first_party_mentioned': True},
            {'keyword': 'hotel beach', 'first_party_mentioned': False},
        ],
        'competitors': [
            {'name': 'Old Rival', 'best_rank': 2},
            {'name': 'Far Rival', 'best_rank': 7},
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


class TestCitationRateDrop:
    def test_creates_warning_when_drop_equals_threshold(self) -> None:
        current = _current()
        current['summary']['coverage_rate'] = 70.0

        alerts = compare_snapshots(_snapshot(), current, _settings())

        assert _of_type(alerts, 'citation_rate_drop') == [{
            'type': 'citation_rate_drop',
            'severity': 'warning',
            'previous': 80.0,
            'current': 70.0,
            'delta': 10.0,
            'threshold': 10.0,
            'entity': 'group-1',
            'message': 'Citation coverage fell by 10.0 percentage points.',
        }]

    def test_creates_no_warning_when_drop_is_below_threshold(self) -> None:
        current = _current()
        current['summary']['coverage_rate'] = 70.1

        alerts = compare_snapshots(_snapshot(), current, _settings())

        assert _of_type(alerts, 'citation_rate_drop') == []


class TestPositionLoss:
    def test_creates_warning_when_mean_rank_loss_equals_threshold(self) -> None:
        current = _current()
        current['summary']['mean_rank'] = 3.0

        alert = _of_type(compare_snapshots(_snapshot(), current, _settings()), 'position_loss')[0]

        assert alert['previous'] == 2.0
        assert alert['current'] == 3.0
        assert alert['delta'] == 1.0
        assert alert['threshold'] == 1.0

    @pytest.mark.parametrize('invalid_rank', [None, 0, 999, 'not-a-rank'])
    def test_creates_no_warning_when_current_rank_is_invalid(self, invalid_rank: object) -> None:
        current = _current()
        current['summary']['mean_rank'] = invalid_rank

        alerts = compare_snapshots(_snapshot(), current, _settings())

        assert _of_type(alerts, 'position_loss') == []


class TestNewCompetitorTop:
    def test_creates_warning_for_each_competitor_newly_entering_top_n(self) -> None:
        current = _current()
        current['competitors'] = [
            {'name': 'Far Rival', 'best_rank': 3},
            {'name': 'New Rival', 'best_rank': 1},
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
        current['keywords'][0]['first_party_mentioned'] = False

        alerts = _of_type(compare_snapshots(_snapshot(), current, _settings()), 'keyword_lost_mention')

        assert alerts == [{
            'type': 'keyword_lost_mention',
            'severity': 'warning',
            'previous': True,
            'current': False,
            'delta': -1,
            'threshold': 1,
            'entity': 'hotel spa',
            'message': 'First-party mention was lost for keyword: hotel spa',
        }]


class TestImprovementAfterContentChange:
    def test_creates_info_when_improvement_equals_threshold_inside_marker_window(self) -> None:
        current = _current()
        current['summary']['first_party_avg_score'] = 55.0
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

    @pytest.mark.parametrize('changed_at', [PREVIOUS_TIMESTAMP, '2026-09-02T10:00:01Z'])
    def test_creates_no_info_when_marker_is_outside_window(self, changed_at: str) -> None:
        current = _current()
        current['summary']['first_party_avg_score'] = 60.0
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
        current['summary']['coverage_rate'] = 0.0

        assert compare_snapshots(_snapshot(), current, _settings(enabled=False)) == []


class TestSettingsValidation:
    def test_normalizes_and_deduplicates_valid_emails(self) -> None:
        candidate = _settings(notification_emails=[' Ops+KPI@Example.COM ', 'ops+kpi@example.com'])

        settings, error, field = validate_settings(candidate)

        assert error is None
        assert field is None
        assert settings['notification_emails'] == ['ops+kpi@example.com']

    def test_normalizes_dynamodb_numbers_in_stored_settings(self) -> None:
        stored = {
            **_settings(),
            'citation_rate_drop': Decimal('12.5'),
            'position_loss': Decimal('2'),
            'competitor_top_n': Decimal('4'),
            'improvement_after_content_change': Decimal('7.5'),
        }

        resolved = resolve_settings(stored)

        assert resolved['citation_rate_drop'] == 12.5
        assert resolved['position_loss'] == 2.0
        assert resolved['competitor_top_n'] == 4
        assert resolved['improvement_after_content_change'] == 7.5

    def test_accepts_decimal_thresholds_at_inclusive_bounds(self) -> None:
        candidate = _settings(
            citation_rate_drop=Decimal('0.1'),
            position_loss=Decimal('2.5'),
            competitor_top_n=10,
            improvement_after_content_change=Decimal('100.0'),
        )

        settings, error, field = validate_settings(candidate)

        assert settings == _settings(
            citation_rate_drop=0.1,
            position_loss=2.5,
            competitor_top_n=10,
            improvement_after_content_change=100.0,
        )
        assert error is None
        assert field is None

    @pytest.mark.parametrize(
        'field_name',
        [
            'citation_rate_drop',
            'position_loss',
            'improvement_after_content_change',
        ],
    )
    def test_rejects_boolean_numeric_thresholds(self, field_name: str) -> None:
        settings, error, field = validate_settings(_settings(**{field_name: True}))

        assert settings is None
        assert error == f'{field_name} must be a finite number'
        assert field == field_name

    @pytest.mark.parametrize('email', ['', 'missing-at.example.com', 'a@localhost', 'two@@example.com'])
    def test_rejects_invalid_email_addresses(self, email: str) -> None:
        settings, error, field = validate_settings(_settings(notification_emails=[email]))

        assert settings is None
        assert error == 'notification_emails contains an invalid email address'
        assert field == 'notification_emails'

    @pytest.mark.parametrize(
        ('field_name', 'value'),
        [
            ('citation_rate_drop', 0),
            ('citation_rate_drop', 100.1),
            ('citation_rate_drop', float('nan')),
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
