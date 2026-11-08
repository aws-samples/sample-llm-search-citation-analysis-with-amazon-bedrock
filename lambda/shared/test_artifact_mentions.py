"""``mentions/*`` artifacts: the snapshot answer equals the uncapped live answer (design 2.45.0 §5 tests 1, 2 and 4).

Random tenants: ``test_mention_snapshot_properties.py``.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared.artifact_mentions import BRAND_INDEX_KEY, MentionsBuilder, appearances_fingerprint, combo_artifact_key
from shared.snapshot_artifacts import KeywordCursor
from testing.mention_snapshot_fixtures import MentionTenant, PagedView, served, tenant_fixture
from testing.scale_data import COMPETITORS, ENGINES, FIRST_PARTY, ScaleSpec
from testing.snapshot_fakes import FakeSnapshotArtifacts

FILTERS = [
    pytest.param(None, None, None, id='everything'),
    pytest.param('persona-01', None, None, id='persona'),
    pytest.param(None, 'gemini', None, id='provider'),
    pytest.param('persona-02', 'openai', None, id='persona-provider'),
    pytest.param(None, None, 'first_party', id='first-party'),
    pytest.param(None, None, 'competitor', id='competitor'),
    pytest.param('persona-01', 'claude', 'other', id='persona-provider-other'),
]

tenant = tenant_fixture(ScaleSpec(keywords=14, personas=2, runs=2, long_tail=25))


def _summary(tenant: MentionTenant, query_prompt_id: str | None, provider: str | None, classification: str | None) -> dict[str, Any]:
    params = {'query_prompt_id': query_prompt_id, 'provider': provider, 'classification': classification, 'readers': tenant.mention_readers()}
    return served(MentionsBuilder(), tenant.artifacts(), params)


def _appearances(tenant: MentionTenant, filters: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    params = {**filters, 'view': 'appearances', 'readers': tenant.mention_readers()}
    return PagedView(MentionsBuilder(), tenant.artifacts(), params, appearances_fingerprint).follow('appearances', limit)


def _first_page(tenant: MentionTenant, limit: int) -> dict[str, Any]:
    params = {'view': 'appearances', 'limit': limit, 'cursor': KeywordCursor(0, 0, 'f'), 'readers': tenant.mention_readers()}
    return served(MentionsBuilder(), tenant.artifacts(), params)


class TestSummary:
    @pytest.mark.parametrize(('query_prompt_id', 'provider', 'classification'), FILTERS)
    def test_aggregated_block_equals_the_live_summary_over_every_keyword(self, tenant, query_prompt_id, provider, classification):
        body = _summary(tenant, query_prompt_id, provider, classification)

        assert body['aggregated'] == tenant.oracle_summary(query_prompt_id, provider, classification)

    def test_counts_every_keyword_with_data(self, tenant):
        assert _summary(tenant, None, None, None)['keywords_with_data'] == tenant.spec.keywords

    def test_lists_the_latest_and_previous_runs_newest_first(self, tenant):
        assert _summary(tenant, None, None, None)['available_runs'] == [tenant.latest_timestamp, tenant.previous_timestamp]

    def test_reads_the_preview_rows_in_one_batch_of_at_most_five_per_brand(self, tenant):
        tenant.preview_reads.clear()
        brands = _summary(tenant, None, None, None)['aggregated']['brands']

        assert (len(tenant.preview_reads), len(tenant.preview_reads[0]) <= 5 * len(brands)) == (1, True)

    def test_answers_an_unknown_persona_with_no_brands(self, tenant):
        body = _summary(tenant, 'persona-99', None, None)

        assert (body['aggregated']['brands'], body['keywords_with_data'], body['timestamp']) == ([], 0, None)

    def test_answers_none_for_another_run_than_the_latest(self, tenant):
        assert MentionsBuilder().serve(tenant.artifacts(), {'timestamp': tenant.previous_timestamp}) is None

    def test_answers_none_when_the_build_holds_no_mentions(self, tenant):
        assert MentionsBuilder().serve(FakeSnapshotArtifacts({}, 0), {'readers': tenant.mention_readers()}) is None


class TestArtifactKeys:
    def test_names_a_combo_by_persona_and_provider(self):
        assert combo_artifact_key('persona-01', 'openai') == 'mentions/persona-01-openai'

    def test_names_no_filter_all(self):
        assert combo_artifact_key(None, None) == 'mentions/_all-_all'

    def test_hashes_an_id_with_unsafe_characters(self):
        assert combo_artifact_key('a/../b', None).startswith('mentions/h')

    def test_writes_a_summary_and_a_brand_list_per_persona_provider_combo_and_both_indexes(self, tenant):
        keys = set(tenant.artifacts().artifacts)

        # (every persona + 2 personas) x (every provider + 4 engines), twice (summary, brand list), the brand index and the sentiment index.
        assert (len(keys), BRAND_INDEX_KEY in keys) == (2 * 3 * (1 + len(ENGINES)) + 2, True)


class TestAppearancePages:
    @pytest.mark.parametrize(('query_prompt_id', 'provider', 'classification'), FILTERS)
    def test_concatenated_pages_equal_the_live_keyword_major_list(self, tenant, query_prompt_id, provider, classification):
        filters = {'query_prompt_id': query_prompt_id, 'provider': provider, 'classification': classification, 'brand': None}

        assert _appearances(tenant, filters, 37) == tenant.oracle_appearances(query_prompt_id, provider, classification, None)

    @pytest.mark.parametrize('brand', [FIRST_PARTY, COMPETITORS[0], 'hostal 00003', 'Nobody Inn'])
    def test_brand_pages_equal_the_live_list_of_that_brand(self, tenant, brand):
        assert _appearances(tenant, {'brand': brand}, 11) == tenant.oracle_appearances(None, None, None, brand)

    def test_total_is_the_exact_count_of_every_appearance(self, tenant):
        assert _first_page(tenant, 5)['total_appearances'] == len(tenant.oracle_appearances(None, None, None, None))

    def test_brand_page_reads_only_the_keywords_naming_the_brand(self, tenant):
        brand = 'Hostal 00003'
        naming = {row['keyword'] for rows in tenant.rows.values() for row in rows for each in row['brands'] if each['name'] == brand}
        tenant.run_reads.clear()
        _appearances(tenant, {'brand': brand}, 2000)

        assert {keyword for keyword, _ts in tenant.run_reads} == naming

    def test_first_page_reads_only_the_keywords_it_covers(self, tenant):
        tenant.run_reads.clear()
        _first_page(tenant, 3)

        assert tenant.run_reads == [(tenant.keywords[0], tenant.latest_timestamp)]
