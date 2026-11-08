"""
Per-keyword partial answers of the scoped views (design 2.45.0 §2.1): the registry.

``PARTIALS`` names every partial module; each one follows
``shared.partial_contract.PartialModule`` (``build(rows, config)``,
``merge(acc, part)``, ``PREVIOUS_RUN``). The KeywordLatest writer builds every
registered partial for a keyword's run and stores it under
``latest.parts[<name>]``; the artifact builders merge the ones they need.

The modules are flat (``shared/partial_<name>.py``), not a package: the layer
builds ship only the top level of ``lambda/shared/``, and the synth-time
staleness check compares only that level.

The registry is fixed by the base commit: a track fills in its own module and
never edits this file.
"""

from __future__ import annotations

from shared import partial_actions, partial_insights, partial_kpi, partial_mentions
from shared.partial_contract import PartialModule

PARTIALS: dict[str, PartialModule] = {
    'kpi': partial_kpi,
    'mentions': partial_mentions,
    'actions': partial_actions,
    'insights': partial_insights,
}

__all__ = ['PARTIALS']
