"""The KPI reference, the engine and the dashboard list the same KPIs, in the same order.

``docs/kpi-definitions.md`` defines every KPI, ``shared.kpi_engine`` computes
them and ``web/src/constants/kpiDefinitions.ts`` words them for customers.
A KPI added, renamed or dropped in one place and not the others fails here.
"""

from __future__ import annotations

import re
from pathlib import Path

from shared.kpi_engine import KPI_IDS

_ROOT = Path(__file__).resolve().parents[2]
_DOC = _ROOT / 'docs' / 'kpi-definitions.md'
_WEB = _ROOT / 'web' / 'src' / 'constants' / 'kpiDefinitions.ts'


def _documented_ids() -> list[str]:
    """The id of every KPI section of the reference (``### `id` — Label``)."""
    return re.findall(r'^### `([a-z0-9_]+)` — ', _DOC.read_text(encoding='utf-8'), flags=re.MULTILINE)


def _web_ids() -> list[str]:
    """The entries of the web ``KPI_IDS`` array."""
    match = re.search(r'export const KPI_IDS = \[(.*?)\] as const;', _WEB.read_text(encoding='utf-8'), flags=re.DOTALL)
    assert match is not None, 'web KPI_IDS array not found'
    return re.findall(r"'([a-z0-9_]+)'", match.group(1))


def _web_definition_keys() -> list[str]:
    """The keys of the web ``KPI_DEFINITIONS`` record, in source order."""
    return re.findall(r'^  ([a-z0-9_]+): \{$', _WEB.read_text(encoding='utf-8'), flags=re.MULTILINE)


def test_the_reference_documents_every_kpi_of_the_engine_in_order():
    assert _documented_ids() == list(KPI_IDS)


def test_the_dashboard_lists_every_kpi_of_the_engine_in_order():
    assert _web_ids() == list(KPI_IDS)


def test_the_dashboard_words_every_kpi_of_the_engine():
    assert _web_definition_keys() == list(KPI_IDS)


def test_the_reference_names_each_kpi_as_the_dashboard_does():
    """The label after each reference heading is the dashboard label."""
    doc_labels = dict(re.findall(r'^### `([a-z0-9_]+)` — (.+)$', _DOC.read_text(encoding='utf-8'), flags=re.MULTILINE))
    web_labels = dict(re.findall(r"^  ([a-z0-9_]+): \{\n(?:    .*\n)*?    label: '([^']+)',", _WEB.read_text(encoding='utf-8'), flags=re.MULTILINE))

    assert list(web_labels) == list(KPI_IDS)
    assert doc_labels == web_labels
