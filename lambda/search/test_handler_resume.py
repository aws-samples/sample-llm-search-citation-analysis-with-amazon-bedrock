"""The search Lambda's time budget (2.42.0): each prompt's answers are stored as they arrive, and a retry
resumes after them without asking a provider again for a stored (keyword, run, provider, prompt)."""

from __future__ import annotations

from collections.abc import Iterator
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

from shared.request_deadline import active_deadline
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.search_handler_fixtures import search_handler_fixture

search_handler = search_handler_fixture('search_handler_resume')

_TIMESTAMP = '2026-11-05T06:00:00Z'
_PROMPTS = [
    {'id': 'p1', 'name': 'Family', 'template': 'As a family, {keyword}'},
    {'id': 'p2', 'name': 'Business', 'template': 'On business, {keyword}'},
]
_EVENT = {'keyword': 'hotel coruña', 'timestamp': _TIMESTAMP, 'query_prompts': _PROMPTS, 'providers': ['openai']}
_STORED_P1 = {
    'provider': 'openai', 'provider_type': 'llm', 'status': 'success', 'citation_count': 1,
    'citations': ['https://hotel.es/riazor'], 'query_prompt_id': 'p1',
}


def _answer(template: str | None) -> list[dict]:
    """OpenAI's one answer to ``template``, citing a page named after it."""
    return [{
        'provider': 'openai', 'provider_type': 'llm', 'status': 'success', 'response': f'answer to {template}',
        'citations': [f'https://hotel.es/{len(template or "")}'], 'raw_response': None, 'metadata': {},
    }]


def _context(remaining_seconds: float) -> MagicMock:
    context = MagicMock()
    context.get_remaining_time_in_millis.return_value = int(remaining_seconds * 1000)
    return context


class Run:
    """The handler over ``_EVENT`` with ``stored`` already in SearchResults: what it asked, stored and answered."""

    def __init__(self, module: ModuleType, stored: dict | None = None, context: object = None, event: dict | None = None) -> None:
        self.asked: list[str | None] = []
        self.stores_before_ask: list[int] = []
        self.store = MagicMock(return_value=True)
        self.error: Exception | None = None
        self.response: dict = {}

        def ask(_keyword: str, *, providers: list[str], query_template: str | None, market: object) -> list[dict]:
            self.asked.append(query_template)
            self.stores_before_ask.append(self.store.call_count)
            return _answer(query_template)

        with (
            patch.object(module, 'stored_slim_results', return_value=dict(stored or {})) as self.stored_read,
            patch.object(module, 'execute_all_providers', side_effect=ask),
            patch.object(module, 'store_search_results', self.store),
        ):
            try:
                self.response = module.handler(dict(event or _EVENT), context)
            except module.SearchTimeBudgetSpentError as error:
                self.error = error


@pytest.fixture
def unpaced(search_handler) -> Iterator[None]:
    with patch.object(search_handler, 'provider_min_interval_seconds', return_value=0.0):
        yield


@pytest.fixture
def resumed(search_handler, unpaced) -> Run:
    """A retry of the run after an earlier attempt stored p1's OpenAI answer."""
    return Run(search_handler, stored={('openai', 'p1'): _STORED_P1})


@pytest.mark.usefixtures('unpaced')
class TestResume:
    def test_asks_only_the_prompts_no_earlier_attempt_stored(self, resumed) -> None:
        assert resumed.asked == ['On business, {keyword}']

    def test_returns_the_stored_answers_with_the_new_ones_in_prompt_order(self, resumed) -> None:
        assert [result['query_prompt_id'] for result in resumed.response['results']] == ['p1', 'p2']

    def test_returns_the_stored_slim_result_unchanged(self, resumed) -> None:
        assert resumed.response['results'][0] == _STORED_P1

    def test_asks_no_provider_when_every_prompt_is_stored(self, search_handler) -> None:
        stored = {('openai', 'p1'): _STORED_P1, ('openai', 'p2'): {**_STORED_P1, 'query_prompt_id': 'p2'}}

        run = Run(search_handler, stored=stored)

        assert (run.asked, run.store.call_count) == ([], 0)

    def test_reads_the_stored_answers_of_the_events_run(self, search_handler) -> None:
        run = Run(search_handler)

        assert run.stored_read.call_args.args == ('hotel coruña', _TIMESTAMP)

    def test_reads_nothing_stored_for_an_event_without_a_run_timestamp(self, search_handler) -> None:
        event = {key: value for key, value in _EVENT.items() if key != 'timestamp'}

        assert Run(search_handler, event=event).stored_read.call_count == 0

    def test_stores_each_prompts_answers_before_the_next_prompt_is_asked(self, search_handler) -> None:
        assert Run(search_handler).stores_before_ask == [0, 1]


@pytest.mark.usefixtures('unpaced')
class TestTimeBudget:
    def test_runs_every_prompt_when_the_budget_holds_their_worst_case(self, search_handler) -> None:
        run = Run(search_handler, context=_context(900))

        assert (run.asked, run.error) == (['As a family, {keyword}', 'On business, {keyword}'], None)

    def test_starts_no_prompt_whose_worst_case_outlasts_the_budget(self, search_handler) -> None:
        needed = search_handler.prompt_time_needed(['openai'])

        run = Run(search_handler, context=_context(needed + search_handler.SEARCH_SAFETY_MARGIN_SECONDS - 1))

        assert run.asked == ['As a family, {keyword}']

    def test_hands_the_prompts_left_to_a_retry(self, search_handler) -> None:
        run = Run(search_handler, context=_context(60))

        assert str(run.error) == '1 query prompt(s) left for the retry'

    def test_stores_the_answers_it_got_before_handing_the_rest_to_a_retry(self, search_handler) -> None:
        run = Run(search_handler, context=_context(60))

        assert run.store.call_args.args[2][0]['query_prompt_id'] == 'p1'

    def test_a_retry_with_a_short_budget_still_asks_one_unstored_prompt(self, search_handler) -> None:
        run = Run(search_handler, stored={('openai', 'p1'): _STORED_P1}, context=_context(1))

        assert (run.asked, run.error) == (['On business, {keyword}'], None)


@pytest.mark.usefixtures('unpaced')
class TestActiveDeadline:
    """The invocation's deadline is the active one while providers are asked, so their retry waits honour it."""

    def test_providers_are_asked_under_the_invocations_budget(self, search_handler) -> None:
        seen: list[float] = []

        def ask(_keyword: str, **_options: object) -> list[dict]:
            deadline = active_deadline()
            seen.append(-1.0 if deadline is None else round(deadline.remaining()))
            return _answer('q')

        with (
            patch.object(search_handler, 'stored_slim_results', return_value={}),
            patch.object(search_handler, 'execute_all_providers', side_effect=ask),
            patch.object(search_handler, 'store_search_results', return_value=True),
        ):
            search_handler.handler({**_EVENT, 'query_prompts': _PROMPTS[:1]}, _context(900))

        assert seen == [900 - search_handler.SEARCH_SAFETY_MARGIN_SECONDS]

    def test_clears_the_deadline_when_the_invocation_hands_prompts_to_a_retry(self, search_handler) -> None:
        Run(search_handler, context=_context(60))

        assert active_deadline() is None

    def test_clears_the_deadline_when_the_invocation_finishes(self, search_handler) -> None:
        Run(search_handler, context=_context(900))

        assert active_deadline() is None


class TestWorstCase:
    def test_counts_every_attempt_of_a_slow_engine(self, search_handler) -> None:
        expected = (
            search_handler.SLOW_ENGINE_MAX_ATTEMPTS * search_handler.OPENAI_TIMEOUT_SECONDS
            + search_handler.RETRY_BACKOFF_SECONDS
        )

        assert search_handler.PROVIDER_CALL_WORST_CASE_SECONDS['openai'] == expected

    def test_names_a_worst_case_for_every_provider_the_lambda_runs(self, search_handler) -> None:
        runners = {provider_id for provider_id, *_rest in search_handler.PROVIDER_RUNNERS}

        assert set(search_handler.PROVIDER_CALL_WORST_CASE_SECONDS) == runners

    def test_adds_the_send_slot_wait_for_a_paced_provider(self, search_handler) -> None:
        with patch.object(search_handler, 'provider_min_interval_seconds', return_value=1.1):
            paced = search_handler.prompt_time_needed(['perplexity'])
        with patch.object(search_handler, 'provider_min_interval_seconds', return_value=0.0):
            unpaced = search_handler.prompt_time_needed(['perplexity'])

        assert paced - unpaced == search_handler.MAX_WAIT_SECONDS

    def test_leaves_the_budget_unbounded_without_a_lambda_context(self, search_handler) -> None:
        assert search_handler.invocation_deadline(None).expired() is False


class TestStoredSlimResults:
    @pytest.fixture
    def table(self, search_handler) -> Iterator[MagicMock]:
        table = fake_table(query={'Items': [
            {**_STORED_P1, 'error_category': 'no_credit', 'error': 'quota'},
            {'provider_type': 'llm', 'query_prompt_id': 'p2'},
        ]})
        with patch.object(search_handler, 'dynamodb', fake_dynamodb_resource(table)):
            yield table

    def test_keys_each_stored_answer_by_provider_and_prompt(self, search_handler, table) -> None:
        assert list(search_handler.stored_slim_results('hotel coruña', _TIMESTAMP)) == [('openai', 'p1')]

    def test_rebuilds_the_error_category_of_a_stored_failure(self, search_handler, table) -> None:
        slim = search_handler.stored_slim_results('hotel coruña', _TIMESTAMP)[('openai', 'p1')]

        assert (slim['error_category'], slim['error'], slim['citation_count']) == ('no_credit', 'quota', 1)

    def test_reads_only_the_rows_of_the_run(self, search_handler, table) -> None:
        search_handler.stored_slim_results('hotel coruña', _TIMESTAMP)

        condition = table.query.call_args.kwargs['KeyConditionExpression'].get_expression()['values'][1]
        assert condition.get_expression()['values'][1] == f'{_TIMESTAMP}#'

    def test_asks_no_provider_when_the_stored_answers_cannot_be_read(self, search_handler) -> None:
        execute = MagicMock()
        with (
            patch.object(search_handler, 'stored_slim_results', side_effect=RuntimeError('throttled')),
            patch.object(search_handler, 'execute_all_providers', execute),
            pytest.raises(RuntimeError, match=r'^throttled$'),
        ):
            search_handler.handler(dict(_EVENT), None)

        assert execute.call_count == 0


class TestStoredRow:
    def test_stores_the_error_category_so_a_retry_reports_the_same_failure(self, search_handler) -> None:
        result = {'provider': 'openai', 'status': 'error', 'error': 'quota', 'error_category': 'no_credit'}

        item = search_handler._result_item('hotel coruña', _TIMESTAMP, result, {}, 'global', None)

        assert item['error_category'] == 'no_credit'
