"""
Tests for shared.serpapi: async submit + Search Archive polling.

``requests.get`` is stubbed with a queue of answers; ``time.sleep``,
``time.monotonic`` and the retry jitter are patched so every wait is
asserted exactly and no test sleeps.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import requests

from shared import serpapi
from shared.provider_health import TIMEOUT, classify_provider_error
from shared.serpapi import SerpApiError, SerpApiQuotaExhaustedError, serpapi_search

_KEY = 'serp-secret-key-123'
_PARAMS = {'engine': 'google', 'q': 'hotel coruña'}
_ARCHIVE_URL = 'https://serpapi.com/searches/search-1.json'


def _answer(status_code: int = 200, payload: Any = None, text: str = '', headers: dict[str, str] | None = None) -> MagicMock:
    """One HTTP answer: ``payload`` as JSON, ``text`` as the body."""
    response = MagicMock(status_code=status_code, text=text, headers=headers or {})
    response.json.return_value = payload
    return response


def _search(status: str, **extra: Any) -> MagicMock:
    """A 200 answer whose search is in ``status`` (Queued, Processing, Success, Cached, Error)."""
    return _answer(payload={'search_metadata': {'id': 'search-1', 'status': status}, **extra})


class _Http:
    """The patched ``requests.get`` / ``time.sleep`` pair of one test."""

    def __init__(self, get: MagicMock, sleep: MagicMock) -> None:
        self.get = get
        self.sleep = sleep

    @property
    def urls(self) -> list[str]:
        return [call.args[0] for call in self.get.call_args_list]

    @property
    def sent_params(self) -> list[dict[str, Any]]:
        return [call.kwargs['params'] for call in self.get.call_args_list]

    @property
    def waits(self) -> list[float]:
        return [call.args[0] for call in self.sleep.call_args_list]


@contextmanager
def _serpapi_answers(*answers: Any, clock: Any = 0.0) -> Iterator[_Http]:
    """``requests.get`` answers ``answers`` in order (an exception is raised); jitter is x1.

    ``clock`` is ``time.monotonic``'s return value, or a list of successive readings.
    """
    monotonic = {'side_effect': clock} if isinstance(clock, list) else {'return_value': clock}
    with (
        patch.object(serpapi.requests, 'get', side_effect=list(answers)) as get,
        patch.object(serpapi.time, 'sleep') as sleep,
        patch.object(serpapi.time, 'monotonic', **monotonic),
        patch.object(serpapi.random, 'uniform', return_value=1.0),
    ):
        yield _Http(get, sleep)


class TestFinishedSearches:
    def test_returns_the_archived_search_when_the_submit_is_still_processing(self):
        with _serpapi_answers(_search('Processing'), _search('Success', organic_results=[{'link': 'https://a.es'}])) as http:
            result = serpapi_search(_KEY, _PARAMS)

        assert (result['organic_results'], http.urls) == (
            [{'link': 'https://a.es'}], [serpapi.SERPAPI_SEARCH_URL, _ARCHIVE_URL],
        )

    @pytest.mark.parametrize('status', ['Success', 'Cached'])
    def test_returns_the_submit_answer_without_polling_when_it_is_already_done(self, status):
        with _serpapi_answers(_search(status, organic_results=[])) as http:
            result = serpapi_search(_KEY, _PARAMS)

        assert (result['search_metadata']['status'], http.urls) == (status, [serpapi.SERPAPI_SEARCH_URL])

    def test_returns_a_success_that_carries_googles_no_results_error(self):
        with _serpapi_answers(_search('Success', error="Google hasn't returned any results for this query.")):
            result = serpapi_search(_KEY, _PARAMS)

        assert result['error'] == "Google hasn't returned any results for this query."

    def test_submits_async_with_the_key_and_reads_the_archive_with_the_key(self):
        with _serpapi_answers(_search('Queued'), _search('Success')) as http:
            serpapi_search(_KEY, _PARAMS)

        assert http.sent_params == [{**_PARAMS, 'api_key': _KEY, 'async': 'true'}, {'api_key': _KEY}]


class TestFailedSearches:
    def test_raises_when_serpapi_marks_the_archived_search_as_error(self):
        with (
            _serpapi_answers(_search('Processing'), _search('Error', error='Invalid location')),
            pytest.raises(SerpApiError, match=r"status 'Error'.*Invalid location"),
        ):
            serpapi_search(_KEY, _PARAMS)

    def test_raises_quota_exhausted_without_retrying_when_the_account_is_out_of_searches(self):
        spent = _answer(429, text='{"error": "Your account has run out of searches."}')

        with _serpapi_answers(spent) as http, pytest.raises(SerpApiQuotaExhaustedError, match='run out of searches'):
            serpapi_search(_KEY, _PARAMS)

        assert (http.get.call_count, http.waits) == (1, [])

    def test_raises_without_retrying_on_a_bad_request(self):
        with _serpapi_answers(_answer(400, text='Missing query')) as http, pytest.raises(SerpApiError, match='HTTP 400'):
            serpapi_search(_KEY, _PARAMS)

        assert http.get.call_count == 1

    def test_raises_when_accepted_search_has_no_id(self):
        pending_without_id = _answer(payload={'search_metadata': {'status': 'Queued'}})

        with _serpapi_answers(pending_without_id), pytest.raises(SerpApiError, match='no search id'):
            serpapi_search(_KEY, _PARAMS)


class TestRetries:
    @pytest.mark.parametrize('failure', [
        _answer(429, text='{"error": "Your account has exceeded the hourly searches limit."}'),
        _answer(503, text='unavailable'),
        requests.exceptions.ReadTimeout('Read timed out. (read timeout=20)'),
        requests.exceptions.ConnectionError('Connection reset by peer'),
    ], ids=['hourly-429', '503', 'timeout', 'connection-error'])
    def test_retries_a_transient_failure_then_returns_the_search(self, failure):
        with _serpapi_answers(failure, _search('Success')) as http:
            result = serpapi_search(_KEY, _PARAMS)

        assert (result['search_metadata']['status'], http.get.call_count, http.waits) == ('Success', 2, [1.0])

    def test_waits_what_retry_after_asks_before_retrying(self):
        with _serpapi_answers(_answer(429, text='slow down', headers={'Retry-After': '7'}), _search('Success')) as http:
            serpapi_search(_KEY, _PARAMS)

        assert http.waits == [7.0]

    def test_raises_after_the_last_attempt_with_exponential_waits_between(self):
        failures = [_answer(503, text='unavailable')] * serpapi.MAX_REQUEST_ATTEMPTS

        with _serpapi_answers(*failures) as http, pytest.raises(SerpApiError, match='failed after 5 attempts: HTTP 503'):
            serpapi_search(_KEY, _PARAMS)

        assert http.waits == [1.0, 2.0, 4.0, 8.0]

    def test_logs_the_final_failure_under_the_tag_the_error_check_script_counts(self, caplog):
        failures = [_answer(503, text='unavailable')] * serpapi.MAX_REQUEST_ATTEMPTS

        with _serpapi_answers(*failures), caplog.at_level('ERROR', logger='shared.serpapi'), pytest.raises(SerpApiError):
            serpapi_search(_KEY, _PARAMS)

        assert [record.getMessage()[:40] for record in caplog.records] == ['[SERPAPI_FAILED] SerpAPI request failed ']


class TestPolling:
    def test_poll_interval_grows_to_the_cap(self):
        pending = [_search('Processing')] * 7

        with _serpapi_answers(*pending, _search('Success')) as http:
            serpapi_search(_KEY, _PARAMS)

        assert http.waits == [1.0, 1.5, 2.25, 3.375, 5.0, 5.0, 5.0]

    def test_raises_timed_out_once_the_deadline_passes_while_still_pending(self):
        with (
            _serpapi_answers(_search('Queued'), _search('Processing'), clock=[0.0, 0.0, 61.0]),
            pytest.raises(SerpApiError, match='timed out: still pending after 60s'),
        ):
            serpapi_search(_KEY, _PARAMS, deadline_seconds=60)

    def test_deadline_message_classifies_as_a_transient_timeout(self):
        with (
            _serpapi_answers(_search('Queued'), _search('Processing'), clock=[0.0, 0.0, serpapi.DEFAULT_DEADLINE_SECONDS + 1.0]),
            pytest.raises(SerpApiError) as raised,
        ):
            serpapi_search(_KEY, _PARAMS)

        assert classify_provider_error(str(raised.value)) == TIMEOUT


class TestTheKeyNeverLeaks:
    """requests puts the whole URL, query string and api_key included, into a ConnectionError."""

    def test_connection_error_messages_are_raised_without_the_key(self):
        leaky = requests.exceptions.ConnectionError(
            f"HTTPSConnectionPool(host='serpapi.com'): Max retries exceeded with url: /search?q=x&api_key={_KEY}",
        )

        with _serpapi_answers(*[leaky] * serpapi.MAX_REQUEST_ATTEMPTS), pytest.raises(SerpApiError) as raised:
            serpapi_search(_KEY, _PARAMS)

        assert (_KEY in str(raised.value), 'api_key=***' in str(raised.value)) == (False, True)

    def test_error_bodies_are_raised_without_the_key(self):
        echo = _answer(400, text=f'Invalid request for api_key={_KEY}')

        with _serpapi_answers(echo), pytest.raises(SerpApiError) as raised:
            serpapi_search(_KEY, _PARAMS)

        assert _KEY not in str(raised.value)

    def test_retry_log_lines_omit_the_key(self, caplog):
        leaky = requests.exceptions.ConnectionError(f'/searches/search-1.json?api_key={_KEY}')

        with _serpapi_answers(leaky, _search('Success')), caplog.at_level('WARNING', logger='shared.serpapi'):
            serpapi_search(_KEY, _PARAMS)

        assert [_KEY in record.getMessage() for record in caplog.records] == [False]
