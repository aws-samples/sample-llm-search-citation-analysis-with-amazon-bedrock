"""Pure KPI snapshot, settings, and alert comparison helpers.

A snapshot records the KPIs of one complete group run (``shared.kpi_engine``,
``docs/kpi-definitions.md``). Snapshots carry ``kpi_version``: when the KPI
definitions change, the version moves on and the first snapshot of the new
version is a fresh baseline, never compared with one measured differently.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping
from datetime import timedelta
from typing import Any

from shared.constants import UNRANKED_SENTINEL
from shared.kpi_engine import COMPETITOR, Answer, brand_kpis, brand_table
from shared.markets import GLOBAL_MARKET_ID, market_scoped_key
from shared.string_lists import normalize_string_list
from shared.utils import parse_timestamp
from shared.visibility_score import finite_number

RETENTION_DAYS = 365
MAX_NOTIFICATION_EMAILS = 100

#: The KPI definitions snapshots are measured with; 2 = the KPIs of 2.21.0 (docs/kpi-definitions.md).
KPI_VERSION = 2

DEFAULT_ALERT_SETTINGS: dict[str, Any] = {
    'enabled': True,
    'notification_emails': [],
    'mention_rate_drop': 10.0,
    'position_loss': 1.0,
    'competitor_top_n': 3,
    'improvement_after_content_change': 5.0,
}

#: Settings stored under an earlier name: read the old name until the settings are saved again.
_LEGACY_SETTING_NAMES = {'mention_rate_drop': 'citation_rate_drop'}

_SETTINGS_FIELDS = frozenset(DEFAULT_ALERT_SETTINGS)
_EMAIL_PATTERN = re.compile(
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r'(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+'
    r'[A-Za-z]{2,63}'
)


def _metric(mapping: dict[str, Any], name: str) -> float | None:
    kpis = mapping.get('kpis')
    return finite_number(kpis.get(name)) if isinstance(kpis, dict) else None


def _valid_rank(value: Any) -> float | None:
    rank = finite_number(value)
    if rank is None or not 1 <= rank < UNRANKED_SENTINEL:
        return None
    return rank


def normalize_notification_emails(value: Any) -> tuple[list[str] | None, str | None]:
    """Validate, lowercase, and case-insensitively deduplicate SNS emails."""
    return normalize_string_list(
        value,
        limit=MAX_NOTIFICATION_EMAILS,
        normalize=_notification_email,
        type_error='notification_emails must be an array of email addresses',
        limit_error=f'notification_emails accepts at most {MAX_NOTIFICATION_EMAILS} entries',
        entry_error='notification_emails contains an invalid email address',
    )


def _notification_email(entry: str) -> str | None:
    """``entry`` trimmed and lowercased, or ``None`` when it is not a deliverable address."""
    email = entry.strip().lower()
    local = email.partition('@')[0]
    if (
        len(email) > 254
        or len(local) > 64
        or local.startswith('.')
        or local.endswith('.')
        or '..' in local
        or _EMAIL_PATTERN.fullmatch(email) is None
    ):
        return None
    return email


def _bounded_number(
    settings: dict[str, Any],
    name: str,
    minimum: float,
    maximum: float,
) -> tuple[float | None, str | None]:
    value = settings.get(name)
    if isinstance(value, (bool, str)):
        return None, f'{name} must be a finite number'
    number = finite_number(value)
    if number is None:
        return None, f'{name} must be a finite number'
    if not minimum <= number <= maximum:
        return None, f'{name} must be between {minimum:g} and {maximum:g}'
    return number, None


def validate_settings(value: Any) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """Validate the complete public alert-settings object."""
    if not isinstance(value, dict):
        return None, 'Request body must be a JSON object', 'body'
    missing = sorted(_SETTINGS_FIELDS - value.keys())
    if missing:
        return None, f"Missing required setting: {missing[0]}", missing[0]
    unexpected = sorted(value.keys() - _SETTINGS_FIELDS)
    if unexpected:
        return None, f"Unknown setting: {unexpected[0]}", unexpected[0]
    if not isinstance(value.get('enabled'), bool):
        return None, 'enabled must be true or false', 'enabled'

    emails, error = normalize_notification_emails(value.get('notification_emails'))
    if error:
        return None, error, 'notification_emails'

    validated: dict[str, Any] = {
        'enabled': value['enabled'],
        'notification_emails': emails,
    }
    for name, minimum, maximum in (
        ('mention_rate_drop', 0.1, 100.0),
        ('position_loss', 0.1, 100.0),
        ('improvement_after_content_change', 0.1, 100.0),
    ):
        number, error = _bounded_number(value, name, minimum, maximum)
        if error:
            return None, error, name
        validated[name] = number

    top_n = value.get('competitor_top_n')
    if isinstance(top_n, bool) or not isinstance(top_n, int) or not 1 <= top_n <= 10:
        return None, 'competitor_top_n must be an integer between 1 and 10', 'competitor_top_n'
    validated['competitor_top_n'] = top_n
    return validated, None, None


def _stored_setting(item: Mapping[str, Any], name: str, default: Any) -> Any:
    if name in item:
        return item[name]
    legacy = _LEGACY_SETTING_NAMES.get(name)
    return item.get(legacy, default) if legacy is not None else default


def resolve_settings(item: Any) -> dict[str, Any]:
    """Return safe native defaults overlaid with any valid stored settings."""
    if not isinstance(item, dict):
        return {**DEFAULT_ALERT_SETTINGS, 'notification_emails': []}
    candidate = {name: _stored_setting(item, name, default) for name, default in DEFAULT_ALERT_SETTINGS.items()}
    stored_top_n = finite_number(candidate['competitor_top_n'])
    if stored_top_n is not None and stored_top_n.is_integer():
        candidate['competitor_top_n'] = int(stored_top_n)
    validated, _error, _field = validate_settings(candidate)
    return validated or {**DEFAULT_ALERT_SETTINGS, 'notification_emails': []}


def ttl_for_timestamp(timestamp: str, days: int = RETENTION_DAYS) -> int:
    """Return a deterministic epoch TTL relative to a canonical run timestamp."""
    parsed = parse_timestamp(timestamp)
    if parsed is None:
        raise ValueError(f'Invalid isoformat string: {timestamp!r}')
    return int((parsed + timedelta(days=days)).timestamp())


def deterministic_alert_id(
    execution_id: str,
    group_id: str,
    alert_type: str,
    entity: str,
    *,
    market_id: str | None = None,
) -> str:
    """Stable alert identity across retries of one execution.

    A non-global ``market_id`` is part of the identity (one group raises the
    same alert in two markets); the global market keeps the pre-markets id.
    """
    raw = f'{execution_id}\0{market_scoped_key(group_id, market_id)}\0{alert_type}\0{entity.casefold()}'
    return f"alert-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]}"


def deterministic_content_change_id(group_id: str, changed_at: str) -> str:
    """Stable content-change identity for one group timestamp."""
    raw = f'{group_id}\0{changed_at}'
    return f"change-{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]}"


def _alert(
    alert_type: str,
    severity: str,
    previous: Any,
    current: Any,
    delta: Any,
    threshold: Any,
    entity: str,
    message: str,
    *,
    content_change: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = {
        'type': alert_type,
        'severity': severity,
        'previous': previous,
        'current': current,
        'delta': delta,
        'threshold': threshold,
        'entity': entity,
        'message': message,
    }
    if content_change is not None:
        result['content_change'] = content_change
    return result


def _metric_change_alerts(
    previous: dict[str, Any],
    current: dict[str, Any],
    settings: dict[str, Any],
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    previous_rate = _metric(previous, 'mention_rate')
    current_rate = _metric(current, 'mention_rate')
    rate_threshold = float(settings['mention_rate_drop'])
    if previous_rate is not None and current_rate is not None:
        drop = previous_rate - current_rate
        if drop >= rate_threshold:
            alerts.append(_alert(
                'mention_rate_drop', 'warning', previous_rate, current_rate,
                round(drop, 2), rate_threshold, str(current['group_id']),
                f'Mention rate fell by {drop:.1f} points.',
            ))

    previous_rank = _valid_rank(_metric(previous, 'average_position'))
    current_rank = _valid_rank(_metric(current, 'average_position'))
    rank_threshold = float(settings['position_loss'])
    if previous_rank is not None and current_rank is not None:
        loss = current_rank - previous_rank
        if loss >= rank_threshold:
            alerts.append(_alert(
                'position_loss', 'warning', previous_rank, current_rank,
                round(loss, 2), rank_threshold, str(current['group_id']),
                f'Average position worsened by {loss:.1f} positions.',
            ))
    return alerts


def _competitor_alerts(
    previous: dict[str, Any],
    current: dict[str, Any],
    top_n: int,
) -> list[dict[str, Any]]:
    prior = {
        str(item['name']).casefold(): _valid_rank(item.get('best_position'))
        for item in previous.get('competitors', [])
        if isinstance(item, dict) and item.get('name')
    }
    alerts: list[dict[str, Any]] = []
    for competitor in current.get('competitors', []):
        if not isinstance(competitor, dict):
            continue
        name = str(competitor.get('name', '')).strip()
        rank = _valid_rank(competitor.get('best_position'))
        previous_rank = prior.get(name.casefold())
        if name and rank is not None and rank <= top_n and (previous_rank is None or previous_rank > top_n):
            alerts.append(_alert(
                'new_competitor_top', 'warning', previous_rank, rank,
                None if previous_rank is None else round(previous_rank - rank, 2),
                top_n, name, f'{name} newly entered the top {top_n} at rank {rank:g}.',
            ))
    return alerts


def _lost_keyword_alerts(
    previous: dict[str, Any],
    current: dict[str, Any],
) -> list[dict[str, Any]]:
    prior = {
        str(item['keyword']): bool(item.get('mentioned'))
        for item in previous.get('keywords', [])
        if isinstance(item, dict) and item.get('keyword')
    }
    alerts: list[dict[str, Any]] = []
    for keyword in current.get('keywords', []):
        if not isinstance(keyword, dict):
            continue
        name = str(keyword.get('keyword', ''))
        if name and prior.get(name) is True and not keyword.get('mentioned'):
            alerts.append(_alert(
                'keyword_lost_mention', 'warning', True, False, -1, 1,
                name, f'The brand is no longer mentioned for keyword: {name}',
            ))
    return alerts


def marker_in_window(
    marker: Any,
    previous_snapshot_at: str,
    current_snapshot_at: str,
) -> bool:
    """Return whether a content marker is strictly after prior and at/before current."""
    if not isinstance(marker, dict):
        return False
    changed_at = marker.get('changed_at')
    return isinstance(changed_at, str) and previous_snapshot_at < changed_at <= current_snapshot_at


def _improvement_alert(
    previous: dict[str, Any],
    current: dict[str, Any],
    settings: dict[str, Any],
    marker: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if marker is None or not marker_in_window(
        marker,
        str(previous.get('snapshot_at', '')),
        str(current.get('snapshot_at', '')),
    ):
        return []
    before = _metric(previous, 'visibility_score')
    after = _metric(current, 'visibility_score')
    threshold = float(settings['improvement_after_content_change'])
    if before is None or after is None or after - before < threshold:
        return []
    delta = round(after - before, 2)
    changed_at = str(marker['changed_at'])
    group_id = str(marker.get('group_id') or current.get('group_id', ''))
    change = {
        'id': deterministic_content_change_id(group_id, changed_at),
        'group_id': group_id,
        'changed_at': changed_at,
        'description': str(marker.get('description', '')),
        'ttl': marker.get('ttl') or ttl_for_timestamp(changed_at),
    }
    if marker.get('url'):
        change['url'] = marker['url']
    return [_alert(
        'improvement_after_content_change', 'info', before, after, delta,
        threshold, str(current.get('group_id', '')),
        f'Visibility score improved by {delta:.1f} points after a content change.',
        content_change=change,
    )]


def snapshot_metrics(answers_by_keyword: Mapping[str, Iterable[Answer]], owned_domains: Iterable[str] = ()) -> dict[str, Any]:
    """The measured part of a group snapshot, from the answers of each of the group's keywords in one run.

    ``kpis`` pools every answer (the group report's run value); ``keywords``
    and ``competitors`` feed the lost-mention and new-competitor rules.
    """
    domains = list(owned_domains)
    per_keyword = {keyword: list(answers) for keyword, answers in answers_by_keyword.items()}
    keyword_kpis = {keyword: brand_kpis(answers, domains) for keyword, answers in per_keyword.items()}
    pooled = [answer for answers in per_keyword.values() for answer in answers]
    return {
        'kpi_version': KPI_VERSION,
        'kpis': brand_kpis(pooled, domains),
        'keywords': [
            {'keyword': keyword, 'mentioned': kpis['mentions'] > 0, 'average_position': kpis['average_position']}
            for keyword, kpis in keyword_kpis.items()
        ],
        'competitors': [
            {'name': row['name'], 'best_position': row['best_position']}
            for row in brand_table(pooled)
            if row['classification'] == COMPETITOR
        ],
    }


def compare_snapshots(
    previous: dict[str, Any] | None,
    current: dict[str, Any],
    settings: dict[str, Any],
    *,
    content_change: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Evaluate all five rules for two complete snapshots measured with the same KPI definitions."""
    if previous is None or not settings.get('enabled'):
        return []
    if previous.get('kpi_version') != KPI_VERSION or current.get('kpi_version') != KPI_VERSION:
        return []
    alerts = _metric_change_alerts(previous, current, settings)
    alerts.extend(_competitor_alerts(previous, current, int(settings['competitor_top_n'])))
    alerts.extend(_lost_keyword_alerts(previous, current))
    alerts.extend(_improvement_alert(previous, current, settings, content_change))
    return alerts


def build_alert_item(
    specification: dict[str, Any],
    *,
    execution_id: str,
    group_id: str,
    group_name: str,
    created_at: str,
    run_timestamp: str,
    market_id: str = GLOBAL_MARKET_ID,
) -> dict[str, Any]:
    """Add durable identity/status metadata to a pure alert specification.

    ``group_id`` is the plain keyword group id and ``market_id`` the market the
    group's snapshot covers (``'global'`` for the keywords without one).
    """
    entity = str(specification.get('entity', ''))
    return {
        'id': deterministic_alert_id(
            execution_id,
            group_id,
            str(specification['type']),
            entity,
            market_id=market_id,
        ),
        'group_id': group_id,
        'group_name': group_name,
        'market_id': market_id,
        'execution_id': execution_id,
        'created_at': created_at,
        'run_timestamp': run_timestamp,
        'status': 'open',
        'acknowledged': False,
        'ttl': ttl_for_timestamp(created_at),
        **specification,
    }
