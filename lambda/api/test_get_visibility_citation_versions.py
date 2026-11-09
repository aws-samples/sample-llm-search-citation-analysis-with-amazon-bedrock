"""``GET /api/visibility``: every KPI object says which citation rules its answers were stored under (#210, tenet 2).

Rows written since 2.43.0 carry ``citations_version`` 2; older rows carry none. A scope over both mixes two
definitions of the citation KPIs, and the answer flags it: the scope's KPIs and each engine's.
"""

from __future__ import annotations

import pytest

from testing.report_scope_fixtures import brand, result, visibility_report

_CURRENT = {'citations_version': 2}
_FOUND = [brand('Hotel Coruna', 'first_party')]
_ROWS = {
    # Every answer of this keyword was stored under rule 2.
    'hotel coruna spa': [{**result('hotel coruna spa', engine, _FOUND), **_CURRENT} for engine in ('openai', 'gemini')],
    # Stored before 2.43.0: no version.
    'best hotels galicia': [result('best hotels galicia', 'openai', _FOUND)],
}


@pytest.fixture
def body():
    with visibility_report(_ROWS, '_citation_versions') as report:
        yield report.body


def test_a_keyword_of_one_rule_is_not_flagged(body):
    kpis = body({'keyword': 'hotel coruna spa'})['kpis']

    assert (kpis['citation_versions'], kpis['citation_versions_mixed']) == ([{'version': '2', 'answers': 2}], False)


def test_a_scope_spanning_the_upgrade_flags_the_mix_with_each_rules_answers(body):
    kpis = body({'scope': 'all'})['kpis']

    assert (kpis['citation_versions'], kpis['citation_versions_mixed']) == (
        [{'version': '2', 'answers': 2}, {'version': 'unversioned (pre-2.43.0)', 'answers': 1}], True,
    )


def test_each_engines_kpis_carry_their_own_rules(body):
    engines = {row['engine']: row['kpis']['citation_versions_mixed'] for row in body({'scope': 'all'})['engines']}

    assert engines == {'gemini': False, 'openai': True}
