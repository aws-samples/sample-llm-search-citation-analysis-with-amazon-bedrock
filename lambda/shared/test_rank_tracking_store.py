"""Tests for rank trackers, their keywords, the run lock and run status writes."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from unittest.mock import MagicMock

import pytest

from shared.dataforseo_rank import RankCheck
from shared.rank_tracking_runs import (
    apply_check,
    apply_error,
    begin_run,
    fail_run,
    get_run,
    set_run_status,
)
from shared.rank_tracking_store import (
    LIST_SCOPE,
    MAX_KEYWORDS,
    StaleWriteError,
    Tracker,
    active_keywords_for,
    add_keywords,
    keyword_id_for,
    list_keywords,
    normalize_tracked_domain,
    put_tracker,
    remove_keywords,
    resolve_run_keywords,
    select_run_keywords,
    tracker_id_for,
)
from testing.rank_tracking_fixtures import NOW, KeywordsTable, RankTable, pair, stored_tracker, tracker


class StartFailedError(RuntimeError):
    """The state machine refused to start."""


@pytest.mark.parametrize(('text', 'domain'), [
    ('https://www.Example.com/path?q=1', 'example.com'),
    ('blog.example.com', 'blog.example.com'),
    ('example.com:8443', 'example.com'),
])
def test_normalizes_a_tracked_domain_to_its_host(text, domain):
    assert normalize_tracked_domain(text) == domain


@pytest.mark.parametrize('text', ['localhost', 'exa mple.com', '', 'bad_label.example.com'])
def test_refuses_text_that_is_not_a_public_host_name(text):
    assert normalize_tracked_domain(text) is None


def test_derives_the_same_tracker_id_for_the_same_domain_and_market():
    assert tracker_id_for('example.com', 'global') == tracker_id_for('example.com', 'global')


def test_derives_a_different_tracker_id_in_another_market():
    assert tracker_id_for('example.com', 'global') != tracker_id_for('example.com', 'cl-es')


def test_writes_no_due_index_entry_the_trackers_own_schedules_replace_it():
    assert 'gsi2sk' not in tracker().to_item()


def test_increments_the_version_on_each_write():
    table = RankTable()
    stored = put_tracker(table, tracker(version=0), None)

    assert put_tracker(table, stored, stored.version).version == 2


def test_refuses_a_write_based_on_an_outdated_version():
    table = RankTable()
    first = stored_tracker(table, version=3)

    with pytest.raises(StaleWriteError):
        put_tracker(table, replace(first, depth=50), 2)


def test_refuses_to_create_a_tracker_that_exists():
    table = RankTable()
    stored_tracker(table)

    with pytest.raises(StaleWriteError):
        put_tracker(table, tracker(), None)


def test_adds_only_keywords_the_tracker_does_not_have():
    table = RankTable()
    add_keywords(table, 'rt-example', ['cheap flights'], '2026-10-01T00:00:00.000000Z')

    added = add_keywords(table, 'rt-example', ['cheap flights', 'late flights'], '2026-10-02T00:00:00.000000Z')

    assert (added, [entry.keyword for entry in list_keywords(table, 'rt-example')]) == (1, ['late flights', 'cheap flights'])


def test_removes_only_keywords_the_tracker_has():
    table = RankTable()
    add_keywords(table, 'rt-example', ['cheap flights'], '2026-10-01T00:00:00.000000Z')

    removed = remove_keywords(table, 'rt-example', [keyword_id_for('cheap flights'), 'kw-unknown'])

    assert (removed, list_keywords(table, 'rt-example')) == (1, [])


def test_checks_a_keyword_in_both_the_group_and_the_list_once():
    table, keywords = RankTable(), KeywordsTable()
    add_keywords(table, 'rt-example', ['cheap flights'], '2026-10-01T00:00:00.000000Z')
    keywords.add('Cheap Flights', group_ids=['g-1'])
    keywords.add('flight deals', group_ids=['g-1'])

    found = resolve_run_keywords(table, keywords, tracker(keyword_scope='group', group_id='g-1'))

    assert [(entry.keyword, entry.source) for entry in found] == [('cheap flights', 'list'), ('flight deals', 'group')]


def test_checks_every_active_keyword_of_the_trackers_market():
    keywords = KeywordsTable()
    keywords.add('hotel santiago', market_id='cl-es')
    keywords.add('hotel madrid', market_id='es-es')
    keywords.add('paused hotel', market_id='cl-es', status='paused')

    found = resolve_run_keywords(RankTable(), keywords, tracker(market_id='cl-es'))

    assert [(entry.keyword, entry.source) for entry in found] == [('hotel santiago', 'market')]


def _global_run_keywords(keywords: KeywordsTable) -> list[str]:
    """The keyword texts a run of the global market tracker checks."""
    return [entry.keyword for entry in resolve_run_keywords(RankTable(), keywords, tracker())]


def test_checks_the_keywords_without_a_market_for_a_global_tracker():
    keywords = KeywordsTable()
    keywords.add('hotel santiago', market_id='cl-es')
    keywords.add('boutique hotel')

    assert _global_run_keywords(keywords) == ['boutique hotel']


def test_picks_up_a_keyword_added_in_settings_after_the_tracker_was_created():
    keywords = KeywordsTable()
    keywords.add('boutique hotel')
    _global_run_keywords(keywords)
    keywords.add('spa hotel')

    assert _global_run_keywords(keywords) == ['boutique hotel', 'spa hotel']


def test_reads_no_settings_keywords_for_a_tracker_of_extra_keywords_only():
    keywords = KeywordsTable()
    keywords.add('boutique hotel')

    found = resolve_run_keywords(RankTable(), keywords, tracker(keyword_scope=LIST_SCOPE))

    assert (found, keywords.queries) == ([], 0)


def test_reads_the_settings_keywords_once_for_several_trackers():
    keywords = KeywordsTable()

    active_keywords_for(keywords, [tracker(), tracker(tracker_id='rt-other', market_id='cl-es')])

    assert keywords.queries == 1


def test_caps_a_larger_scope_at_the_keyword_limit_and_counts_the_rest():
    keywords = KeywordsTable()
    for index in range(MAX_KEYWORDS + 5):
        keywords.add(f'keyword {index:04d}')

    selection = select_run_keywords(RankTable(), active_keywords_for(keywords, [tracker()]), tracker())

    assert (len(selection.keywords), selection.total) == (MAX_KEYWORDS, MAX_KEYWORDS + 5)


@pytest.mark.parametrize(('stored', 'scope'), [
    ({'group_id': 'g-1'}, 'group'),
    ({}, LIST_SCOPE),
    ({'keyword_scope': 'all'}, 'all'),
])
def test_reads_a_tracker_stored_without_a_scope_by_its_group(stored, scope):
    item = {key: value for key, value in tracker().to_item().items() if key != 'keyword_scope'}

    assert Tracker.from_item({**item, **stored}).keyword_scope == scope


def test_starts_a_run_with_the_run_id_as_the_execution_name():
    table = RankTable()
    started = MagicMock()

    run, _blocking = begin_run(table, started, tracker(), 'manual', NOW)

    assert run is not None
    started.assert_called_once_with(run['run_id'], {'tracker_id': 'rt-example', 'run_id': run['run_id']})


def test_refuses_a_second_run_while_one_is_active():
    table = RankTable()
    first, _ = begin_run(table, MagicMock(), tracker(), 'manual', NOW)

    second, blocking = begin_run(table, MagicMock(), tracker(), 'manual', NOW + timedelta(minutes=1))

    assert first is not None
    assert (second, blocking) == (None, first['run_id'])


def test_takes_over_a_lock_that_expired():
    table = RankTable()
    begin_run(table, MagicMock(), tracker(), 'manual', NOW)

    run, blocking = begin_run(table, MagicMock(), tracker(), 'manual', NOW + timedelta(hours=5))

    assert (run is not None, blocking) == (True, None)


def test_fails_the_run_and_frees_the_tracker_when_the_state_machine_does_not_start():
    table = RankTable()

    with pytest.raises(StartFailedError):
        begin_run(table, MagicMock(side_effect=StartFailedError('down')), tracker(), 'manual', NOW)
    run, _ = begin_run(table, MagicMock(), tracker(), 'manual', NOW)

    assert run is not None


def _started(table: RankTable, trigger: str = 'manual', tracker_id: str = 'rt-example') -> dict:
    """A run of ``tracker_id`` begun now with a state machine that starts."""
    run, _blocking = begin_run(table, MagicMock(), tracker(tracker_id=tracker_id), trigger, NOW)
    assert run is not None
    return run


def test_marks_a_manual_run_live_and_a_scheduled_run_queued():
    table = RankTable()

    assert (_started(table, 'manual', 'a')['method'], _started(table, 'scheduled', 'b')['method']) == ('live', 'queued')


def test_never_resurrects_a_run_that_already_failed():
    table = RankTable()
    run = _started(table)
    fail_run(table, 'rt-example', run['run_id'], 'WORKFLOW_FAILED', 'stopped', NOW)

    with pytest.raises(StaleWriteError):
        set_run_status(table, run, ('pending', 'running'), status='running')


def test_does_not_fail_a_run_that_already_ended():
    table = RankTable()
    run = set_run_status(table, _started(table), ('pending',), status='completed')

    assert (fail_run(table, 'rt-example', run['run_id'], 'X', 'y', NOW),
            (get_run(table, 'rt-example', run['run_id']) or {}).get('status')) == (False, 'completed')


def test_keeps_the_better_position_when_a_recheck_finds_a_lower_one():
    first = apply_check(pair('k', 'desktop'), RankCheck(3, 4, 'https://example.com/a', ('organic',)), 't1')

    second = apply_check(first, RankCheck(15, 16, 'https://example.com/b', ('organic',)), 't2')

    assert (second['position'], second['url'], second['checked_at']) == (3, 'https://example.com/a', 't1')


def test_replaces_a_miss_with_a_find_from_a_recheck():
    first = apply_check(pair('k', 'desktop'), RankCheck(None, None, None, ()), 't1')

    second = apply_check(first, RankCheck(8, 9, 'https://example.com/a', ('organic',)), 't2')

    assert (second['position'], second['answered']) == (8, True)


def test_keeps_an_earlier_answer_when_a_recheck_fails():
    answered = pair('k', 'desktop', status='queued', answered=True, position=4, task_id='t-1')

    assert (apply_error(answered, 'TASK_FAILED')['status'], 'task_id' in apply_error(answered, 'X')) == ('answered', False)


def test_marks_an_unanswered_pair_as_an_error_when_its_check_fails():
    assert apply_error(pair('k', 'desktop', status='sent'), 'UPSTREAM_UNAVAILABLE')['status'] == 'error'
