"""Artifact ``prompts`` (track S4): the winning, losing and opportunity prompts (top 100 each, with counts) of ``/prompt-insights``.

Built by ``shared.action_list_builders.prompts_builder`` from each keyword's latest run.
"""

from typing import Any

from shared.action_list_builders import STORED_PER_LIST, prompts_builder
from shared.snapshot_artifacts import ArtifactBuilder

#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (prompts_builder(),)

__all__ = ['BUILDERS', 'STORED_PER_LIST', 'prompts_builder']
