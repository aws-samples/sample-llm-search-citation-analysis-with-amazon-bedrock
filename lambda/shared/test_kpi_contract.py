"""The KPI reference, the engine and the dashboard list the same KPIs, in the same order.

``docs/kpi-definitions.md`` defines every KPI, ``shared.kpi_engine`` computes
them and ``web/src/constants/kpiDefinitions.ts`` words them for customers.
A KPI added, renamed or dropped in one place and not the others fails here.

``shared.kpi_tally`` computes the same KPIs from summed per-run counts (the
history reports read those rows): for any answers, its figures equal the
engine's, KPI for KPI, so a definition changed in one and not the other fails
here too.
"""

from __future__ import annotations

import re
from pathlib import Path

from hypothesis import given, settings

from shared.kpi_engine import KPI_IDS, answers_from_rows, brand_kpis
from shared.kpi_tally import run_tallies, tally_kpis
from testing.kpi_row_strategies import KEYWORDS, OWNED_DOMAINS, search_rows

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


@settings(max_examples=150, deadline=None)
@given(rows=search_rows(), owned=OWNED_DOMAINS)
def test_the_tallied_kpis_equal_the_engines_for_any_answers(rows, owned):
    """``tally_kpis`` (history reports) and ``brand_kpis`` (one-run views) give every KPI the same value."""
    answers = answers_from_rows(rows)
    tallies = [tally for keyword in KEYWORDS for tally in run_tallies(keyword, [a for a in answers if a.keyword == keyword], owned)]

    engine = brand_kpis(answers, owned)
    tallied = tally_kpis(tallies, owned)
    assert {kpi: tallied[kpi] for kpi in KPI_IDS if kpi in engine} == {kpi: engine[kpi] for kpi in KPI_IDS if kpi in engine}
