"""The exports API: start, list, read, download, cancel, delete and mark seen, each for the caller's own exports only."""

from __future__ import annotations

from collections.abc import Iterator
from types import ModuleType
from typing import Any
from unittest.mock import patch

import pytest

from shared.export_contract import MAX_RUNNING_EXPORTS_PER_USER, Caller
from shared.export_steps import finalize, prepare
from testing.events import api_gateway_event, parse_response
from testing.export_fakes import FakeStepFunctions
from testing.export_fixtures import ALICE, BOB, BUCKET, ExportHarness, citations_source, export_handler_fixture

_ADMIN = Caller(sub='sub-admin', email='admin@example.com', groups=frozenset({'Admin'}))

exports_api = export_handler_fixture(__file__, 'exports.py', 'exports_api_handler')


class Api:
    """The handler over one harness, called as a given user."""

    def __init__(self, module: ModuleType, harness: ExportHarness, sfn: FakeStepFunctions) -> None:
        self.module, self.harness, self.sfn = module, harness, sfn

    def call(self, method: str, path: str, caller: Caller | None = ALICE, **options: Any) -> tuple[int, Any]:
        export_id = path.split('/')[3] if path.count('/') >= 3 else None
        claims = None if caller is None else {'sub': caller.sub, 'email': caller.email, 'cognito:groups': ','.join(caller.groups)}
        event = api_gateway_event(method, path, claims=claims, path_params={'id': export_id} if export_id else None, **options)
        response = self.module.handler(event, None)
        return (204, None) if response['statusCode'] == 204 else parse_response(response)

    def start(self, caller: Caller = ALICE, **body: Any) -> tuple[int, Any]:
        return self.call('POST', '/api/exports', caller, body={'view': 'citations', 'params': {}, 'format': 'csv', **body})

    def started_id(self, caller: Caller = ALICE) -> str:
        status, body = self.start(caller)
        assert status == 202
        return str(body['export']['export_id'])

    def finished_id(self, caller: Caller = ALICE) -> str:
        export_id = self.started_id(caller)
        prepare(self.harness.deps, export_id)
        self.harness.write_all(export_id)
        finalize(self.harness.deps, export_id)
        return export_id

    def get(self, export_id: str, caller: Caller = ALICE) -> tuple[int, Any]:
        return self.call('GET', f'/api/exports/{export_id}', caller)

    def delete(self, export_id: str, caller: Caller = ALICE) -> int:
        return self.call('DELETE', f'/api/exports/{export_id}', caller)[0]

    def cancel_running(self) -> tuple[int, str]:
        """Start an export, run Prepare and DELETE it: the status and the export id."""
        export_id = self.started_id()
        prepare(self.harness.deps, export_id)
        return self.delete(export_id), export_id


@pytest.fixture
def api(exports_api: ModuleType) -> Iterator[Api]:
    harness = ExportHarness(citations_source(20))
    sfn = FakeStepFunctions()
    with (
        patch.object(exports_api, 's3', harness.s3),
        patch.object(exports_api, 'sfn', sfn),
        patch.object(exports_api, 'exports_table', harness.table),
        patch.object(exports_api, 'export_sources', return_value={harness.source.view: harness.source}),
        patch.object(exports_api, 'utc_now', return_value=harness.deps.now()),
    ):
        yield Api(exports_api, harness, sfn)


class TestStart:
    def test_answers_202_with_the_queued_export(self, api: Api) -> None:
        status, body = api.start(params={'keyword': 'hotel'})

        assert (status, body['export']['status'], body['export']['params']) == (202, 'queued', {'keyword': 'hotel'})

    def test_starts_the_export_execution_named_after_the_export(self, api: Api) -> None:
        export_id = api.started_id()

        assert (api.sfn.started[0]['name'], api.sfn.started[0]['input']) == (export_id, f'{{"export_id": "{export_id}"}}')

    def test_drops_the_paging_params(self, api: Api) -> None:
        _status, body = api.start(params={'keyword': 'hotel', 'limit': '50', 'next_token': 'x', 'brands_next_token': 'y'})

        assert body['export']['params'] == {'keyword': 'hotel'}

    @pytest.mark.parametrize(('body', 'field'), [
        ({'view': 'nope'}, 'view'),
        ({'format': 'pdf'}, 'format'),
        ({'params': {'keyword': 3}}, 'params'),
        ({'params': ['keyword']}, 'params'),
    ])
    def test_refuses_an_invalid_field(self, api: Api, body: dict[str, Any], field: str) -> None:
        status, answer = api.start(**body)

        assert (status, answer['field']) == (400, field)

    def test_refuses_params_the_view_source_refuses(self, api: Api) -> None:
        api.harness.source.refused = 'keyword_id is not a keyword'
        status, answer = api.start()

        assert (status, answer['error']) == (400, 'keyword_id is not a keyword')

    def test_refuses_a_view_without_a_row_source(self, api: Api) -> None:
        status, answer = api.start(view='alerts')

        assert (status, answer['error']) == (400, 'view alerts cannot be exported yet')

    def test_refuses_a_body_that_is_not_an_object(self, api: Api) -> None:
        status, answer = api.call('POST', '/api/exports', body=['citations'])

        assert (status, answer['field']) == (400, 'body')

    def test_answers_429_when_the_caller_already_runs_the_maximum(self, api: Api) -> None:
        for _ in range(MAX_RUNNING_EXPORTS_PER_USER):
            api.started_id()
        status, answer = api.start()

        assert (status, answer['code']) == (429, 'too_many_exports')

    def test_another_users_running_exports_do_not_count(self, api: Api) -> None:
        for _ in range(MAX_RUNNING_EXPORTS_PER_USER):
            api.started_id(BOB)

        assert api.start()[0] == 202

    def test_a_cancelled_export_frees_its_running_slot(self, api: Api) -> None:
        first = api.started_id()
        for _ in range(MAX_RUNNING_EXPORTS_PER_USER - 1):
            api.started_id()
        api.delete(first)

        assert api.start()[0] == 202

    def test_finished_exports_do_not_count(self, api: Api) -> None:
        for _ in range(MAX_RUNNING_EXPORTS_PER_USER):
            api.finished_id()

        assert api.start()[0] == 202

    def test_a_failed_start_marks_the_export_failed(self, api: Api) -> None:
        with patch.object(api.sfn, 'start_execution', side_effect=RuntimeError('throttled')):
            status, _body = api.start()
        item = next(iter(api.harness.table.rows.values()))

        assert (status, item['status']) == (500, 'failed')

    def test_a_request_without_a_caller_is_forbidden(self, api: Api) -> None:
        assert api.call('POST', '/api/exports', caller=None, body={})[0] == 403


class TestList:
    def test_lists_only_the_callers_exports_newest_first(self, api: Api) -> None:
        first = api.started_id()
        api.started_id(BOB)
        with patch.object(api.module, 'utc_now', return_value=api.harness.deps.now().replace(minute=45)):
            second = api.started_id()
        _status, body = api.call('GET', '/api/exports')

        assert [export['export_id'] for export in body['exports']] == [second, first]

    def test_follows_next_token_to_every_export(self, api: Api) -> None:
        ids = {api.finished_id() for _ in range(3)}
        _status, page = api.call('GET', '/api/exports', query={'limit': '2'})
        _status, rest = api.call('GET', '/api/exports', query={'limit': '2', 'next_token': page['next_token']})

        assert ({export['export_id'] for export in page['exports'] + rest['exports']}, rest['next_token']) == (ids, None)

    def test_refuses_another_users_next_token(self, api: Api) -> None:
        for _ in range(2):
            api.finished_id(BOB)
        _status, page = api.call('GET', '/api/exports', BOB, query={'limit': '1'})

        assert api.call('GET', '/api/exports', query={'next_token': page['next_token']})[0] == 400

    @pytest.mark.parametrize('limit', ['0', '101', 'ten'])
    def test_refuses_a_limit_out_of_range(self, api: Api, limit: str) -> None:
        assert api.call('GET', '/api/exports', query={'limit': limit})[0] == 400

    def test_never_lists_a_download_url(self, api: Api) -> None:
        api.finished_id()
        _status, body = api.call('GET', '/api/exports')

        assert 'download_url' not in body['exports'][0]


class TestGet:
    @pytest.mark.parametrize('caller', [ALICE, _ADMIN], ids=['user', 'admin'])
    def test_another_users_export_is_not_found(self, api: Api, caller: Caller) -> None:
        assert api.get(api.started_id(BOB), caller)[0] == 404

    def test_a_running_export_has_no_download_url(self, api: Api) -> None:
        _status, body = api.get(api.started_id())

        assert 'download_url' not in body['export']

    def test_a_ready_export_has_a_download_url_and_its_expiry(self, api: Api) -> None:
        export_id = api.finished_id()
        _status, body = api.get(export_id)

        assert (body['export']['download_url'].startswith(f'https://bucket.example/exports/sub-alice/{export_id}/'), body['export']['download_expires_at']) == (True, '2026-11-06T09:45:00.000000Z')

    def test_presigns_only_the_callers_own_key_for_15_minutes_as_an_attachment(self, api: Api) -> None:
        export_id = api.finished_id()
        api.get(export_id)
        presigned = api.harness.s3.presigned[0]
        filename = api.harness.item(export_id)['filename']

        assert presigned == {
            'method': 'get_object', 'expires_in': 900,
            'params': {'Bucket': BUCKET, 'Key': f'exports/sub-alice/{export_id}/{filename}', 'ResponseContentDisposition': f'attachment; filename="{filename}"'},
        }

    def test_refuses_to_presign_a_key_outside_the_callers_prefix(self, api: Api) -> None:
        export_id = api.finished_id()
        with patch.object(api.module, 'file_key', return_value=f'exports/sub-bob/{export_id}/x.csv'):
            status, _body = api.get(export_id)

        assert (status, api.harness.s3.presigned) == (500, [])


class TestDelete:
    def test_cancelling_a_running_export_stops_its_execution(self, api: Api) -> None:
        _status, export_id = api.cancel_running()

        assert api.sfn.stopped == [{'executionArn': api.sfn.started[0]['stateMachineArn'].replace('stateMachine', 'execution') + f':{export_id}', 'cause': 'Cancelled by its owner'}]

    def test_cancelling_marks_the_export_cancelled_and_aborts_its_upload(self, api: Api) -> None:
        status, export_id = api.cancel_running()

        assert (status, api.harness.item(export_id)['status'], api.harness.s3.aborted) == (204, 'cancelled', ['upload-1'])

    def test_a_cancelled_export_writes_no_more_chunks(self, api: Api) -> None:
        _status, export_id = api.cancel_running()

        with pytest.raises(RuntimeError, match='is cancelled, not running'):
            api.harness.run_chunk(export_id)

    def test_deleting_a_finished_export_removes_its_file_and_item(self, api: Api) -> None:
        export_id = api.finished_id()
        status = api.delete(export_id)

        assert (status, [key for key in api.harness.s3.objects if export_id in key], api.harness.deps.jobs.get(export_id)) == (204, [], None)

    def test_another_users_export_is_not_found_and_kept(self, api: Api) -> None:
        export_id = api.finished_id(BOB)
        status = api.delete(export_id)

        assert (status, api.harness.item(export_id)['status']) == (404, 'ready')


class TestSeen:
    def test_marks_the_export_notified(self, api: Api) -> None:
        export_id = api.finished_id()
        _status, body = api.call('POST', f'/api/exports/{export_id}/seen')

        assert (body['export']['notified'], api.harness.item(export_id)['notified']) == (True, True)

    def test_another_users_export_is_not_found(self, api: Api) -> None:
        export_id = api.finished_id(BOB)

        assert api.call('POST', f'/api/exports/{export_id}/seen')[0] == 404

    def test_an_unknown_method_is_refused(self, api: Api) -> None:
        export_id = api.started_id()

        assert api.call('PUT', f'/api/exports/{export_id}')[0] == 400
