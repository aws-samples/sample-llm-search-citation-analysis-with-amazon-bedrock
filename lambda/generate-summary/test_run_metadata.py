"""Run identity metadata tests for GenerateSummary."""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock

from testing.handler_fixtures import handler_fixture

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))

# Function scope: one test swaps the module's S3 client and bucket, so every
# test gets its own load. An empty ``SUMMARY_BUCKET`` keeps the handler off S3
# even when the shell running the suite has a bucket configured.
summary_module = handler_fixture(
    _HANDLER_DIR,
    'handler.py',
    'generate_summary_run_metadata_under_test',
    env={'SUMMARY_BUCKET': ''},
    scope='function',
)


def _result(keyword: str, timestamp: str | None) -> dict:
    item = {'status': 'success', 'keyword': keyword}
    if timestamp is not None:
        item['timestamp'] = timestamp
    return item


class TestRunMetadata:
    def test_reports_common_timestamp_with_exact_processed_keywords(self, summary_module) -> None:
        results = [
            _result('hotel spa', '2026-10-01T10:00:00Z'),
            _result('hotel beach', '2026-10-01T10:00:00Z'),
        ]

        metadata = summary_module.build_run_metadata(results)

        assert metadata == {
            'timestamp': '2026-10-01T10:00:00Z',
            'timestamps': ['2026-10-01T10:00:00Z'],
            'processed_keywords': [
                {'keyword': 'hotel spa', 'timestamp': '2026-10-01T10:00:00Z'},
                {'keyword': 'hotel beach', 'timestamp': '2026-10-01T10:00:00Z'},
            ],
        }

    def test_reports_sorted_timestamps_without_common_timestamp_when_ambiguous(self, summary_module) -> None:
        results = [
            _result('hotel spa', '2026-10-01T11:00:00Z'),
            _result('hotel beach', '2026-10-01T10:00:00Z'),
        ]

        metadata = summary_module.build_run_metadata(results)

        assert metadata['timestamp'] is None
        assert metadata['timestamps'] == [
            '2026-10-01T10:00:00Z',
            '2026-10-01T11:00:00Z',
        ]

    def test_reports_no_common_timestamp_when_one_keyword_has_none(self, summary_module) -> None:
        metadata = summary_module.build_run_metadata([
            _result('hotel spa', '2026-10-01T10:00:00Z'),
            _result('hotel beach', None),
        ])

        assert metadata['timestamp'] is None
        assert metadata['processed_keywords'][1] == {
            'keyword': 'hotel beach',
            'timestamp': None,
        }

    def test_adds_run_metadata_without_replacing_existing_report_fields(self, summary_module) -> None:
        report = summary_module.handler({
            'execution_id': 'exec-1',
            'keyword_results': [_result('hotel spa', '2026-10-01T10:00:00Z')],
        }, None)

        assert report['execution_id'] == 'exec-1'
        assert report['status'] == 'completed'
        assert report['summary']['keywords']['successful'] == 1
        assert report['run_metadata']['timestamp'] == '2026-10-01T10:00:00Z'

    def test_persists_additive_metadata_in_existing_summary_object(self, summary_module) -> None:
        summary_module.SUMMARY_BUCKET = 'summary-bucket'
        summary_module.s3_client = MagicMock()

        summary_module.handler({
            'execution_id': 'exec-1',
            'keyword_results': [_result('hotel spa', '2026-10-01T10:00:00Z')],
        }, None)

        stored = json.loads(summary_module.s3_client.put_object.call_args.kwargs['Body'])
        assert stored['execution_id'] == 'exec-1'
        assert stored['run_metadata']['processed_keywords'] == [{
            'keyword': 'hotel spa',
            'timestamp': '2026-10-01T10:00:00Z',
        }]
