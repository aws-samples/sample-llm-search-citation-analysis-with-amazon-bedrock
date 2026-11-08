"""Artifacts ``recommendations`` and ``content-ideas`` (track S4): the Action Center's full sorted rule list and the Content Studio ideas.

Both builders live in ``shared.action_list_builders``; the Action Center's
status join runs per page in its handler.
"""

from typing import Any

from shared.action_list_builders import LLM_PROMPT_KEYWORDS, content_ideas_builder, recommendations_builder
from shared.snapshot_artifacts import ArtifactBuilder

#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (recommendations_builder(), content_ideas_builder())

__all__ = ['BUILDERS', 'LLM_PROMPT_KEYWORDS', 'content_ideas_builder', 'recommendations_builder']
