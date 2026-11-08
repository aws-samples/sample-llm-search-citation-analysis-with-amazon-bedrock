"""
The contract every per-keyword partial follows (``shared.partials``).

A partial is what one keyword's run contributes to a scoped view: built once
from the keyword's SearchResults rows of that run (``build``), stored in the
keyword's KeywordLatest object, and summed over a scope's keywords
(``merge``). The live path and the snapshot builder call the same two
functions, so a scope served from a snapshot equals the scope computed live.

``merge`` must be associative and must not depend on the order of the
keywords: the builder folds keywords in whatever order their objects arrive.
It may mutate and return ``acc`` (the fold owns it), never ``part``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Protocol, TypedDict

#: A partial: JSON-serializable (it is stored in S3), so plain dicts, lists, strings and numbers.
Partial = dict[str, Any]

#: One keyword's SearchResults rows of one run, as DynamoDB returns them.
RunRows = Sequence[Mapping[str, Any]]


@dataclass(frozen=True)
class PartialConfig:
    """What a partial depends on besides the rows: the configuration the KeywordLatest ``config`` fingerprints."""

    brand_config: Mapping[str, Any] = MappingProxyType({})
    """The ``default`` BrandConfig item (first-party names and domains, tracked competitors, competitor domains)."""
    personas: tuple[str, ...] = ()
    """The enabled persona (query prompt) ids, sorted; empty when only the plain keyword is asked."""


class BuildPartial(Protocol):
    """A partial's ``build``: one keyword's run rows to its partial, ``None`` when the run has nothing for it."""

    def __call__(self, rows: RunRows, config: PartialConfig) -> Partial | None:
        """The partial of one run's ``rows`` built for ``config``."""


class MergePartial(Protocol):
    """A partial's ``merge``: ``acc`` (``None`` before the first keyword) with ``part`` added."""

    def __call__(self, acc: Partial | None, part: Partial) -> Partial:
        """``acc`` with ``part`` merged in (order-free)."""
        raise NotImplementedError


class PartialModule(Protocol):
    """A ``shared.partial_<name>`` module (each one satisfies this structurally)."""

    @property
    def PREVIOUS_RUN(self) -> bool:
        """Whether KeywordLatest also keeps this partial for the previous run (views with a ``change``)."""
        raise NotImplementedError

    @property
    def build(self) -> BuildPartial:
        """The module's ``build``."""
        raise NotImplementedError

    @property
    def merge(self) -> MergePartial:
        """The module's ``merge``."""
        raise NotImplementedError


def pending_partial(name: str, track: str) -> tuple[BuildPartial, MergePartial]:
    """``build`` and ``merge`` of a partial its track has not written yet: both raise ``NotImplementedError``.

    Nothing in production calls a partial before its track lands; the stubs
    exist so the registry, the KeywordLatest writer and the builders can be
    written against every name from the start.
    """

    def build(rows: RunRows, config: PartialConfig) -> Partial | None:
        raise NotImplementedError(f'{name} partial: track {track}', len(rows), config)

    def merge(acc: Partial | None, part: Partial) -> Partial:
        raise NotImplementedError(f'{name} merge: track {track}', acc, part)

    return build, merge


class KeywordLatestRun(TypedDict):
    """One run of a KeywordLatest object: its timestamp and every partial built from it (``None`` = nothing to say)."""

    timestamp: str
    parts: dict[str, Partial | None]


class KeywordLatest(TypedDict):
    """The KeywordLatest object (``scope-snapshots/keywords/<hash>.json.gz``) the builders fold.

    ``shared.keyword_latest`` (track S1) writes it; artifact builders read only
    ``latest`` / ``previous`` ``parts`` of their own partial plus the identity
    fields. S1's history blocks (``recent``, ``series``, design §2.1) live in a
    TypedDict there that extends this one.
    """

    v: int
    keyword: str
    keyword_id: str
    config: str
    """Fingerprint of the ``PartialConfig`` the parts were built with; a mismatch means stale."""
    latest: KeywordLatestRun | None
    previous: KeywordLatestRun | None


__all__ = [
    'BuildPartial', 'KeywordLatest', 'KeywordLatestRun', 'MergePartial', 'Partial', 'PartialConfig', 'PartialModule', 'RunRows',
    'pending_partial',
]
