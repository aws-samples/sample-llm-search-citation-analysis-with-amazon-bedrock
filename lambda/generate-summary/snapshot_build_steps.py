"""
The steps of the distributed scope snapshot build (``shared.scope_snapshot_dist``), one Lambda invocation each.

The ``CitationAnalysis-ScopeSnapshotBuild`` state machine invokes the ScopeSnapshotWorker Lambda (this
package, the GenerateSummary code) with:

- ``{"action": "snapshot_build_plan", "reason": ...}`` -> ``{build_id, bucket, units_key, units, scopes, reason}``;
- ``{"action": "snapshot_build_unit", "build_id": ..., "unit": n}`` (one Distributed Map item) -> a small summary;
- ``{"action": "snapshot_build_series", "build_id": ..., "batch": b, "turn": t}`` (one item of the series Map)
  -> ``{done, turn: t + 1, ...}``; the item runs it again while ``done`` is false; turn ``MAX_SERIES_TURNS`` fails it;
- ``{"action": "snapshot_build_rollup_shard", "build_id": ..., "shard": s}`` / ``{"action": "snapshot_build_rollup_merge",
  "build_id": ..., "merge": m}``: one item of the citation rollup's shard and merge Maps (``shared.citation_rollup_dist``);
- ``{"action": "snapshot_build_publish", "build_id": ..., "reason": ...}`` -> the build summary (the snapshots, then the rollup).

Every step runs under a deadline ``BUILD_MARGIN_SECONDS`` before the Lambda's timeout; a series turn stops
after ``SERIES_TURN_SECONDS`` (its CPU stays under ~600 s at one vCPU) and saves what it built.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any, Final

from scope_snapshot_action import BUILD_MARGIN_SECONDS, snapshot_sources

from shared.citation_rollup_dist import MERGE_ACTION, SHARD_ACTION
from shared.request_deadline import Deadline, activate_deadline, budget_from_context, clear_request_deadline
from shared.scope_snapshot_dist import (
    PLAN_ACTION,
    PUBLISH_ACTION,
    SERIES_ACTION,
    UNIT_ACTION,
    plan_build,
    publish_build,
    run_rollup_merge_step,
    run_rollup_shard_step,
    run_series,
    run_unit,
)
from shared.snapshot_store import SnapshotBuildIncomplete

logger = logging.getLogger(__name__)

STEP_ACTIONS: Final = (PLAN_ACTION, UNIT_ACTION, SERIES_ACTION, SHARD_ACTION, MERGE_ACTION, PUBLISH_ACTION)
#: Wall seconds a series turn runs before it saves and answers ``done: false``.
SERIES_TURN_SECONDS = 480.0
#: Series turns one build may take (a full rebuild of every scope at 10x takes a few).
MAX_SERIES_TURNS = 40


def _series(event: Mapping[str, Any], context: Any, build_id: str) -> dict[str, Any]:
    turn = int(event.get('turn') or 0) + 1
    if turn > MAX_SERIES_TURNS:
        raise SnapshotBuildIncomplete(f'The series of the build {build_id} took more than {MAX_SERIES_TURNS} turns')
    deadline = Deadline(min(SERIES_TURN_SECONDS, budget_from_context(context, BUILD_MARGIN_SECONDS)))
    return {**run_series(snapshot_sources(deadline, event), build_id, int(event.get('batch') or 0), deadline), 'turn': turn}


def build_step(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Run the step ``event['action']`` of a distributed build; what the state machine reads next."""
    action = event.get('action')
    deadline = Deadline(budget_from_context(context, BUILD_MARGIN_SECONDS))
    activate_deadline(deadline)
    try:
        if action == PLAN_ACTION:
            return {**plan_build(snapshot_sources(deadline, event)), 'reason': event.get('reason')}
        build_id = str(event.get('build_id') or '')
        if not build_id:
            raise SnapshotBuildIncomplete(f'{action} needs a build_id')
        if action == UNIT_ACTION:
            return run_unit(snapshot_sources(deadline, event), build_id, int(event['unit']))
        if action == SERIES_ACTION:
            return _series(event, context, build_id)
        if action == SHARD_ACTION:
            return run_rollup_shard_step(snapshot_sources(deadline, event), build_id, int(event['shard']))
        if action == MERGE_ACTION:
            return run_rollup_merge_step(snapshot_sources(deadline, event), build_id, int(event['merge']))
        if action != PUBLISH_ACTION:
            raise SnapshotBuildIncomplete(f'Not a scope snapshot build step: {action!r}')
        summary = publish_build(snapshot_sources(deadline, event), build_id)
        logger.info('Scope snapshots (distributed): %s', summary)
        return summary
    finally:
        clear_request_deadline()


__all__ = ['MAX_SERIES_TURNS', 'SERIES_TURN_SECONDS', 'STEP_ACTIONS', 'build_step']
