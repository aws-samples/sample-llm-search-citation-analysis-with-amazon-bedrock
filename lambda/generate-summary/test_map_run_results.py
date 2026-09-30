"""
Tests for GenerateSummary reading the ProcessKeywords Distributed Map's results from S3.

The Map writes one record per keyword through its ResultWriter instead of
returning them in the state (256 KiB, ~31 keywords of the old inline results),
so the summary is built from the ResultWriter manifest and results files, and
only a compact report goes back into the state.
"""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from map_run_results import MapRunResultsError, load_keyword_results

from testing.env import cleared_env
from testing.map_run_fixtures import (
    RUN_TIMESTAMP,
    child_record,
    compact_keyword_result,
    fake_s3_objects,
    map_run_objects,
    map_run_pointer,
)
from testing.module_loader import load_handler_module_offline

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_SUMMARY_BUCKET = 'citation-analysis-keywords-123456789012'


@pytest.fixture
def summary():
    """A freshly imported summary module with no bucket configured in the environment."""
    with cleared_env('SUMMARY_BUCKET'):
        return load_handler_module_offline(_HANDLER_DIR, 'handler.py', 'generate_summary_map_run_under_test')


def _workflow_event(keyword_count: int) -> dict[str, Any]:
    return {
        'execution_id': 'analysis-20261001100000',
        'map_run': map_run_pointer(),
        'keyword_count': keyword_count,
        'timestamp': RUN_TIMESTAMP,
        'summary_bucket': _SUMMARY_BUCKET,
    }


def _summarize(summary, objects: dict, keyword_count: int) -> dict[str, Any]:
    """Run the handler as the workflow does, with ``objects`` as the S3 contents."""
    s3 = fake_s3_objects(objects)
    with patch.object(summary, 's3_client', s3):
        report = summary.handler(_workflow_event(keyword_count), None)
    return {'report': report, 'stored': json.loads(s3.put_object.call_args.kwargs['Body'])}


class TestKeywordResultsFromTheMapRun:
    def test_returns_each_succeeded_child_output_unchanged(self) -> None:
        output = compact_keyword_result('hotel spa')
        objects = map_run_objects([child_record('hotel spa', output=output)])

        results = load_keyword_results(fake_s3_objects(objects), map_run_pointer(), 1)

        assert results == [output]

    def test_reports_a_failed_child_as_a_failed_keyword_named_from_its_input(self) -> None:
        objects = map_run_objects([], failed=[child_record('hotel beach', status='FAILED')])

        results = load_keyword_results(fake_s3_objects(objects), map_run_pointer(), 1)

        assert results == [{
            'keyword': 'hotel beach',
            'timestamp': RUN_TIMESTAMP,
            'status': 'failed',
            'error': 'States.TaskFailed',
        }]

    def test_counts_keywords_without_a_record_as_missing_failures(self) -> None:
        objects = map_run_objects([child_record('hotel spa')])

        results = load_keyword_results(fake_s3_objects(objects), map_run_pointer(), 3, RUN_TIMESTAMP)

        assert results[1:] == [{'timestamp': RUN_TIMESTAMP, 'status': 'failed', 'error': 'result_missing'}] * 2

    def test_raises_when_the_map_output_names_no_results_manifest(self) -> None:
        with pytest.raises(MapRunResultsError, match='no ResultWriterDetails'):
            load_keyword_results(MagicMock(), {'MapRunArn': 'arn'}, 1)


class TestCompactReportFromTheMapRun:
    @pytest.fixture
    def summarized(self, summary) -> dict[str, Any]:
        """Two succeeded keywords and one failed one."""
        objects = map_run_objects(
            [child_record('hotel spa'), child_record('hotel beach')],
            failed=[child_record('hotel golf', status='FAILED')],
        )
        return _summarize(summary, objects, 3)

    def test_counts_succeeded_and_failed_children(self, summarized) -> None:
        assert summarized['report']['summary']['keywords'] == {
            'total': 3, 'successful': 2, 'failed': 1, 'success_rate': pytest.approx(200 / 3),
        }

    def test_sums_the_compact_citation_and_crawl_counts(self, summarized) -> None:
        statistics = summarized['report']['summary']['statistics']

        assert (statistics['total_unique_citations'], statistics['total_citations_found'], statistics['total_pages_crawled']) == (8, 10, 6)

    def test_leaves_the_per_keyword_lists_out_of_the_returned_report(self, summarized) -> None:
        report = summarized['report']

        assert 'keywords_processed' not in report['summary']['statistics']
        assert 'processed_keywords' not in report['run_metadata']

    def test_reports_the_processed_keyword_count_in_the_returned_report(self, summarized) -> None:
        assert summarized['report']['run_metadata']['keyword_count'] == 3

    def test_points_the_returned_report_at_the_stored_full_report(self, summarized) -> None:
        assert summarized['report']['s3_location'].startswith(f's3://{_SUMMARY_BUCKET}/execution-summaries/')

    def test_stores_the_full_report_with_every_processed_keyword(self, summarized) -> None:
        stored_keywords = [item['keyword'] for item in summarized['stored']['run_metadata']['processed_keywords']]

        assert stored_keywords == ['hotel spa', 'hotel beach', 'hotel golf']

    def test_marks_a_run_with_a_failed_keyword_as_completed_with_errors(self, summarized) -> None:
        assert summarized['report']['status'] == 'completed_with_errors'


class TestSummaryStorageIsRequired:
    def test_raises_when_the_full_report_cannot_be_stored(self, summary) -> None:
        s3 = fake_s3_objects(map_run_objects([child_record('hotel spa')]))
        s3.put_object.side_effect = OSError('connection reset')

        with patch.object(summary, 's3_client', s3), pytest.raises(summary.SummaryStorageError, match='Failed to store'):
            summary.handler(_workflow_event(1), None)

    def test_raises_for_a_workflow_run_with_no_summary_bucket(self, summary) -> None:
        event = {**_workflow_event(1), 'summary_bucket': None}
        s3 = fake_s3_objects(map_run_objects([child_record('hotel spa')]))

        with patch.object(summary, 's3_client', s3), pytest.raises(summary.SummaryStorageError, match='No summary bucket'):
            summary.handler(event, None)

    def test_returns_the_full_report_for_a_direct_invocation_with_no_bucket(self, summary) -> None:
        report = summary.handler({'execution_id': 'exec-1', 'keyword_results': [compact_keyword_result('hotel spa')]}, None)

        assert report['run_metadata']['processed_keywords'] == [{'keyword': 'hotel spa', 'timestamp': RUN_TIMESTAMP}]
