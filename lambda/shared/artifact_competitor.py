"""Artifact ``competitor`` (track S4): per configured competitor, every outranked keyword, the counts and the top 10 outreach.

The rollups of ``/reports/competitor`` for every competitor any keyword ranks,
built by ``shared.action_list_builders.competitor_builder``.
"""

from typing import Any

from shared.action_list_builders import competitor_builder
from shared.snapshot_artifacts import ArtifactBuilder

#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (competitor_builder(),)

__all__ = ['BUILDERS', 'competitor_builder']
