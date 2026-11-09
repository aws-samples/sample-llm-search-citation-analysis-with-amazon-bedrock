"""
SEO jobs Lambda (``CitationAnalysis-SeoJobs``): the steps of every SEO state machine.

A state machine task invokes it with ``{"step": "<feature>.<name>", ...}``.
Each feature keeps its steps in a sibling module ``jobs_<feature>.py`` that
exports ``STEPS: dict[str, Callable[[dict], dict]]`` keyed by the full step
name; this handler finds every such module next to it and calls the step with
the whole event. An unknown step raises, so the state machine fails loudly
instead of silently skipping work. Steps must return small JSON objects
(Step Functions caps state at 256 KiB): ids and counts, never result lists.
"""

from __future__ import annotations

import importlib
import logging
import sys
from collections.abc import Callable, Mapping
from functools import cache
from pathlib import Path
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')
sys.path.insert(0, str(Path(__file__).resolve().parent))

from shared.change_events import SEO_JOB_CHANGED, publish_change

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

Step = Callable[[dict[str, Any]], dict[str, Any]]

#: The id an open SEO view watches, by feature (``seo-job.changed``, ``shared.change_events``): a rank tracker's
#: latest run, a local SEO job, a Lighthouse run, a site audit. The domain and backlink snapshots have no such view.
WATCHED_JOB_IDS: Mapping[str, str] = {'rank': 'tracker_id', 'local': 'job_id', 'lighthouse': 'run_id', 'audit': 'audit_id'}


class UnknownStepError(KeyError):
    """The event names a step no ``jobs_*.py`` module defines."""


@cache
def steps() -> Mapping[str, Step]:
    """Every step of every ``jobs_<feature>.py`` module next to this file."""
    registry: dict[str, Step] = {}
    for path in sorted(Path(__file__).resolve().parent.glob('jobs_*.py')):
        module = importlib.import_module(path.stem)
        for name, step in getattr(module, 'STEPS', {}).items():
            if name in registry:
                raise ValueError(f'step {name!r} is defined twice')
            registry[name] = step
    return registry


def watched_job(name: str, event: Mapping[str, Any]) -> dict[str, str] | None:
    """The ``{feature, id}`` a dashboard view watches for step ``name``, or ``None`` for a feature no view watches."""
    feature = name.split('.', 1)[0]
    key = WATCHED_JOB_IDS.get(feature)
    if key is None:
        return None
    state = event.get('state')
    value = event.get(key) if key in event else (state.get(key) if isinstance(state, Mapping) else None)
    return {'feature': feature, 'id': value} if isinstance(value, str) and value else None


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Run the step the event names, then announce that its job may have changed (a raised step included)."""
    name = event.get('step')
    step = steps().get(name) if isinstance(name, str) else None
    if step is None or not isinstance(name, str):
        raise UnknownStepError(f'unknown SEO job step {name!r}')
    logger.info('seo-jobs step %s', name)
    try:
        return step(event)
    finally:
        job = watched_job(name, event)
        if job is not None:
            publish_change(SEO_JOB_CHANGED, job)
