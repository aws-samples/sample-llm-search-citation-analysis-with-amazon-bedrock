"""Artifact ``gaps`` (track S4): sorted keyword summaries, the top 30 gaps and the totals of ``/citation-gaps``.

The builder is ``shared.action_list_builders.gaps_builder``.
"""

from typing import Any

from shared.action_list_builders import gaps_builder
from shared.snapshot_artifacts import ArtifactBuilder

#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (gaps_builder(),)

__all__ = ['BUILDERS', 'gaps_builder']
