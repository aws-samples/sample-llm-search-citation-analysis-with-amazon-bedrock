"""Tests for the re-check rules, the final result status and the run outcome."""

from __future__ import annotations

import pytest

from shared.rank_tracking_retry import (
    PairAnswer,
    bucket_counts,
    final_status,
    is_better,
    needs_retry,
    retry_keywords,
    run_outcome,
)


def _answer(keyword_id: str, device: str, position: int | None, answered: bool = True) -> PairAnswer:
    return PairAnswer(keyword_id=keyword_id, device=device, answered=answered, position=position)


def test_retries_a_pair_that_was_never_answered():
    assert needs_retry(_answer('k', 'desktop', None, answered=False), known=None, first_check=False) is True


def test_retries_a_first_ever_check_that_missed():
    assert needs_retry(_answer('k', 'desktop', None), known=None, first_check=True) is True


def test_keeps_a_miss_of_a_keyword_that_was_checked_before_and_never_ranked():
    assert needs_retry(_answer('k', 'desktop', None), known=None, first_check=False) is False


def test_retries_a_miss_of_a_keyword_that_ranked_before():
    assert needs_retry(_answer('k', 'desktop', None), known=4, first_check=False) is True


@pytest.mark.parametrize(('position', 'expected'), [(13, False), (14, True)])
def test_retries_a_drop_of_ten_places_or_more(position, expected):
    assert needs_retry(_answer('k', 'desktop', position), known=4, first_check=False) is expected


def test_retries_both_devices_when_the_other_device_found_the_keyword():
    pairs = [_answer('k', 'desktop', 3), _answer('k', 'mobile', None)]

    assert retry_keywords(pairs, best_before={}, seen_before={'k'}) == ['k']


def test_retries_nothing_when_every_answer_is_consistent():
    pairs = [_answer('k', 'desktop', 3), _answer('k', 'mobile', 5)]

    assert retry_keywords(pairs, best_before={'k': 3}, seen_before={'k'}) == []


def test_lists_retried_keywords_in_id_order():
    pairs = [_answer('b', 'desktop', None, answered=False), _answer('a', 'desktop', None, answered=False)]

    assert retry_keywords(pairs, best_before={}, seen_before=set()) == ['a', 'b']


def test_takes_any_answer_for_a_pair_without_one():
    assert is_better(answered=False, current=None, new=None) is True


def test_takes_a_higher_position_from_a_recheck():
    assert is_better(answered=True, current=12, new=4) is True


def test_keeps_the_stored_position_when_the_recheck_is_lower():
    assert is_better(answered=True, current=4, new=12) is False


def test_keeps_a_found_position_when_the_recheck_misses():
    assert is_better(answered=True, current=4, new=None) is False


def test_reports_not_checked_for_an_unanswered_pair():
    assert final_status(False, None, 3, None) is None


def test_reports_found_for_a_position():
    assert final_status(True, 7, None, None) == 'found'


def test_reports_not_found_for_a_keyword_that_never_ranked():
    assert final_status(True, None, None, None) == 'not_found'


def test_reports_an_unconfirmed_miss_for_a_keyword_that_ranked_before():
    assert final_status(True, None, 5, 'found') == 'not_found_unconfirmed'


@pytest.mark.parametrize('previous', ['not_found_unconfirmed', 'not_found'])
def test_confirms_not_found_after_a_second_miss_in_a_row(previous):
    assert final_status(True, None, 5, previous) == 'not_found'


def test_counts_positions_into_the_trend_buckets():
    counts = bucket_counts([1, 3, 4, 10, 11, 20, 21, None], keywords_total=10)

    assert counts == {'top3': 2, 'top4_10': 2, 'top11_20': 2, 'not_ranking': 2, 'not_checked': 2}


def test_fails_a_run_that_checked_nothing_with_the_first_error():
    outcome = run_outcome([_answer('k', 'desktop', None, answered=False)], ['desktop'], 1, 'AUTH_FAILED')

    assert (outcome.status, outcome.error_message) == ('failed', 'AUTH_FAILED')


def test_reports_a_partial_run_per_device_when_a_device_lacks_answers():
    pairs = [_answer('k', 'desktop', 2), _answer('k', 'mobile', None, answered=False)]

    outcome = run_outcome(pairs, ['desktop', 'mobile'], 1, 'UPSTREAM_UNAVAILABLE')

    assert (outcome.status, outcome.error_message) == (
        'partial', 'Checked 1 of 1 desktop and 0 of 1 mobile keyword(s): UPSTREAM_UNAVAILABLE')


def test_completes_a_run_with_every_pair_answered():
    pairs = [_answer('k', 'desktop', 2), _answer('k', 'mobile', None)]

    outcome = run_outcome(pairs, ['desktop', 'mobile'], 1, None)

    assert (outcome.status, outcome.checked, outcome.keywords_checked) == ('completed', {'desktop': 1, 'mobile': 1}, 1)
