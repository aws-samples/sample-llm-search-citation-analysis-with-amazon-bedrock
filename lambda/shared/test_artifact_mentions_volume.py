"""Serving a large scope reads O(1) artifacts and O(page) keywords (design 2.45.0 §5, volume).

Data: 600 keywords x 2 personas x 4 engines (4,800 latest-run answers, about
2,300 brands). The asserts count reads, not time, so load never flakes them.
"""

from __future__ import annotations

import gzip
import json
import math

import pytest

from shared.artifact_mentions import MentionsBuilder, combo_artifact_key
from shared.artifact_sentiment import SentimentIndexBuilder
from shared.snapshot_artifacts import KeywordCursor
from testing.mention_snapshot_fixtures import tenant_fixture
from testing.scale_data import ScaleSpec

_PAGE = 500
_ANSWERS_PER_KEYWORD = 2 * 4


tenant = tenant_fixture(ScaleSpec(keywords=600, personas=2, runs=1, long_tail=2_000))


@pytest.fixture(scope='module')
def build(tenant):
    return tenant.artifacts()


def test_summary_loads_its_artifact_and_the_scope_series_only(tenant, build):
    build.loads.clear()
    MentionsBuilder().serve(build, {'readers': tenant.mention_readers()})

    assert build.loads == [combo_artifact_key(None, None), 'series']


def test_summary_reads_its_preview_rows_in_one_call_of_at_most_500_keys(tenant, build):
    tenant.preview_reads.clear()
    MentionsBuilder().serve(build, {'readers': tenant.mention_readers()})

    assert (len(tenant.preview_reads), len(tenant.preview_reads[0]) <= 500) == (1, True)


def test_appearance_page_reads_only_the_keywords_it_covers(tenant, build):
    tenant.run_reads.clear()
    params = {'view': 'appearances', 'limit': _PAGE, 'cursor': KeywordCursor(0, 0, 'f'), 'readers': tenant.mention_readers()}
    MentionsBuilder().serve(build, params)

    # Every keyword holds at least one appearance per answer.
    assert len(tenant.run_reads) <= math.ceil(_PAGE / _ANSWERS_PER_KEYWORD) + 1


def test_sentiment_page_reads_only_the_keywords_it_covers(tenant, build):
    tenant.run_reads.clear()
    params = {'sentiment': 'positive', 'classification': 'first_party', 'limit': 20, 'cursor': KeywordCursor(0, 0, 'f'), 'readers': tenant.sentiment_readers()}
    body = SentimentIndexBuilder().serve(build, params)

    assert body is not None
    assert len(tenant.run_reads) <= 20


@pytest.mark.parametrize('key', [combo_artifact_key(None, None), 'mentions/brand-index', 'sentiment/index'])
def test_every_artifact_stays_under_one_megabyte_gzipped(build, key):
    stored = gzip.compress(json.dumps(build.artifacts[key]).encode('utf-8'))

    assert len(stored) < 1_000_000
