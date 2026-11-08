"""
Every artifact builder of the scope snapshot, by owning module (design 2.45.0 §2.2, §4).

Each ``shared/artifact_<name>.py`` exposes ``BUILDERS``, a tuple of
``shared.snapshot_artifacts.ArtifactBuilder``; a track adds its builders
there and never edits this file. The modules are flat (not a
``shared/artifacts/`` package) because the layer builds ship only the top
level of ``lambda/shared/``.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from types import ModuleType
from typing import Any

from shared import (
    artifact_competitor,
    artifact_gaps,
    artifact_group_kpis,
    artifact_insights,
    artifact_latest,
    artifact_mentions,
    artifact_prompts,
    artifact_recommendations,
    artifact_sentiment,
    artifact_stats,
    artifact_trends,
)
from shared.partial_contract import KeywordLatest
from shared.snapshot_artifacts import ArtifactBuilder, SnapshotArtifacts, SnapshotScope

ARTIFACT_MODULES: tuple[ModuleType, ...] = (
    artifact_latest,
    artifact_trends,
    artifact_group_kpis,
    artifact_stats,
    artifact_mentions,
    artifact_sentiment,
    artifact_gaps,
    artifact_prompts,
    artifact_recommendations,
    artifact_competitor,
    artifact_insights,
)


def artifact_builders() -> dict[str, ArtifactBuilder[Any]]:
    """Every registered builder by ``name``; two builders of one name are a programming error."""
    builders: dict[str, ArtifactBuilder[Any]] = {}
    for module in ARTIFACT_MODULES:
        for builder in module.BUILDERS:
            if builder.name in builders:
                raise ValueError(f'two artifact builders named {builder.name!r}')
            builders[builder.name] = builder
    return builders


def fold_scope(
    builders: Iterable[ArtifactBuilder[Any]], latests: Iterable[KeywordLatest], scope: SnapshotScope,
) -> dict[str, Any]:
    """Every artifact of ``scope``: each keyword folded into each builder once, then finalized.

    The whole-scope, in-memory form of the build (the streaming builder of
    track S1 folds the same way, one keyword into the ~5 scopes it belongs to).
    Two builders writing the same artifact key are a programming error.
    """
    chosen = list(builders)
    accumulators: list[Any] = [None] * len(chosen)
    for latest in latests:
        for index, builder in enumerate(chosen):
            accumulators[index] = builder.fold(accumulators[index], latest, scope)
    artifacts: dict[str, Any] = {}
    for builder, acc in zip(chosen, accumulators, strict=True):
        for key, value in builder.finalize(acc).items():
            if key in artifacts:
                raise ValueError(f'two artifact builders write {key!r}')
            artifacts[key] = value
    return artifacts


def serve_view(name: str, artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
    """The body builder ``name`` serves from ``artifacts``, or ``None`` when the build does not hold it (answer with a view job)."""
    builder = artifact_builders().get(name)
    if builder is None:
        raise KeyError(f'no artifact builder named {name!r}')
    return builder.serve(artifacts, params)


__all__ = ['artifact_builders', 'fold_scope', 'serve_view']
