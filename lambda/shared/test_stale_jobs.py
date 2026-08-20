"""
Tests for shared.stale_jobs.stale_elapsed_seconds.

This is the elapsed-time check behind the reader-side sweep that makes a
SIGKILLed background worker observable (AUDIT-2026-08-19 §2.9). The boundary
behavior matters in both directions:

- too eager and it marks live jobs failed, which then flip back to success
- too lax and dead rows sit non-terminal forever, spinning the UI

so the threshold comparison and the unparseable-input handling are pinned here
rather than being rediscovered at each of the three call sites.
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared.stale_jobs import stale_elapsed_seconds

NOW = datetime(2026, 8, 19, 12, 0, 0, tzinfo=UTC)


def _iso(offset_seconds: float) -> str:
    """Timestamp `offset_seconds` before NOW, in the 'Z' form rows use."""
    moment = NOW - timedelta(seconds=offset_seconds)
    return moment.isoformat().replace('+00:00', 'Z')


class TestStaleDetection:
    def test_returns_elapsed_seconds_once_past_the_budget(self):
        assert stale_elapsed_seconds(_iso(400), 360, now=NOW) == 400

    def test_returns_none_while_still_within_budget(self):
        assert stale_elapsed_seconds(_iso(100), 360, now=NOW) is None

    def test_returns_none_exactly_at_the_budget(self):
        """
        A job at exactly its budget may still be finishing, so the comparison
        is strictly greater-than. Marking it failed here is the inconsistency
        the sweep exists to avoid.
        """
        assert stale_elapsed_seconds(_iso(360), 360, now=NOW) is None

    def test_returns_elapsed_one_second_past_the_budget(self):
        """The other side of the boundary, so the comparison can't be inverted."""
        assert stale_elapsed_seconds(_iso(361), 360, now=NOW) == 361

    def test_returns_none_for_a_future_timestamp(self):
        """Clock skew must not be reported as a very stale job."""
        assert stale_elapsed_seconds(_iso(-120), 360, now=NOW) is None


class TestTimestampParsing:
    def test_reads_a_trailing_z_as_utc(self):
        """
        Rows are written with a 'Z' suffix. Read as naive local time this would
        be off by the offset, so a stale job could look fresh or vice versa.
        """
        assert stale_elapsed_seconds('2026-08-19T11:50:00Z', 300, now=NOW) == 600

    def test_reads_an_explicit_offset(self):
        assert stale_elapsed_seconds('2026-08-19T11:50:00+00:00', 300, now=NOW) == 600

    def test_compares_naive_timestamps_without_raising(self):
        """
        Historical rows predate offset-carrying timestamps. Subtracting naive
        from aware raises TypeError, which would take out the whole read.
        """
        assert stale_elapsed_seconds('2026-08-19T11:50:00', 300, now=NOW) == 600


class TestUnparseableInputIsTreatedAsHealthy:
    """
    A parse failure must not mark a healthy in-flight job failed — the sweep
    would then be destroying good work on the basis of bad metadata.
    """

    def test_returns_none_for_an_empty_timestamp(self):
        assert stale_elapsed_seconds('', 360, now=NOW) is None

    def test_returns_none_for_a_malformed_timestamp(self):
        assert stale_elapsed_seconds('not-a-date', 360, now=NOW) is None

    def test_logs_a_malformed_timestamp_so_the_bad_data_is_visible(self, caplog):
        with caplog.at_level('WARNING', logger='shared.stale_jobs'):
            stale_elapsed_seconds('not-a-date', 360, now=NOW)

        assert 'not-a-date' in caplog.text
