"""
Wiring shared by the report handlers whose scope is required.

``/visibility``, ``/visibility/sentiment-examples``, ``/brand-mentions`` and
``/reports/group-kpis`` answer 400 without exactly one scope parameter, then
read at most ``SCOPE_KEYWORDS_CAP`` of the scope's keywords and echo the scope
next to whether the cap cut it short. ``required_report_scope`` and
``capped_scope`` are those two steps; scope parsing itself lives in
``shared.scope_params``. ``TREND_WINDOW_PARAMS`` are the ``period`` / ``days``
rules ``/trends`` and ``/reports/overview`` share.
"""

from __future__ import annotations

import functools
from collections.abc import Callable
from typing import Any

from shared.scope_params import SCOPE_KEYWORDS_CAP, SCOPE_PARAMS, ReportScope, scope_from_request
from shared.visibility_views import PERIODS

TREND_WINDOW_PARAMS: dict[str, dict[str, Any]] = {
    'period': {'type': str, 'choices': list(PERIODS), 'default': 'day'},
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 30},
}
"""``@validate`` rules for a trend window: the bucket ``period`` and the last ``days`` days (1-365, default 30)."""


def required_report_scope(
    keywords_table: Callable[[], Any],
) -> Callable[[Callable[..., dict[str, Any]]], Callable[..., dict[str, Any] | None]]:
    """Resolve the scope parameters ``@validate`` injected into a ``ReportScope`` argument.

    Place it under ``@validate({**SCOPE_QUERY_PARAMS, ...})``; the handler
    receives ``(event, context, report_scope, **other_params)``. A missing or
    malformed scope is answered with the 400 of ``scope_from_request`` without
    calling the handler. ``keywords_table`` is called per request, so tests that
    patch the handler module's ``dynamodb`` resource are honoured.
    """
    def decorate(handler: Callable[..., dict[str, Any]]) -> Callable[..., dict[str, Any] | None]:
        @functools.wraps(handler)
        def with_scope(event: dict[str, Any], context: Any, **params: Any) -> dict[str, Any] | None:
            scope_params = {name: params.pop(name, None) for name in SCOPE_PARAMS}
            report_scope, rejected = scope_from_request(event, scope_params, keywords_table(), required=True)
            if report_scope is None:
                # A required scope resolves to exactly one of (scope, None) / (None, rejection).
                return rejected
            return handler(event, context, report_scope, **params)

        return with_scope

    return decorate


def capped_scope(scope: ReportScope, cap: int = SCOPE_KEYWORDS_CAP) -> tuple[list[str], dict[str, Any]]:
    """The first ``cap`` keywords of ``scope`` and the response fields that describe them.

    The fields are ``scope`` (``ReportScope.describe()``) and
    ``keywords_truncated`` (whether ``scope`` has more keywords than were kept).
    """
    keywords = list(scope.keywords)[:cap]
    return keywords, {'scope': scope.describe(), 'keywords_truncated': len(scope.keywords) > len(keywords)}
