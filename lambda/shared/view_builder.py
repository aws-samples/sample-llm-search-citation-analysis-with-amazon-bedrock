"""One shape for the KPI artifact builders (track S2): ``latest``, ``trends``, ``group-kpis`` and ``stats``.

Each builder is a ``ViewBuilder``: its ``name``, how one KeywordLatest object
is added to the scope's accumulator (``add``), the artifacts the accumulator
becomes (``build``) and how a stored build answers a request (``view``). It
satisfies ``shared.snapshot_artifacts.ArtifactBuilder``. ``params_of`` reads
a request's params into the dataclass a ``view`` takes.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from shared.partial_contract import KeywordLatest
from shared.snapshot_artifacts import SnapshotArtifacts, SnapshotScope


@dataclass(frozen=True)
class ViewBuilder[AccT]:
    """An ``ArtifactBuilder`` made of three functions (see the module docstring)."""

    name: str
    add: Callable[[AccT | None, KeywordLatest], AccT]
    build: Callable[[AccT | None], dict[str, Any]]
    view: Callable[[SnapshotArtifacts, Mapping[str, Any]], dict[str, Any] | None]

    def fold(self, acc: AccT | None, latest: KeywordLatest, scope: SnapshotScope) -> AccT:
        del scope
        return self.add(acc, latest)

    def finalize(self, acc: AccT | None) -> dict[str, Any]:
        return self.build(acc)

    def serve(self, artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
        return self.view(artifacts, params)


def params_of[ParamsT](cls: type[ParamsT], params: Mapping[str, Any]) -> ParamsT:
    """``cls`` (a dataclass) from the ``params`` it declares; the others are ignored."""
    names = set(getattr(cls, '__dataclass_fields__', {}))
    return cls(**{name: value for name, value in params.items() if name in names})


__all__ = ['ViewBuilder', 'params_of']
