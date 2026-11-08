"""Tests for shared.artifact_registry: builder registration, the in-memory fold and serving by name."""

from __future__ import annotations

from contextlib import ExitStack
from unittest.mock import patch

import pytest

from shared import artifact_gaps, artifact_latest, artifact_registry
from shared.artifact_registry import ARTIFACT_MODULES, artifact_builders, fold_scope, serve_view
from shared.snapshot_artifacts import SnapshotScope
from testing.snapshot_fakes import FakeSnapshotArtifacts, KeywordListBuilder, keyword_latest

SCOPE = SnapshotScope(scope_dir='all', kind='all', group_id=None, market_id=None, keywords_total=2)


def test_registry_lists_every_artifact_module_of_the_design() -> None:
    assert sorted(module.__name__.removeprefix('shared.artifact_') for module in ARTIFACT_MODULES) == [
        'competitor', 'gaps', 'group_kpis', 'insights', 'latest',
        'mentions', 'prompts', 'recommendations', 'sentiment', 'stats', 'trends',
    ]


def test_builders_are_collected_by_name_from_every_module() -> None:
    builder = KeywordListBuilder()

    with ExitStack() as stack:
        for module in ARTIFACT_MODULES:
            stack.enter_context(patch.object(module, 'BUILDERS', ()))
        stack.enter_context(patch.object(artifact_latest, 'BUILDERS', (builder,)))
        assert artifact_builders() == {'keyword-list': builder}


def test_two_builders_of_one_name_are_refused() -> None:
    with (
        patch.object(artifact_latest, 'BUILDERS', (KeywordListBuilder(),)),
        patch.object(artifact_gaps, 'BUILDERS', (KeywordListBuilder(key='other'),)),
        pytest.raises(ValueError, match="two artifact builders named 'keyword-list'"),
    ):
        artifact_builders()


def test_fold_scope_folds_every_keyword_in_order_then_finalizes() -> None:
    latests = [keyword_latest('hotel a'), keyword_latest('hotel b')]

    assert fold_scope([KeywordListBuilder()], latests, SCOPE) == {'keywords': {'keywords': ['hotel a', 'hotel b']}}


def test_fold_scope_finalizes_an_empty_scope() -> None:
    assert fold_scope([KeywordListBuilder()], [], SCOPE) == {'keywords': {'keywords': []}}


def test_fold_scope_refuses_two_builders_writing_one_key() -> None:
    builders = [KeywordListBuilder(), KeywordListBuilder(name='copy')]

    with pytest.raises(ValueError, match="two artifact builders write 'keywords'"):
        fold_scope(builders, [keyword_latest('hotel a')], SCOPE)


def test_serve_view_answers_from_the_stored_build() -> None:
    artifacts = FakeSnapshotArtifacts({'keywords': {'keywords': ['hotel a']}}, keywords_total=1)

    with patch.object(artifact_latest, 'BUILDERS', (KeywordListBuilder(),)):
        body = serve_view('keyword-list', artifacts, {'limit': 10})

    assert body == {'keywords': ['hotel a'], 'params': {'limit': 10}}


def test_serve_view_is_none_when_the_build_lacks_the_artifact() -> None:
    with patch.object(artifact_latest, 'BUILDERS', (KeywordListBuilder(),)):
        assert serve_view('keyword-list', FakeSnapshotArtifacts({}, keywords_total=0), {}) is None


def test_serve_view_of_an_unregistered_builder_is_a_programming_error() -> None:
    with pytest.raises(KeyError, match='no artifact builder'):
        artifact_registry.serve_view('missing', FakeSnapshotArtifacts({}, keywords_total=0), {})
