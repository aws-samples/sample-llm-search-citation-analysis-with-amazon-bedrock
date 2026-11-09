"""The ``view-job.finished`` names every side agrees on, as ``test-fixtures/view-job-events.json`` records them.

The producer (``shared.view_job_events``), the export state machine's rule and the live-events relay's route are
each pinned against this one file, so none of them can drift from the others.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_PATH = Path(__file__).resolve().parents[2] / 'test-fixtures' / 'view-job-events.json'

#: ``source`` and ``detail_type`` of the event.
VIEW_JOB_EVENT_NAMES: dict[str, Any] = json.loads(_PATH.read_text())
