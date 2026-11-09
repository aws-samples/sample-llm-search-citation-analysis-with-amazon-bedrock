"""The per-owner running-export limit: one slots item taken and freed in the same transaction as the export (review F6)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest

from shared.change_events import EXPORT_CHANGED
from shared.export_contract import MAX_RUNNING_EXPORTS_PER_USER
from shared.export_jobs import ExportJobs, NewExport, StaleExportError, TooManyExportsError, new_item, slots_key
from testing.assertions import present
from testing.export_fakes import exports_table
from testing.export_fixtures import ALICE, BOB, NOW

_CONCURRENT_POSTS = 10


def _queued(caller=ALICE) -> dict:
    return new_item(NewExport(caller, 'citations', {}, 'csv'), NOW)


def _create_or_refuse(jobs: ExportJobs) -> str:
    try:
        jobs.create(_queued())
    except TooManyExportsError:
        return 'refused'
    return 'created'


@pytest.fixture
def jobs() -> ExportJobs:
    return ExportJobs(exports_table())


def _fill(jobs: ExportJobs) -> list[dict]:
    return [jobs.create(_queued()) for _ in range(MAX_RUNNING_EXPORTS_PER_USER)]


def test_concurrent_posts_create_exactly_the_limit_and_refuse_the_rest(jobs: ExportJobs) -> None:
    with ThreadPoolExecutor(max_workers=_CONCURRENT_POSTS) as pool:
        outcomes = sorted(pool.map(lambda _index: _create_or_refuse(jobs), range(_CONCURRENT_POSTS)))

    assert outcomes == ['created'] * 5 + ['refused'] * 5


def test_one_more_export_than_the_limit_is_refused(jobs: ExportJobs) -> None:
    _fill(jobs)

    with pytest.raises(TooManyExportsError):
        jobs.create(_queued())


def test_a_refused_export_is_not_stored(jobs: ExportJobs) -> None:
    _fill(jobs)
    refused = _queued()
    with pytest.raises(TooManyExportsError):
        jobs.create(refused)

    assert jobs.get(refused['export_id']) is None


def test_another_owners_exports_take_none_of_the_slots(jobs: ExportJobs) -> None:
    for _ in range(MAX_RUNNING_EXPORTS_PER_USER):
        jobs.create(_queued(BOB))

    assert jobs.create(_queued())['owner'] == ALICE.sub


@pytest.mark.parametrize('status', ['ready', 'failed', 'cancelled'])
def test_an_export_that_stops_running_frees_its_slot(jobs: ExportJobs, status: str) -> None:
    first = _fill(jobs)[0]
    jobs.save(first, NOW, status=status)

    assert jobs.create(_queued())['status'] == 'queued'


def test_a_save_that_keeps_the_export_running_keeps_its_slot(jobs: ExportJobs) -> None:
    first = _fill(jobs)[0]
    jobs.save(first, NOW, status='running', upload_id='upload-1')

    with pytest.raises(TooManyExportsError):
        jobs.create(_queued())


def test_a_retried_finishing_save_frees_only_one_slot(jobs: ExportJobs) -> None:
    first = _fill(jobs)[0]
    jobs.save(first, NOW, status='ready')
    with pytest.raises(StaleExportError):
        jobs.save(first, NOW, status='ready')
    jobs.create(_queued())

    with pytest.raises(TooManyExportsError):
        jobs.create(_queued())


def test_a_slot_whose_export_is_gone_is_taken_back(jobs: ExportJobs) -> None:
    first = _fill(jobs)[0]
    jobs.delete(first['export_id'])

    assert jobs.create(_queued())['status'] == 'queued'


def test_the_slots_item_is_not_an_export_of_its_owner(jobs: ExportJobs) -> None:
    jobs.create(_queued())

    assert jobs.owned(slots_key(ALICE.sub), ALICE.sub) is None


def test_a_status_change_is_announced_to_its_owner(jobs: ExportJobs, change_events_bus) -> None:
    created = jobs.create(_queued())
    running = jobs.save(created, NOW, status='running', upload_id='upload-1')
    jobs.save(running, NOW, written=10)
    jobs.save(present(jobs.get(created['export_id'])), NOW, status='ready')

    assert change_events_bus.details(EXPORT_CHANGED) == [
        {'export_id': created['export_id'], 'status': status, 'owner_sub': ALICE.sub} for status in ('running', 'ready')
    ]
