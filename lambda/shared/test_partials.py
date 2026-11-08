"""Tests for shared.partials: the registry of per-keyword partials and its module contract."""

from __future__ import annotations

import inspect

import pytest

from shared.partial_contract import PartialConfig, PartialModule, pending_partial
from shared.partials import PARTIALS


def test_registry_names_the_four_partials() -> None:
    assert sorted(PARTIALS) == ['actions', 'insights', 'kpi', 'mentions']


@pytest.mark.parametrize('name', sorted(PARTIALS))
def test_partial_build_takes_rows_and_config(name: str) -> None:
    module: PartialModule = PARTIALS[name]

    assert list(inspect.signature(module.build).parameters) == ['rows', 'config']


@pytest.mark.parametrize('name', sorted(PARTIALS))
def test_partial_merge_takes_accumulator_and_part(name: str) -> None:
    assert list(inspect.signature(PARTIALS[name].merge).parameters) == ['acc', 'part']


def test_kpi_partial_keeps_the_previous_run_for_change() -> None:
    assert PARTIALS['kpi'].PREVIOUS_RUN is True


def test_pending_build_names_the_track_that_writes_it() -> None:
    build, _merge = pending_partial('kpi', 'S2')

    with pytest.raises(NotImplementedError, match='kpi partial: track S2'):
        build([], PartialConfig())


def test_pending_merge_names_the_track_that_writes_it() -> None:
    _build, merge = pending_partial('kpi', 'S2')

    with pytest.raises(NotImplementedError, match='kpi merge: track S2'):
        merge(None, {})


def test_partial_config_defaults_to_no_brands_and_no_personas() -> None:
    assert (dict(PartialConfig().brand_config), PartialConfig().personas) == ({}, ())
