"""IndexNow submissions (``shared.indexnow``): owned hosts only, key file check, engine order and fallbacks."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from shared import indexnow
from shared.audit_fetch import FetchResult
from shared.dataforseo_client import call_deadline
from testing.indexnow_fixtures import SAMPLE_HEX_32 as KEY
from testing.site_audit_fixtures import FakeSite, redirect, serving, text_response

OWNED = ['example.com']
KEY_URL = f'https://www.example.com/{KEY}.txt'
PAGE_A = 'https://www.example.com/a'


def _engines_tried(*answers: int | None) -> list[str]:
    """The engines asked, in order, when they answer ``answers`` one after the other."""
    indexnow.send = MagicMock(side_effect=list(answers))
    return [answer['engine'] for answer in indexnow.submit_to_engines('www.example.com', KEY, [PAGE_A])]


def _submit_one() -> dict:
    return indexnow.submit_host('www.example.com', KEY, [PAGE_A])


@pytest.fixture
def engines(monkeypatch):
    """Every engine answers 200 unless a test scripts ``side_effect``."""
    stub = MagicMock(return_value=200)
    monkeypatch.setattr(indexnow, 'send', stub)
    return stub


@pytest.fixture
def key_file_found():
    with serving(FakeSite({KEY_URL: text_response(f'{KEY}\n')})) as site:
        yield site


class TestGrouping:
    def test_groups_owned_urls_per_host(self):
        groups = indexnow.group_urls(['https://www.example.com/a', 'https://blog.example.com/b'], OWNED)

        assert groups.by_host == {'www.example.com': ['https://www.example.com/a'],
                                  'blog.example.com': ['https://blog.example.com/b']}

    def test_skips_urls_off_the_owned_domains(self):
        groups = indexnow.group_urls(['https://acme.example.org/x', 'https://badexample.com/y'], OWNED)

        assert groups.skipped == ['https://acme.example.org/x', 'https://badexample.com/y']

    def test_skips_entries_that_are_not_http_urls(self):
        groups = indexnow.group_urls(['ftp://example.com/file', 'not a url', 7], OWNED)

        assert (groups.by_host, len(groups.skipped)) == ({}, 3)

    def test_drops_fragments_and_repeats(self):
        groups = indexnow.group_urls(['https://example.com/a#top', 'https://example.com/a'], OWNED)

        assert groups.by_host == {'example.com': ['https://example.com/a']}

    def test_maps_each_host_to_the_longest_owned_domain(self):
        groups = indexnow.group_urls(['https://shop.uk.example.com/'], ['example.com', 'uk.example.com'])

        assert groups.domain_of == {'shop.uk.example.com': 'uk.example.com'}


class TestKeyFile:
    @pytest.mark.usefixtures('key_file_found')
    def test_a_file_holding_only_the_key_is_found(self):
        assert indexnow.check_key_file('www.example.com', KEY) == 'found'

    def test_a_404_is_missing(self):
        with serving(FakeSite()):
            assert indexnow.check_key_file('www.example.com', KEY) == 'missing'

    def test_a_page_served_in_place_of_the_file_is_wrong_content(self):
        with serving(FakeSite({KEY_URL: text_response('<html>home</html>')})):
            assert indexnow.check_key_file('www.example.com', KEY) == 'wrong_content'

    def test_a_redirect_to_the_same_file_on_another_host_is_moved(self):
        with serving(FakeSite({f'https://example.com/{KEY}.txt': redirect(KEY_URL)})):
            assert indexnow.check_key_file('example.com', KEY) == 'moved'

    def test_a_redirect_elsewhere_is_redirects(self):
        with serving(FakeSite({KEY_URL: redirect('https://www.example.com/')})):
            assert indexnow.check_key_file('www.example.com', KEY) == 'redirects'

    def test_a_server_error_is_unknown(self):
        with serving(FakeSite({KEY_URL: text_response('busy', status=503)})):
            assert indexnow.check_key_file('www.example.com', KEY) == 'unknown'

    def test_a_timeout_is_unknown(self, monkeypatch):
        monkeypatch.setattr(indexnow, 'fetch_once', MagicMock(return_value=FetchResult(KEY_URL, 0, error='ReadTimeout')))

        assert indexnow.check_key_file('www.example.com', KEY) == 'unknown'

    def test_a_refused_address_is_unreachable(self, monkeypatch):
        monkeypatch.setattr(indexnow, 'fetch_once', MagicMock(return_value=FetchResult(KEY_URL, 0, error='blocked_address')))

        assert indexnow.check_key_file('www.example.com', KEY) == 'unreachable'


class TestEngines:
    def test_posts_host_key_and_url_list_to_bing_first(self, engines):
        indexnow.submit_to_engines('www.example.com', KEY, [PAGE_A])

        endpoint, body, _timeout = engines.call_args.args
        assert (endpoint, json.loads(body)) == ('https://www.bing.com/indexnow', {
            'host': 'www.example.com', 'key': KEY, 'urlList': [PAGE_A]})

    @pytest.mark.parametrize('first_answer', [429, 500, 503, None])
    @pytest.mark.usefixtures('engines')
    def test_moves_to_yandex_after_a_rate_limit_server_error_or_no_answer(self, first_answer):
        assert _engines_tried(first_answer, 200) == ['bing', 'yandex']

    @pytest.mark.usefixtures('engines')
    def test_stops_at_a_refusal(self):
        assert _engines_tried(403, 200) == ['bing']

    @pytest.mark.usefixtures('engines')
    def test_tries_yep_last(self):
        assert _engines_tried(429, 503, 202) == ['bing', 'yandex', 'yep']

    def test_sends_nothing_once_the_deadline_has_passed(self, engines):
        with call_deadline(0.5):
            answers = indexnow.submit_to_engines('www.example.com', KEY, [PAGE_A])

        assert (answers, engines.call_count) == ([], 0)


@pytest.mark.parametrize(('status', 'expected'), [
    (200, ('submitted', 'Submitted 2 URLs.')),
    (202, ('submitted', 'Submitted 2 URLs. Search engines will verify the key file on https://example.com first.')),
    (403, ('failed', "The key wasn't accepted. Check that the key file on https://example.com contains only the key.")),
    (500, ('failed', 'IndexNow returned HTTP 500.')),
    (None, ('failed', "IndexNow didn't respond. Try again later.")),
])
def test_describe_reads_each_engine_answer(status, expected):
    assert indexnow.describe(status, 2, 'example.com') == expected


class TestSubmitHost:
    @pytest.mark.usefixtures('key_file_found')
    def test_submits_when_the_key_file_is_found(self, engines):
        result = _submit_one()

        assert (result['status'], result['message'], result['key_file']) == ('submitted', 'Submitted 1 URL.', 'found')

    def test_stops_with_the_fix_when_the_key_file_is_missing(self, engines):
        with serving(FakeSite()):
            result = _submit_one()

        assert (result['status'], engines.call_count) == ('failed', 0)

    def test_goes_ahead_when_a_bot_wall_hides_the_key_file(self, engines):
        with serving(FakeSite({KEY_URL: text_response('challenge', status=403)})):
            result = _submit_one()

        assert (result['status'], result['key_file']) == ('submitted', 'unknown')

    def test_reports_a_host_without_a_key_for_its_domain(self, engines):
        groups = indexnow.group_urls(['https://www.example.com/a'], OWNED)

        assert indexnow.submit(groups, {})[0]['message'] == 'Create the IndexNow key for example.com first.'
