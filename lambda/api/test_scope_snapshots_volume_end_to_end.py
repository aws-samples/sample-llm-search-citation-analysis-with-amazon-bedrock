"""Volume, end to end (design 2.45.0 §5): 5,000 keywords written, built and served with every real builder; reads are counted, never timed.

5,000 keywords in 15 markets, one persona x 4 engines and one run, written
through the real Deduplication writer; the scope snapshots are built with
every registered builder at the production live budget (``scope=all`` and
every market are past it). The build reads each KeywordLatest object once and
no SearchResults row; serving ``scope=all`` reads a few S3 objects and no
SearchResults partition (the brand summary reads its previews in a few
BatchGets). Timings at the 10x design point stay in ``scratch/``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from shared import scope_source
from shared.brand_mention_views import ANSWER_PROBE_KEYWORDS
from shared.keyword_latest import KEYWORDS_PREFIX
from shared.scope_snapshot import SNAPSHOT_PREFIX
from testing.end_to_end_tenant import ENV, EndToEndTenant
from testing.scale_data import ScaleSpec

SPEC = ScaleSpec(keywords=5_000, groups=710, largest_group=160, markets=15, personas=1, runs=1, long_tail=2_000)
SEARCH_RESULTS = ENV['DYNAMODB_TABLE_SEARCH_RESULTS']
ALL = {'scope': 'all'}
#: ``current.json``, which a warm container reads once per ``POINTER_TTL_SECONDS`` (every call here starts cold).
POINTER = f'{SNAPSHOT_PREFIX}current.json'


@pytest.fixture(scope='module')
def volume() -> EndToEndTenant:
    tenant = EndToEndTenant(SPEC, budget=scope_source.LIVE_ROWS_BUDGET)
    tenant.run_all()
    tenant.bucket.gets.clear()
    tenant.dynamo.clear_reads()
    tenant.build()
    return tenant


@pytest.fixture(scope='module')
def build_reads(volume) -> dict[str, Any]:
    """What the build read: S3 keys, and the SearchResults reads."""
    return {'s3': list(volume.bucket.gets), 'search_results': volume.dynamo.reads_of(SEARCH_RESULTS)}


def _served_reads(tenant: EndToEndTenant, filename: str, path: str, query: Mapping[str, str]) -> tuple[int, dict[str, Any], list[str], list[str]]:
    """The answer to ``query`` and what serving it read: S3 keys, and the SearchResults operations."""
    tenant.bucket.gets.clear()
    tenant.dynamo.clear_reads()
    status, body = tenant.call(filename, path, query)
    return status, body, list(tenant.bucket.gets), [operation for operation, _params in tenant.dynamo.reads_of(SEARCH_RESULTS)]


def test_the_build_covers_every_keyword(volume):
    assert (volume.last_build['status'], volume.last_build['keyword_latest_found']) == ('built', 5_000)


def test_the_build_reads_each_keyword_latest_object_once(build_reads):
    objects = [key for key in build_reads['s3'] if key.startswith(KEYWORDS_PREFIX)]
    assert (len(objects), len(set(objects))) == (5_000, 5_000)


def test_the_build_reads_no_search_results_row(build_reads):
    assert build_reads['search_results'] == []


@pytest.mark.parametrize(('filename', 'path', 'query'), [
    ('get-visibility-metrics.py', '/api/visibility', ALL),
    ('get-recommendations.py', '/api/recommendations', ALL),
    ('get-citation-gaps.py', '/api/citation-gaps', ALL),
    ('get-prompt-insights.py', '/api/prompt-insights', ALL),
    ('get-reports-competitor.py', '/api/reports/competitor', ALL),
], ids=['visibility', 'recommendations', 'citation-gaps', 'prompt-insights', 'competitor'])
class TestServingScopeAll:
    def test_answers_every_keyword_from_the_snapshot(self, volume, filename, path, query):
        status, body, _s3, _reads = _served_reads(volume, filename, path, query)
        assert (status, body['source'], body['coverage']['keywords_analyzed']) == (200, 'snapshot', 5_000)

    def test_reads_at_most_three_artifacts_besides_the_pointer(self, volume, filename, path, query):
        _status, _body, s3, _reads = _served_reads(volume, filename, path, query)
        assert len([key for key in s3 if key != POINTER]) <= 3

    def test_reads_no_search_results_partition(self, volume, filename, path, query):
        _status, _body, _s3, reads = _served_reads(volume, filename, path, query)
        assert reads == []


def test_the_brand_summary_reads_its_previews_in_at_most_five_batches(volume):
    _status, body, _s3, reads = _served_reads(volume, 'get-brand-mentions.py', '/api/brand-mentions', ALL)
    assert (body['source'], reads.count('batch_get_item') <= 5) == ('snapshot', True)


def test_the_brand_summary_queries_only_its_routing_probe(volume):
    """The answers-per-run probe (``latest_run_source``) reads a few keywords' newest run whatever the scope's size."""
    _status, _body, _s3, reads = _served_reads(volume, 'get-brand-mentions.py', '/api/brand-mentions', ALL)
    assert reads.count('query') <= 2 * ANSWER_PROBE_KEYWORDS
