"""``sentiment/index``: exact totals and pages equal to the uncapped live examples (design 2.45.0 §5 tests 1, 2 and 4).

The same equality over generated tenants of every size is in ``test_mention_snapshot_properties.py``.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared.artifact_sentiment import INDEX_KEY, SentimentIndexBuilder, matching_count, snapshot_fingerprint
from shared.snapshot_artifacts import KeywordCursor
from testing.mention_snapshot_fixtures import MentionTenant, PagedView, follow_pages, served, tenant_fixture
from testing.scale_data import ScaleSpec
from testing.snapshot_fakes import FakeSnapshotArtifacts
from testing.window_budget_fixtures import active_deadline, ticking_deadline

SENTIMENT_FILTERS = [
    pytest.param('positive', None, 'first_party', id='positive-first-party'),
    pytest.param('negative', 'gemini', 'first_party', id='negative-gemini'),
    pytest.param('mixed', None, 'competitor', id='mixed-competitor'),
    pytest.param('neutral', 'claude', 'competitor', id='neutral-claude-competitor'),
]

tenant = tenant_fixture(ScaleSpec(keywords=16, personas=2, runs=1, long_tail=25))


def _view(tenant: MentionTenant, sentiment: str, provider: str | None, classification: str) -> PagedView:
    params = {'sentiment': sentiment, 'provider': provider, 'classification': classification, 'readers': tenant.sentiment_readers()}
    return PagedView(SentimentIndexBuilder(), tenant.artifacts(), params, snapshot_fingerprint)


def _first_page(tenant: MentionTenant, limit: int, sentiment: str = 'positive') -> dict[str, Any]:
    params = {'sentiment': sentiment, 'classification': 'first_party', 'limit': limit, 'cursor': KeywordCursor(0, 0, 'f'), 'readers': tenant.sentiment_readers()}
    return served(SentimentIndexBuilder(), tenant.artifacts(), params)


class TestEquality:
    @pytest.mark.parametrize(('sentiment', 'provider', 'classification'), SENTIMENT_FILTERS)
    def test_total_equals_the_live_count_over_every_keyword(self, tenant, sentiment, provider, classification):
        assert _view(tenant, sentiment, provider, classification).page(None, 10)['total'] == tenant.oracle_examples(sentiment, provider, classification)[0]

    @pytest.mark.parametrize(('sentiment', 'provider', 'classification'), SENTIMENT_FILTERS)
    def test_concatenated_pages_equal_the_live_examples_in_order(self, tenant, sentiment, provider, classification):
        assert _view(tenant, sentiment, provider, classification).follow('examples', 7) == tenant.oracle_examples(sentiment, provider, classification)[1]


class TestReads:
    def test_page_reads_only_the_keywords_it_covers(self, tenant):
        tenant.run_reads.clear()
        examples = _first_page(tenant, 1)['examples']

        assert (len(examples), len(tenant.run_reads)) == (1, 1)

    def test_reads_the_page_answer_texts_in_one_call(self, tenant):
        tenant.text_reads.clear()
        _first_page(tenant, 10)

        assert [len(keys) for keys in tenant.text_reads] == [10]

    def test_skips_keywords_without_a_match(self, tenant):
        index = tenant.artifacts().artifacts[INDEX_KEY]['keywords']
        matching = sum(1 for _keyword, _ts, counts in index if matching_count(counts, 'competitor', 'neutral', 'claude'))
        tenant.run_reads.clear()
        _view(tenant, 'neutral', 'claude', 'competitor').follow('examples', 2000)

        assert len(tenant.run_reads) == matching

    def test_answers_none_without_an_index(self, tenant):
        params = {'sentiment': 'positive', 'limit': 5, 'cursor': KeywordCursor(0, 0, 'f'), 'readers': tenant.sentiment_readers()}

        assert SentimentIndexBuilder().serve(FakeSnapshotArtifacts({}, 0), params) is None


class TestTimeBudget:
    def test_stops_between_keywords_and_says_truncated(self, tenant):
        with active_deadline(ticking_deadline(1)):
            body = _first_page(tenant, 500)

        assert (body['truncated'], body['next_token'] is not None, len(body['examples']) < body['total']) == (True, True, True)

    def test_pages_after_a_cut_still_concatenate_to_the_live_examples(self, tenant):
        view = _view(tenant, 'positive', None, 'first_party')

        def cut_page(token: str | None) -> dict[str, Any]:
            with active_deadline(ticking_deadline(2)):
                return view.page(token, 500)

        assert follow_pages(cut_page, 'examples') == tenant.oracle_examples('positive', None, 'first_party')[1]


class TestMatchingCount:
    def test_sums_every_provider_when_none_is_given(self):
        counts = {'first_party|positive|openai': 2, 'first_party|positive|gemini': 3, 'competitor|positive|openai': 9}

        assert matching_count(counts, 'first_party', 'positive', None) == 5

    def test_reads_one_provider(self):
        assert matching_count({'first_party|positive|openai': 2}, 'first_party', 'positive', 'openai') == 2
