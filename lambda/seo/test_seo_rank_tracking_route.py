"""``/api/seo/rank-trackers`` (``seo-rank-tracking.py``): trackers, keywords, runs and reads."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from shared.rank_tracking_runs import save_items
from shared.rank_tracking_store import get_tracker, keyword_id_for, tracker_id_for
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.rank_tracking_fixtures import NOW, NOW_TEXT, KeywordsTable, RankTable, stored_tracker
from testing.seo_fixtures import SEO_DIR, SEO_ENV, seo_event

rank_module = handler_fixture(SEO_DIR, 'seo-rank-tracking.py', 'seo_rank_tracking_under_test', env=SEO_ENV)

BASE = '/api/seo/rank-trackers'
TRACKER = f'{BASE}/rt-example'


class Api:
    """The rank tracking API over in-memory rank and Settings keywords tables and a stub state machine."""

    def __init__(self, module) -> None:
        self.module = module
        self.table = RankTable()
        self.keywords = KeywordsTable()
        self.start = MagicMock()

    def call(self, method: str, path: str, *, body=None, query=None, groups: str = 'Admin') -> tuple[int, dict]:
        with patch.multiple(self.module, rank_table=lambda: self.table, keywords_table=lambda: self.keywords,
                            start_execution=self.start, utc_now=lambda: NOW):
            return parse_response(self.module.handler(seo_event(method, path, body=body, query=query, groups=groups), {}))


@pytest.fixture
def api(rank_module):
    return Api(rank_module)


def _with_keyword(api: Api) -> None:
    stored_tracker(api.table)
    api.call('POST', f'{TRACKER}/keywords', body={'keywords': ['Cheap Flights']})


def test_creates_a_tracker_for_the_normalized_domain(api):
    status, body = api.call('POST', BASE, body={'domain': 'https://www.Example.com/', 'keywords': ['flights']})

    assert (status, body['tracker']['domain'], body['tracker']['tracker_id'], body['keywords_added']) == (
        201, 'example.com', tracker_id_for('example.com', 'global'), 1)


def test_refuses_to_create_a_tracker_for_a_non_admin(api):
    assert api.call('POST', BASE, body={'domain': 'example.com'}, groups='Users')[0] == 403


def test_refuses_a_depth_that_is_not_a_multiple_of_ten(api):
    status, body = api.call('POST', BASE, body={'domain': 'example.com', 'depth': 35})

    assert (status, body['field']) == (400, 'depth')


def test_refuses_an_unknown_market(api):
    status, body = api.call('POST', BASE, body={'domain': 'example.com', 'market_id': 'xx-yy'})

    assert (status, body['code']) == (400, 'VALIDATION_ERROR')


def test_answers_tracker_exists_for_a_domain_already_tracked_in_the_market(api):
    api.call('POST', BASE, body={'domain': 'example.com'})

    assert api.call('POST', BASE, body={'domain': 'example.com'})[1]['code'] == 'TRACKER_EXISTS'


def test_reactivates_an_archived_tracker_with_the_new_settings(api):
    created = api.call('POST', BASE, body={'domain': 'example.com'})[1]['tracker']
    api.call('DELETE', f"{BASE}/{created['tracker_id']}")

    status, body = api.call('POST', BASE, body={'domain': 'example.com', 'devices': 'both'})

    assert (status, body['tracker']['is_active'], body['tracker']['devices']) == (201, True, 'both')


def test_schedules_a_new_weekly_tracker_and_leaves_a_manual_one_unscheduled(api):
    weekly = api.call('POST', BASE, body={'domain': 'example.com'})[1]['tracker']
    manual = api.call('POST', BASE, body={'domain': 'example.org', 'schedule': 'manual'})[1]['tracker']

    assert (weekly['next_check_at'][:10], manual['next_check_at']) == ('2026-10-12', None)


def test_lists_active_trackers_with_the_brand_domains(api):
    stored_tracker(api.table)
    stored_tracker(api.table, tracker_id='rt-gone', is_active=False)

    status, body = api.call('GET', BASE, groups='Users')

    assert (status, [entry['tracker_id'] for entry in body['trackers']], body['owned_domains'],
            body['competitor_domains']) == (200, ['rt-example'], ['example.com'], {'Acme': ['acme.example.org']})


def test_keeps_the_slot_when_an_edit_does_not_change_the_schedule(api):
    stored_tracker(api.table)

    body = api.call('PUT', TRACKER, body={'devices': 'mobile', 'schedule': 'weekly'})[1]

    assert (body['tracker']['devices'], body['tracker']['next_check_at']) == ('mobile', '2026-10-05T06:00:00.000000Z')


def test_rechooses_the_slot_when_the_schedule_changes(api):
    stored_tracker(api.table)

    body = api.call('PUT', TRACKER, body={'schedule': 'manual'})[1]

    assert body['tracker']['next_check_at'] is None


def test_answers_not_found_for_an_unknown_tracker(api):
    assert api.call('GET', f'{BASE}/rt-missing')[1]['code'] == 'NOT_FOUND'


def test_answers_not_found_for_an_unknown_sub_route(api):
    stored_tracker(api.table)

    assert api.call('GET', f'{TRACKER}/nothing')[0] == 404


def test_adds_keywords_normalized_and_counts_them(api):
    stored_tracker(api.table)

    status, body = api.call('POST', f'{TRACKER}/keywords', body={'keywords': ['Cheap Flights', 'cheap flights ']})

    assert (status, body) == (200, {'added': 1, 'keyword_count': 1})


def test_refuses_more_keywords_than_a_tracker_holds(api):
    stored_tracker(api.table)
    api.call('POST', f'{TRACKER}/keywords', body={'keywords': [f'keyword {index}' for index in range(999)]})

    status, body = api.call('POST', f'{TRACKER}/keywords', body={'keywords': ['one', 'two']})

    assert (status, body['field']) == (400, 'keywords')


def test_removes_keywords_by_id(api):
    _with_keyword(api)

    body = api.call('DELETE', f'{TRACKER}/keywords', query={'keyword_ids': f"{keyword_id_for('cheap flights')},kw-x"})[1]

    assert body == {'removed': 1, 'keyword_count': 0}


def test_refuses_a_removal_without_keyword_ids(api):
    stored_tracker(api.table)

    assert api.call('DELETE', f'{TRACKER}/keywords', query={'keyword_ids': ''})[1]['field'] == 'keyword_ids'


def test_details_a_tracker_with_its_keywords(api):
    _with_keyword(api)

    body = api.call('GET', TRACKER, groups='Users')[1]

    assert body['keywords'] == [{'keyword_id': keyword_id_for('cheap flights'), 'keyword': 'cheap flights',
                                 'source': 'list'}]


def test_starts_a_manual_run_with_its_worst_case_cost(api):
    _with_keyword(api)

    status, body = api.call('POST', f'{TRACKER}/runs')

    # Both devices at depth 30: live 2 x 0.005 plus two queued rounds of 2 x 0.0015.
    assert (status, body['run']['status'], body['estimated_cost_usd'], api.start.call_count) == (202, 'pending', 0.016, 1)


def test_answers_run_active_with_the_blocking_run(api):
    _with_keyword(api)
    first = api.call('POST', f'{TRACKER}/runs')[1]['run']['run_id']

    status, body = api.call('POST', f'{TRACKER}/runs')

    assert (status, body['code'], body['run_id']) == (409, 'RUN_ACTIVE', first)


def test_refuses_a_run_without_keywords(api):
    stored_tracker(api.table)

    assert api.call('POST', f'{TRACKER}/runs')[1]['code'] == 'NO_KEYWORDS'


def test_refuses_a_run_for_a_non_admin(api):
    _with_keyword(api)

    assert api.call('POST', f'{TRACKER}/runs', groups='Users')[0] == 403


def test_answers_the_latest_run(api):
    _with_keyword(api)
    started = api.call('POST', f'{TRACKER}/runs')[1]['run']['run_id']

    assert api.call('GET', f'{TRACKER}/runs', groups='Users')[1]['run']['run_id'] == started


def test_estimates_a_scheduled_tracker_per_month(api):
    status, body = api.call('POST', f'{BASE}/estimate', groups='Users', body={
        'keywords': ['a', 'b'], 'devices': 'mobile', 'depth': 10, 'schedule': 'daily'})

    # Queued depth 10: 0.0006 a check, three times with the two re-check rounds, 30 times a month.
    assert (status, body['scheduled'], body['monthly_usd']) == (
        200, {'check_usd': 0.0012, 'worst_case_usd': 0.0036}, 0.108)


def test_estimates_an_existing_tracker_with_its_keywords(api):
    _with_keyword(api)

    body = api.call('POST', f'{BASE}/estimate', body={'tracker_id': 'rt-example'})[1]

    assert (body['keyword_count'], body['pairs']) == (1, 2)


def test_reads_latest_results_for_the_period(api):
    _with_keyword(api)
    save_items(api.table, [{'pk': 'TRACKER#rt-example', 'sk': f"STATE#{keyword_id_for('cheap flights')}",
                            'keyword_id': keyword_id_for('cheap flights'),
                            'desktop': {'status': 'found', 'position': 3, 'checked_at': NOW_TEXT}}])

    body = api.call('GET', f'{TRACKER}/results', query={'period': '30d'}, groups='Users')[1]

    assert (body['period'], body['rows'][0]['desktop']['position'], body['rows'][0]['mobile']['status']) == (
        '30d', 3, 'not_checked')


def test_refuses_an_unknown_results_period(api):
    stored_tracker(api.table)

    assert api.call('GET', f'{TRACKER}/results', query={'period': '2y'})[0] == 400


def test_caps_history_at_one_year(api):
    stored_tracker(api.table)

    assert api.call('GET', f'{TRACKER}/history', query={'keyword_id': 'k', 'days': '400'})[0] == 400


def test_reads_an_empty_trend_for_a_new_tracker(api):
    stored_tracker(api.table)

    assert api.call('GET', f'{TRACKER}/trend', groups='Users')[1] == {'tracker_id': 'rt-example', 'days': 90,
                                                                      'points': []}


def test_archives_a_tracker_and_keeps_its_item(api):
    stored_tracker(api.table)

    status, _body = api.call('DELETE', TRACKER)

    assert (status, (get_tracker(api.table, 'rt-example') or MagicMock()).is_active) == (200, False)


# ---------------------------------------------------------------------------
# Keyword scope: the Settings keywords a tracker checks
# ---------------------------------------------------------------------------

def test_creates_a_tracker_of_every_keyword_of_its_market_by_default(api):
    api.keywords.add('hotel santiago', market_id='cl-es')
    api.keywords.add('boutique hotel')

    tracker = api.call('POST', BASE, body={'domain': 'example.com', 'market_id': 'cl-es'})[1]['tracker']

    assert (tracker['keyword_scope'], tracker['group_id'], tracker['keyword_count']) == ('all', None, 1)


def test_creates_a_group_tracker_from_a_group_id_without_a_scope(api):
    api.keywords.add('hotel coruna', group_ids=['g-1'])

    tracker = api.call('POST', BASE, body={'domain': 'example.com', 'group_id': 'g-1'})[1]['tracker']

    assert (tracker['keyword_scope'], tracker['group_id'], tracker['keyword_count']) == ('group', 'g-1', 1)


def test_drops_the_group_of_a_tracker_created_for_every_keyword(api):
    body = {'domain': 'example.com', 'keyword_scope': 'all', 'group_id': 'g-1'}

    assert api.call('POST', BASE, body=body)[1]['tracker']['group_id'] is None


def test_refuses_a_group_scope_without_a_group(api):
    status, body = api.call('POST', BASE, body={'domain': 'example.com', 'keyword_scope': 'group'})

    assert (status, body['field']) == (400, 'group_id')


def test_refuses_an_unknown_keyword_scope(api):
    status, body = api.call('POST', BASE, body={'domain': 'example.com', 'keyword_scope': 'everything'})

    assert (status, body['code']) == (400, 'VALIDATION_ERROR')


def test_lists_a_tracker_with_the_settings_keywords_added_after_it(api):
    api.call('POST', BASE, body={'domain': 'example.com'})
    api.keywords.add('boutique hotel')

    tracker = api.call('GET', BASE, groups='Users')[1]['trackers'][0]

    assert (tracker['keyword_count'], tracker['extra_keyword_count']) == (1, 0)


def test_details_a_market_tracker_with_its_settings_keywords(api):
    api.keywords.add('boutique hotel')
    created = api.call('POST', BASE, body={'domain': 'example.com'})[1]['tracker']

    body = api.call('GET', f"{BASE}/{created['tracker_id']}", groups='Users')[1]

    assert body['keywords'] == [{'keyword_id': keyword_id_for('boutique hotel'), 'keyword': 'boutique hotel',
                                 'source': 'market'}]


GROUP_TRACKER = {'keyword_scope': 'group', 'group_id': 'g-1'}


@pytest.mark.parametrize(('stored', 'body', 'scope'), [
    pytest.param(GROUP_TRACKER, {'keyword_scope': 'all'}, ('all', None), id='group tracker to every market keyword'),
    pytest.param({}, {'keyword_scope': 'group', 'group_id': 'g-2'}, ('group', 'g-2'), id='market tracker to a group'),
    pytest.param(GROUP_TRACKER, {'group_id': ''}, ('all', None), id='group cleared to every market keyword'),
])
def test_moves_the_tracker_to_the_keyword_scope_of_the_edit(api, stored, body, scope):
    stored_tracker(api.table, **stored)

    tracker = api.call('PUT', TRACKER, body=body)[1]['tracker']

    assert (tracker['keyword_scope'], tracker['group_id']) == scope


def test_refuses_an_edit_to_the_group_scope_without_a_group(api):
    stored_tracker(api.table)

    status, body = api.call('PUT', TRACKER, body={'keyword_scope': 'group'})

    assert (status, body['field']) == (400, 'group_id')


def test_keeps_the_scope_of_an_older_tracker_of_extra_keywords_when_other_settings_change(api):
    stored_tracker(api.table, keyword_scope='list')

    assert api.call('PUT', TRACKER, body={'devices': 'mobile'})[1]['tracker']['keyword_scope'] == 'list'


def test_estimates_a_new_tracker_on_the_keywords_of_its_market(api):
    api.keywords.add('hotel santiago', market_id='cl-es')
    api.keywords.add('hotel valparaiso', market_id='cl-es')
    api.keywords.add('boutique hotel')

    body = api.call('POST', f'{BASE}/estimate', groups='Users', body={'market_id': 'cl-es', 'devices': 'mobile'})[1]

    assert (body['keyword_count'], body['pairs']) == (2, 2)


def test_estimates_a_new_group_tracker_on_the_groups_keywords(api):
    api.keywords.add('hotel coruna', group_ids=['g-1'])
    api.keywords.add('boutique hotel')

    body = api.call('POST', f'{BASE}/estimate', body={'keyword_scope': 'group', 'group_id': 'g-1'})[1]

    assert body['keyword_count'] == 1


def test_states_how_many_keywords_a_scope_larger_than_the_cap_holds(api):
    for index in range(1003):
        api.keywords.add(f'keyword {index:04d}')

    body = api.call('POST', f'{BASE}/estimate', body={})[1]

    assert (body['keyword_count'], body['scope_keyword_count'], body['max_keywords']) == (1000, 1003, 1000)


def test_runs_a_market_tracker_on_its_settings_keywords(api):
    api.keywords.add('boutique hotel')
    stored_tracker(api.table)

    assert api.call('POST', f'{TRACKER}/runs')[0] == 202
