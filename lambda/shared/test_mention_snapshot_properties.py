"""Random tenants: every mention snapshot view equals the uncapped live view (design 2.45.0 §5 tests 1, 2 and 4)."""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from shared.artifact_mentions import MentionsBuilder, appearances_fingerprint
from shared.artifact_sentiment import SentimentIndexBuilder, snapshot_fingerprint
from testing.mention_snapshot_fixtures import MentionTenant, PagedView, served
from testing.scale_data import ScaleSpec

tenants = st.builds(
    lambda keywords, personas: MentionTenant(ScaleSpec(keywords=keywords, personas=personas, runs=1, long_tail=7)),
    st.integers(min_value=1, max_value=9),
    st.integers(min_value=0, max_value=3),
)

#: Twelve generated tenants, each with a page size from 1 to 60.
over_tenants_and_page_sizes = settings(max_examples=12, deadline=None)(given(tenant=tenants, limit=st.integers(min_value=1, max_value=60)))


@settings(max_examples=12, deadline=None)
@given(tenant=tenants)
def test_summary_equals_the_live_summary(tenant):
    body = served(MentionsBuilder(), tenant.artifacts(), {'readers': tenant.mention_readers()})

    assert body['aggregated'] == tenant.oracle_summary(None, None, None)


@over_tenants_and_page_sizes
def test_appearance_pages_equal_the_live_list(tenant, limit):
    view = PagedView(MentionsBuilder(), tenant.artifacts(), {'view': 'appearances', 'readers': tenant.mention_readers()}, appearances_fingerprint)

    assert view.follow('appearances', limit) == tenant.oracle_appearances(None, None, None, None)


@over_tenants_and_page_sizes
def test_sentiment_pages_equal_the_live_examples(tenant, limit):
    params = {'sentiment': 'negative', 'classification': 'first_party', 'readers': tenant.sentiment_readers()}
    expected = tenant.oracle_examples('negative', None, 'first_party')[1]

    assert PagedView(SentimentIndexBuilder(), tenant.artifacts(), params, snapshot_fingerprint).follow('examples', limit) == expected
