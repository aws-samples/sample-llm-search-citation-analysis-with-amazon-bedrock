"""The export state machine's steps: status changes, retries, failure clean-up and stalls."""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.export_contract import Caller
from shared.export_jobs import StaleExportError
from shared.export_source_lists import CONFIG_LISTS
from shared.export_source_routes import Paging, RouteList, RouteSource, columns
from shared.export_steps import (
    STALL_LIMIT,
    ExportPermissionError,
    ExportStepError,
    abort_upload,
    chunk,
    error_message,
    fail,
    finalize,
    prepare,
)
from testing.clocks import JumpClock, SleepClock
from testing.export_fixtures import BUCKET, CHUNK_SECONDS, ExportHarness, citations_source, csv_lines
from testing.export_source_fixtures import PagedRoute, numbered_items


@pytest.fixture
def harness() -> ExportHarness:
    return ExportHarness(citations_source(300, per_chunk=100))


def _checkpoint_keys(harness: ExportHarness) -> list[str]:
    return [key for key in harness.s3.objects if 'checkpoint-' in key]


def _failed_after_one_chunk(harness: ExportHarness) -> str:
    export_id = harness.start()
    harness.run_chunk(export_id)
    fail(harness.deps, export_id, {'Error': 'States.Timeout', 'Cause': 'x'})
    return export_id


class TestPrepare:
    def test_marks_the_export_running_with_a_multipart_upload(self, harness: ExportHarness) -> None:
        item = harness.item(harness.start())

        assert (item['status'], item['upload_id']) == ('running', 'upload-1')

    def test_a_retry_after_success_starts_no_second_upload(self, harness: ExportHarness) -> None:
        prepare(harness.deps, harness.start())

        assert list(harness.s3.uploads) == ['upload-1']

    def test_a_cancelled_export_does_not_start(self, harness: ExportHarness) -> None:
        export_id = harness.queue('csv')
        harness.set_status(export_id, 'cancelled')

        with pytest.raises(ExportStepError, match='is cancelled, not queued'):
            prepare(harness.deps, export_id)

    def test_the_upload_downloads_as_an_attachment_with_the_filename(self, harness: ExportHarness) -> None:
        filename = harness.item(harness.start())['filename']

        assert harness.s3.uploads['upload-1']['params']['ContentDisposition'] == f'attachment; filename="{filename}"'


_ADMIN_OWNER = Caller(sub='sub-admin', email='admin@example.com', groups=frozenset({'Admin'}), username='admin@example.com')


def _admin_owner_export(live_groups: frozenset[str] | None, list_name: str) -> tuple[ExportHarness[RouteSource], str, list[str]]:
    """
    A queued config-lists export of ``list_name`` by an owner who was an Admin when they queued it.

    ``live_groups`` are the owner's Cognito groups now (``None``: an unknown
    user); the third value lists the user names looked up.
    """
    looked_up: list[str] = []

    def groups_of(username: str) -> frozenset[str]:
        looked_up.append(username)
        if live_groups is None:
            raise ExportPermissionError('no such user')
        return live_groups

    harness = ExportHarness(replace(CONFIG_LISTS, invoker=PagedRoute(numbered_items(2), list_key='users')), groups_of=groups_of)
    return harness, harness.queue('csv', _ADMIN_OWNER, {'list': list_name}), looked_up


class TestPrepareRechecksAdminLists:
    """An Admin-only export runs only while its owner is still an Admin (review F12)."""

    def test_an_owner_removed_from_admin_after_the_post_cannot_start_the_export(self) -> None:
        harness, export_id, _looked_up = _admin_owner_export(frozenset({'Users'}), 'users')

        with pytest.raises(ExportPermissionError, match='Only an Admin may export this list'):
            prepare(harness.deps, export_id)

    @pytest.mark.parametrize(('live_groups', 'list_name', 'looked_up_names'), [
        (frozenset({'Admin'}), 'users', ['admin@example.com']),
        (None, 'keywords', []),
    ], ids=['still-admin-after-a-lookup', 'any-user-list-without-a-lookup'])
    def test_an_owner_who_may_still_export_the_list_starts_it(
        self, live_groups: frozenset[str] | None, list_name: str, looked_up_names: list[str],
    ) -> None:
        harness, export_id, looked_up = _admin_owner_export(live_groups, list_name)
        prepare(harness.deps, export_id)

        assert (harness.item(export_id)['status'], looked_up) == ('running', looked_up_names)


class TestChunk:
    def test_checkpoints_rows_bytes_and_the_cursor_after_a_partial_chunk(self, harness: ExportHarness) -> None:
        export_id = harness.start()
        harness.run_chunk(export_id)
        item = harness.item(export_id)

        assert (item['rows'], item['cursor'], item['chunks'], item['parts'] > 0) == (100, '{"next":100}', 1, True)

    def test_a_chunk_retried_after_a_crash_before_its_checkpoint_write_writes_the_same_file(
        self, harness: ExportHarness, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        whole = ExportHarness(citations_source(300)).run('csv')
        export_id = harness.start()
        harness.run_chunk(export_id)
        real_put = harness.table.put_item
        monkeypatch.setattr(harness.table, 'put_item', lambda **_params: (_ for _ in ()).throw(ExportStepError('crash')))
        with pytest.raises(ExportStepError, match='crash'):
            harness.run_chunk(export_id)
        monkeypatch.setattr(harness.table, 'put_item', real_put)
        harness.write_all(export_id)
        finalize(harness.deps, export_id)

        assert harness.s3.body(harness.file_key(export_id)) == whole

    def test_keeps_only_the_latest_checkpoint_object(self, harness: ExportHarness) -> None:
        export_id = harness.start()
        harness.run_chunk(export_id)
        harness.run_chunk(export_id)

        assert _checkpoint_keys(harness) == [f'exports/sub-alice/{export_id}/checkpoint-000002']

    def test_a_chunk_after_the_last_one_answers_done(self, harness: ExportHarness) -> None:
        export_id = harness.start()
        harness.write_all(export_id)

        assert harness.run_chunk(export_id) is True

    def test_fails_after_chunks_that_write_no_row(self) -> None:
        harness = ExportHarness(citations_source(10, per_chunk=0))
        export_id = harness.start()
        for _ in range(STALL_LIMIT - 1):
            harness.run_chunk(export_id)

        with pytest.raises(ExportStepError, match='made no progress'):
            harness.run_chunk(export_id)

    def test_refuses_an_export_that_is_not_running(self, harness: ExportHarness) -> None:
        export_id = harness.queue('csv')

        with pytest.raises(ExportStepError, match='is queued, not running'):
            chunk(harness.deps, export_id, harness.source.clock.deadline(600))

    def test_refuses_a_view_without_a_row_source(self, harness: ExportHarness) -> None:
        export_id = harness.start()
        harness.deps.jobs.save(harness.item(export_id), harness.deps.now(), view='alerts')

        with pytest.raises(ExportStepError, match='no row source for view alerts'):
            harness.run_chunk(export_id)


def _route_harness(route: PagedRoute, clock: JumpClock, sleep=None, *, limit: int = 3) -> ExportHarness[RouteSource]:
    route_list = RouteList(
        'Items', columns('name', 'rank'), 'stats-insights', '/api/items', 'items', Paging(limit=limit), matches={'name': 'name'},
    )
    source = RouteSource('sources', (route_list,), params=('name',), invoker=route, **({'sleep': sleep} if sleep else {}))
    return ExportHarness(source, clock=clock)


def _two_pages_a_chunk() -> ExportHarness[RouteSource]:
    """Ten items, three a page, behind a router so slow that the second page of a chunk answers with half a second left."""
    clock = JumpClock()
    return _route_harness(PagedRoute(numbered_items(10), clock=clock, request_seconds=(CHUNK_SECONDS - 0.5) / 2), clock)


class TestChunkEnd:
    """A chunk is done only when its source says it finished (review F1)."""

    def test_a_chunk_whose_source_stops_before_the_deadline_is_not_done(self) -> None:
        harness = ExportHarness(citations_source(10, per_chunk=4, spends_deadline=False))

        assert harness.run_chunk(harness.start()) is False

    def test_an_export_whose_source_stops_before_each_deadline_holds_every_row(self) -> None:
        data = ExportHarness(citations_source(10, per_chunk=4, spends_deadline=False)).run('csv')

        assert len(csv_lines(data)) == 11

    def test_a_route_page_answered_in_the_last_second_leaves_the_chunk_not_done(self) -> None:
        harness = _two_pages_a_chunk()

        assert harness.run_chunk(harness.start()) is False

    def test_a_route_export_stopped_near_every_deadline_holds_every_row(self) -> None:
        data = _two_pages_a_chunk().run('csv')

        assert [line[0] for line in csv_lines(data)[1:]] == [f'item-{index:03d}' for index in range(10)]

    def test_a_view_job_computing_until_the_deadline_leaves_the_file_unwritten(self) -> None:
        clock = SleepClock()
        harness = _route_harness(PagedRoute(numbered_items(3), computing_first=10_000), clock, sleep=clock.sleep)
        export_id = harness.start()

        harness.run_chunk(export_id)

        assert (harness.item(export_id).get('written'), harness.s3.uploads['upload-1']['parts']) == (None, {})


def _sparse_export() -> tuple[ExportHarness[RouteSource], str]:
    """A prepared export of the one item of 2,001 one-item pages the filter keeps, about 100 pages a chunk."""
    clock = JumpClock()
    harness = _route_harness(PagedRoute(numbered_items(2_001), clock=clock, request_seconds=CHUNK_SECONDS / 100), clock, limit=1)
    export_id = harness.queue('csv', params={'name': 'item-2000'})
    prepare(harness.deps, export_id)
    return harness, export_id


class TestSparseFilter:
    """Pages a post-read filter empties still move the checkpoint on (review F2)."""

    def test_an_export_of_one_match_after_two_thousand_empty_pages_completes_with_that_row(self) -> None:
        harness, export_id = _sparse_export()
        harness.write_all(export_id)
        finalize(harness.deps, export_id)

        assert csv_lines(harness.s3.body(harness.file_key(export_id)))[1:] == [['item-2000', '2001']]

    def test_a_chunk_that_only_reads_empty_pages_is_not_a_stall(self) -> None:
        harness, export_id = _sparse_export()
        for _ in range(STALL_LIMIT):
            harness.run_chunk(export_id)

        assert harness.item(export_id)['stalls'] == 0


def _cancel_when_a_checkpoint_is_written(harness: ExportHarness, export_id: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch the bucket so the owner cancels (``DELETE``: cancelled, upload aborted) right after a chunk's checkpoint put."""
    real_put = harness.s3.put_object

    def put_then_cancel(**params: Any) -> Any:
        stored = real_put(**params)
        if 'checkpoint-' in params['Key']:
            harness.set_status(export_id, 'cancelled')
            abort_upload(harness.s3, BUCKET, harness.item(export_id))
        return stored

    monkeypatch.setattr(harness.s3, 'put_object', put_then_cancel)


def _one_chunk_in(harness: ExportHarness) -> str:
    export_id = harness.start()
    harness.run_chunk(export_id)
    return export_id


class TestCancelDuringChunk:
    """A cancel that lands between a chunk's checkpoint put and its save leaves no checkpoint (review F9)."""

    def test_the_chunk_loses_its_save_and_leaves_no_checkpoint_object(self, harness: ExportHarness, monkeypatch: pytest.MonkeyPatch) -> None:
        export_id = _one_chunk_in(harness)
        _cancel_when_a_checkpoint_is_written(harness, export_id, monkeypatch)
        with pytest.raises(StaleExportError):
            harness.run_chunk(export_id)

        assert _checkpoint_keys(harness) == []

    def test_an_abort_removes_the_checkpoint_of_a_chunk_in_flight(self, harness: ExportHarness) -> None:
        export_id = _one_chunk_in(harness)
        harness.s3.put_object(Bucket=BUCKET, Key=f'{harness.file_key(export_id).rsplit("/", 1)[0]}/checkpoint-000002', Body=b'x')

        abort_upload(harness.s3, BUCKET, harness.item(export_id))

        assert _checkpoint_keys(harness) == []


class TestFinalize:
    def test_marks_the_export_ready_and_not_notified(self, harness: ExportHarness) -> None:
        harness.run('csv')
        item = next(iter(harness.table.rows.values()))

        assert (item['status'], item['notified'], item['rows']) == ('ready', False, 300)

    def test_removes_the_checkpoint_objects(self, harness: ExportHarness) -> None:
        harness.run('csv')

        assert _checkpoint_keys(harness) == []

    def test_a_retry_after_success_answers_ready(self, harness: ExportHarness) -> None:
        harness.run('csv')
        export_id = str(next(iter(harness.table.rows.values()))['export_id'])

        assert finalize(harness.deps, export_id) == {'export_id': export_id, 'status': 'ready'}

    def test_a_retry_whose_item_write_was_lost_marks_the_completed_file_ready(self, harness: ExportHarness) -> None:
        export_id = harness.start()
        harness.write_all(export_id)
        written = harness.item(export_id)
        finalize(harness.deps, export_id)
        harness.table.put_item(Item={**written, 'revision': harness.item(export_id)['revision']})
        finalize(harness.deps, export_id)

        assert harness.item(export_id)['status'] == 'ready'

    def test_refuses_an_export_whose_rows_are_not_all_written(self, harness: ExportHarness) -> None:
        export_id = harness.start()
        harness.run_chunk(export_id)

        with pytest.raises(ExportStepError, match='not completely written'):
            finalize(harness.deps, export_id)


class TestFail:
    def test_aborts_the_multipart_upload(self, harness: ExportHarness) -> None:
        _failed_after_one_chunk(harness)

        assert (harness.s3.aborted, harness.s3.uploads) == (['upload-1'], {})

    def test_leaves_no_file_and_no_checkpoint(self, harness: ExportHarness) -> None:
        export_id = _failed_after_one_chunk(harness)

        assert [key for key in harness.s3.objects if export_id in key] == []

    def test_marks_the_export_failed_with_the_error_type_only(self, harness: ExportHarness) -> None:
        export_id = harness.start()
        fail(harness.deps, export_id, {'Error': 'KeyError', 'Cause': '{"errorMessage": "table CitationAnalysis-Secret"}'})
        item = harness.item(export_id)

        assert (item['status'], item['error']) == ('failed', error_message({'Error': 'KeyError'}))

    def test_a_cancelled_export_stays_cancelled(self, harness: ExportHarness) -> None:
        export_id = harness.start()
        harness.set_status(export_id, 'cancelled')
        fail(harness.deps, export_id, None)

        assert harness.item(export_id)['status'] == 'cancelled'

    def test_an_upload_already_aborted_still_marks_the_export_failed(self, harness: ExportHarness) -> None:
        export_id = harness.start()
        harness.s3.abort_multipart_upload(Bucket='b', Key='k', UploadId='upload-1')
        fail(harness.deps, export_id, None)

        assert harness.item(export_id)['status'] == 'failed'

    def test_an_abort_that_s3_throttles_still_marks_the_export_failed(self, harness: ExportHarness, monkeypatch: pytest.MonkeyPatch) -> None:
        export_id = harness.start()
        slow_down = ClientError({'Error': {'Code': 'SlowDown', 'Message': 'Reduce your request rate'}}, 'AbortMultipartUpload')
        monkeypatch.setattr(harness.s3, 'abort_multipart_upload', MagicMock(side_effect=slow_down))

        assert (fail(harness.deps, export_id, None)['status'], harness.item(export_id)['status']) == ('failed', 'failed')

    def test_a_deleted_export_answers_missing(self, harness: ExportHarness) -> None:
        assert fail(harness.deps, 'exp-gone', None) == {'export_id': 'exp-gone', 'status': 'missing'}

    def test_the_message_names_the_error_type(self) -> None:
        assert error_message({'Error': 'States.TaskFailed'}).startswith('The export failed (States.TaskFailed).')
