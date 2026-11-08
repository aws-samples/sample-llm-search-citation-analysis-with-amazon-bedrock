"""Volume test of the scope snapshot build at the 10x keyword count (design 2.45.0 §5): reads are counted, never timed.

5,000 keywords in 710 groups (the largest 160) and 15 markets. One persona and
one run keep the generated objects cheap; the full 10x probe (10 personas,
two runs) is ``scratch/s1/volume_probe.py``, whose timings stay out of the suite.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared.keyword_latest import KEYWORDS_PREFIX
from shared.partial_contract import PartialConfig
from shared.scope_series_build import PROGRESS_KEY
from shared.scope_snapshot import SNAPSHOT_PREFIX, artifact_key
from shared.scope_snapshot_build import SnapshotSources, build_snapshots
from shared.snapshot_store import scope_dir
from testing.scale_data import BRAND_CONFIG, ScaleSpec, keyword_items, persona_ids
from testing.scope_snapshot_fixtures import SNAPSHOT_BUCKET, SnapshotBucket, bucket_with_keyword_latests, keywords_table
from testing.snapshot_fakes import KeywordListBuilder

_SPEC = ScaleSpec(keywords=5_000, groups=710, largest_group=160, markets=15, personas=1, runs=1, long_tail=200)


@pytest.fixture(scope='module')
def volume() -> tuple[SnapshotBucket, dict[str, Any]]:
    bucket = bucket_with_keyword_latests(_SPEC, PartialConfig(brand_config=BRAND_CONFIG, personas=persona_ids(_SPEC)))
    sources = SnapshotSources(
        keywords_table(keyword_items(_SPEC)), bucket, SNAPSHOT_BUCKET, BRAND_CONFIG, persona_ids(_SPEC), builders={'keyword-list': KeywordListBuilder()},
    )
    return bucket, build_snapshots(sources)


def test_reads_each_of_the_5000_keyword_latest_objects_once(volume):
    bucket, _ = volume
    reads = [key for key in bucket.gets if key.startswith(KEYWORDS_PREFIX)]
    assert (len(reads), len(set(reads))) == (5_000, 5_000)


def test_reads_nothing_but_keyword_latest_objects_the_pointer_and_the_series_progress(volume):
    bucket, _ = volume
    assert {key for key in bucket.gets if not key.startswith(KEYWORDS_PREFIX)} == {f'{SNAPSHOT_PREFIX}current.json', PROGRESS_KEY}


def test_scope_all_holds_every_keyword(volume):
    bucket, summary = volume
    stored = bucket.json_at(artifact_key(summary['build_id'], scope_dir('all'), 'keywords'))
    assert len(set(stored['keywords'])) == 5_000


def test_builds_all_and_every_market(volume):
    _, summary = volume
    assert (summary['status'], summary['scopes'] >= 16, summary['keyword_latest_found']) == ('built', True, 5_000)
