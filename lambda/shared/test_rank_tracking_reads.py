"""Tests for finalizing a run's answers and for the results, history and trend reads."""

from __future__ import annotations

from datetime import timedelta

from shared.rank_tracking_finalize import finalize_pairs
from shared.rank_tracking_reads import baseline_run, history, results, trend
from shared.rank_tracking_runs import save_items
from shared.rank_tracking_store import TrackedKeyword
from testing.rank_tracking_fixtures import NOW, NOW_TEXT, RankTable, pair, tracker

DEVICES = ['desktop', 'mobile']


def _state(keyword_id: str, best: int | None = None, **devices: dict) -> dict:
    state = {'keyword_id': keyword_id, **devices}
    if best is not None:
        state['best_position'] = best
    return state


def _finalized(pairs: list[dict], states: dict | None = None, total: int = 1):
    return finalize_pairs('rt-example', 'run-1', NOW_TEXT, DEVICES, total, pairs, states or {})


def _run(run_id: str, started_at: str, status: str = 'completed', **extra) -> dict:
    return {'pk': 'TRACKER#rt-example', 'sk': f'RUN#{run_id}', 'run_id': run_id, 'status': status,
            'started_at': started_at, 'keywords_total': 1, **extra}


def test_marks_a_miss_of_a_keyword_that_ranked_before_as_unconfirmed():
    finalized = _finalized([pair('k', 'desktop', answered=True)], {'k': _state('k', best=4)})

    assert finalized.pairs[0]['result_status'] == 'not_found_unconfirmed'


def test_confirms_a_miss_when_the_previous_run_also_missed():
    states = {'k': _state('k', best=4, desktop={'status': 'not_found_unconfirmed', 'checked_at': 't0'})}

    finalized = _finalized([pair('k', 'desktop', answered=True)], states)

    assert finalized.pairs[0]['result_status'] == 'not_found'


def test_marks_a_miss_unconfirmed_when_the_other_device_found_the_keyword():
    finalized = _finalized([pair('k', 'desktop', answered=True, position=2), pair('k', 'mobile', answered=True)])

    assert [item['result_status'] for item in finalized.pairs] == ['found', 'not_found_unconfirmed']


def test_stores_no_result_for_a_pair_that_was_never_answered():
    finalized = _finalized([pair('k', 'desktop', status='error')])

    assert (finalized.pairs, finalized.states) == ([], [])


def test_writes_history_keys_on_every_answered_pair():
    finalized = _finalized([pair('k', 'mobile', answered=True, position=6, checked_at='2026-10-05T08:01:00.000000Z')])

    assert (finalized.pairs[0]['gsi1pk'], finalized.pairs[0]['gsi1sk']) == (
        'HIST#rt-example#k', '2026-10-05T08:01:00.000000Z#mobile')


def test_keeps_the_best_position_ever_in_the_keyword_state():
    finalized = _finalized([pair('k', 'desktop', answered=True, position=9)], {'k': _state('k', best=3)})

    assert finalized.states[0]['best_position'] == 3


def test_never_replaces_a_newer_device_result_with_an_older_one():
    newer = {'status': 'found', 'position': 2, 'checked_at': '2026-10-06T00:00:00.000000Z'}
    states = {'k': _state('k', best=2, desktop=newer)}

    finalized = _finalized([pair('k', 'desktop', answered=True, position=7, checked_at='2026-10-05T00:00:00.000000Z')],
                           states)

    assert finalized.states[0]['desktop'] == newer


def test_summarizes_each_device_into_trend_buckets():
    finalized = _finalized([pair('k', 'desktop', answered=True, position=2), pair('k', 'mobile', status='error')])

    assert finalized.summary == {
        'desktop': {'top3': 1, 'top4_10': 0, 'top11_20': 0, 'not_ranking': 0, 'not_checked': 0},
        'mobile': {'top3': 0, 'top4_10': 0, 'top11_20': 0, 'not_ranking': 0, 'not_checked': 1},
    }


def test_picks_the_newest_finished_run_before_the_cutoff_as_the_baseline():
    table = RankTable()
    save_items(table, [_run('20260920T080000Z-a', 's'), _run('20260927T080000Z-b', 's'),
                       _run('20260928T080000Z-c', 's', status='failed'), _run('20261004T080000Z-d', 's')])

    assert (baseline_run(table, 'rt-example', NOW - timedelta(days=7)) or {})['run_id'] == '20260927T080000Z-b'


def test_falls_back_to_the_earliest_finished_run_without_one_before_the_cutoff():
    table = RankTable(page_size=1)
    save_items(table, [_run('20261003T080000Z-a', 's', status='failed'), _run('20261004T080000Z-b', 's', status='partial')])

    assert (baseline_run(table, 'rt-example', NOW - timedelta(days=7)) or {})['run_id'] == '20261004T080000Z-b'


def test_returns_latest_positions_with_the_baseline_position():
    table = RankTable()
    save_items(table, [
        _run('20260920T080000Z-a', 's'),
        pair('k', 'desktop', run_id='20260920T080000Z-a', answered=True, position=9, result_status='found'),
        {'pk': 'TRACKER#rt-example', 'sk': 'STATE#k', 'keyword_id': 'k',
         'desktop': {'status': 'found', 'position': 4, 'url': 'https://example.com/a', 'checked_at': NOW_TEXT}},
    ])

    answer = results(table, tracker(devices='desktop'), [TrackedKeyword('k', 'cheap flights', 'list')], '7d', NOW)

    assert (answer['rows'][0]['desktop']['position'], answer['rows'][0]['desktop']['previous_position'],
            answer['rows'][0]['mobile']) == (4, 9, None)


def test_reports_not_checked_for_a_keyword_without_results():
    answer = results(RankTable(), tracker(), [TrackedKeyword('k', 'cheap flights', 'group')], '30d', NOW)

    assert (answer['rows'][0]['desktop']['status'], answer['baseline_run_id']) == ('not_checked', None)


def test_reads_one_keywords_history_oldest_first():
    table = RankTable()
    finalized = _finalized([pair('k', 'desktop', answered=True, position=5, checked_at='2026-10-04T08:00:00.000000Z'),
                            pair('k', 'mobile', answered=True, position=3, checked_at='2026-10-03T08:00:00.000000Z')])
    save_items(table, finalized.pairs)

    points = history(table, 'rt-example', 'k', 30, NOW)

    assert [(point['device'], point['position']) for point in points] == [('mobile', 3), ('desktop', 5)]


def test_leaves_subset_and_failed_runs_out_of_the_trend():
    buckets = {'top3': 1, 'top4_10': 0, 'top11_20': 0, 'not_ranking': 0, 'not_checked': 0}
    table = RankTable()
    save_items(table, [
        _run('20261001T080000Z-a', '2026-10-01T08:00:00.000000Z', summary={'desktop': buckets}),
        _run('20261002T080000Z-b', '2026-10-02T08:00:00.000000Z', summary={'desktop': buckets}, is_subset=True),
        _run('20261003T080000Z-c', '2026-10-03T08:00:00.000000Z', status='failed', summary={'desktop': buckets}),
    ])

    assert [point['run_id'] for point in trend(table, 'rt-example', 30, NOW)] == ['20261001T080000Z-a']
