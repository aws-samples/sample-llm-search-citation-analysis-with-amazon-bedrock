"""Tests for shared.dataforseo_serp and shared.dataforseo_ai_overview.

The AI Overview cases use fictional domains; the organic cases cover the SERP panel. ``post_live`` and
``escape_keyword`` are replaced (``FakePostLive``, ``escape_keyword_fake``); no network, no sleeping.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared import dataforseo_client, dataforseo_serp
from shared.dataforseo_ai_overview import citations_from
from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_serp import (
    ORGANIC_LIVE_PATH,
    OrganicItem,
    ai_overview_search,
    markdown_to_text,
    organic_serp,
    parse_ai_overview,
)
from shared.kpi_engine import answers_from_rows, brand_kpis
from testing.dataforseo_endpoint_fixtures import (
    LABS_US,
    FakePostLive,
    Outcome,
    ai_overview_item,
    dataforseo_error,
    escape_keyword_fake,
    organic_item,
    serp_result,
    task_result,
)

_OVERVIEW = ai_overview_item(
    'Use Example Tracker.[[1]](https://tracker.example.com/blog)',
    references=[{'url': 'https://tracker.example.com/blog', 'title': 'Tracker blog'}],
    sub_items=[{
        'references': [{'url': 'https://analytics.example.org/docs'}],
        'links': [{'url': 'https://code.example.net/repo'}],
    }],
)


@pytest.fixture
def fake() -> Iterator[FakePostLive]:
    """A recording ``post_live`` and the documented ``escape_keyword`` rule."""
    post_live = FakePostLive()
    with patch.object(dataforseo_client, 'post_live', post_live), \
            patch.object(dataforseo_client, 'escape_keyword', escape_keyword_fake):
        yield post_live


@pytest.fixture
def sleep() -> Iterator[MagicMock]:
    """The retry delay, recorded instead of slept."""
    with patch.object(dataforseo_serp, '_sleep', MagicMock()) as recorded:
        yield recorded


@pytest.fixture
def organic_task(fake: FakePostLive) -> Callable[[int | None], dict[str, Any]]:
    """Runs ``organic_serp`` (default depth when ``None``) on an empty page; returns the task sent."""
    def run(depth: int | None) -> dict[str, Any]:
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result([])])}
        if depth is None:
            organic_serp('example keyword', LABS_US)
        else:
            organic_serp('example keyword', LABS_US, depth=depth)
        return fake.calls[0].task
    return run


@pytest.fixture
def aio_error(fake: FakePostLive) -> Callable[[Outcome], DataForSeoError]:
    """Runs ``ai_overview_search`` against one outcome and hands back the error it raised."""
    def run(outcome: Outcome) -> DataForSeoError:
        fake.by_path = {ORGANIC_LIVE_PATH: outcome}
        with pytest.raises(DataForSeoError) as raised:
            ai_overview_search('best tracker', LABS_US)
        return raised.value
    return run


class TestParseAiOverview:
    def test_returns_overview_text_without_citation_pills(self):
        _markdown, text, _citations = parse_ai_overview(serp_result([_OVERVIEW]))

        assert text == 'Use Example Tracker.'

    def test_reads_top_level_then_nested_references_as_citations_and_skips_links(self):
        _markdown, _text, citations = parse_ai_overview(serp_result([_OVERVIEW]))

        assert citations == ['https://tracker.example.com/blog', 'https://analytics.example.org/docs']

    def test_keeps_the_original_markdown_when_the_overview_has_text(self):
        markdown, _text, _citations = parse_ai_overview(serp_result([organic_item(1, 'example.com'), _OVERVIEW]))

        assert markdown == 'Use Example Tracker.[[1]](https://tracker.example.com/blog)'

    def test_treats_serp_without_overview_as_no_answer(self):
        assert parse_ai_overview(serp_result([organic_item(1, 'example.com')])) == (None, '', [])

    def test_treats_null_result_as_no_answer(self):
        assert parse_ai_overview(None) == (None, '', [])

    @pytest.mark.parametrize('markdown', ['   \n ', '[[1]](https://example.com/a)', None, ''])
    def test_treats_whitespace_only_or_pill_only_overview_as_no_answer(self, markdown):
        markdown_out, text, _citations = parse_ai_overview(serp_result([ai_overview_item(markdown)]))

        assert (markdown_out, text) == (None, '')

    def test_reads_only_the_first_overview_item(self):
        second = ai_overview_item('Second overview.')

        _markdown, text, _citations = parse_ai_overview(serp_result([_OVERVIEW, second]))

        assert text == 'Use Example Tracker.'


class TestCitationsFrom:
    def test_drops_text_fragment_highlights_from_reference_urls(self):
        urls = citations_from([{'url': 'https://example.com/guide#:~:text=best%20tracker'}])

        assert urls == ['https://example.com/guide']

    def test_rejects_non_http_reference_urls(self):
        urls = citations_from([
            {'url': 'javascript:alert(1)'}, {'url': 'ftp://example.com/file'}, {'url': '/relative'},
            {'url': 42}, 'https://example.com/not-an-object', {'url': 'HTTPS://example.org/upper'},
        ])

        assert urls == ['https://example.org/upper']

    def test_dedupes_repeated_references_in_order(self):
        urls = citations_from([
            {'url': 'https://example.org/b'}, {'url': 'https://example.com/a?utm_source=ai'},
            {'url': 'https://example.org/b#section'}, {'url': 'https://example.com/a'},
        ])

        assert urls == ['https://example.org/b', 'https://example.com/a']

    def test_caps_citations_at_two_thousand(self):
        urls = citations_from([{'url': f'https://example.com/{index}'} for index in range(2100)])

        assert (len(urls), urls[-1]) == (2000, 'https://example.com/1999')


class TestMarkdownToText:
    def test_reduces_links_to_their_label_and_strips_images(self):
        text = markdown_to_text('![logo](https://example.com/logo.png)See [the guide](https://example.com/guide).')

        assert text == 'See the guide.'

    def test_reduces_a_product_card_link_nested_in_a_link_label_to_the_product_name(self):
        card = 'https://www.google.com/search?ibp=oshop&prds=pvt:hg,pvo:48&q=product'
        text = markdown_to_text(f'Try a blend (e.g., [[Acme House Blend]({card}a) ]({card}b)).[[1]](https://example.org/x)')

        assert text == 'Try a blend (e.g., Acme House Blend ).'

    @pytest.mark.parametrize('pill', ['[example.com](https://www.example.com/a)', '[3](https://example.org/x)',
                                      '[[12]](https://example.org/x)', '[www.example.com](https://example.com/)'])
    def test_removes_citation_pills_when_label_is_a_number_or_the_host(self, pill):
        assert markdown_to_text(f'Acme leads.{pill}') == 'Acme leads.'

    def test_strips_emphasis_headings_and_list_bullets(self):
        text = markdown_to_text('## Best tools\n* **Acme** is `fast`\n  - __Example Air__ flies')

        assert text == 'Best tools\nAcme is fast\n  Example Air flies'


class TestOrganicSerp:
    def test_sends_the_exact_body_with_default_depth_twenty(self, organic_task):
        assert organic_task(None) == {
            'keyword': 'example keyword', 'location_code': 2840, 'language_code': 'en',
            'device': 'desktop', 'os': 'windows', 'depth': 20,
        }

    @pytest.mark.parametrize(('depth', 'sent'), [(5, 10), (50, 50), (150, 100)])
    def test_clamps_depth_between_ten_and_one_hundred(self, organic_task, depth, sent):
        assert organic_task(depth)['depth'] == sent

    def test_treats_no_search_results_as_empty_through_the_client(self, fake):
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([], cost=0.0035, no_results=True)}

        snapshot = organic_serp('example keyword', LABS_US)

        assert fake.calls[0].options['treat_no_results_as_empty'] is True
        assert (snapshot.items, snapshot.item_types, snapshot.check_url, snapshot.cost_usd) == ((), (), None, 0.0035)

    def test_keeps_organic_items_ranked_by_rank_group_then_rank_absolute(self, fake):
        items = [_OVERVIEW, organic_item(1, 'example.com', rank_absolute=3),
                 {'type': 'people_also_ask', 'rank_group': 1}, organic_item(None, 'example.org', rank_absolute=7)]
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result(items)])}

        snapshot = organic_serp('example keyword', LABS_US)

        assert snapshot.items == (
            OrganicItem(1, 3, 'https://example.com/page', 'example.com', 'example.com title', 'example.com description'),
            OrganicItem(7, 7, 'https://example.org/page', 'example.org', 'example.org title', 'example.org description'),
        )

    def test_lists_every_item_type_once_in_order_and_reads_check_url(self, fake):
        items = [organic_item(1, 'example.com'), _OVERVIEW, organic_item(2, 'example.org')]
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result(items, check_url='https://www.google.com/x')])}

        snapshot = organic_serp('example keyword', LABS_US)

        assert (snapshot.item_types, snapshot.check_url) == (('organic', 'ai_overview'), 'https://www.google.com/x')


class TestAiOverviewSearch:
    def test_sends_the_exact_billed_request_without_http_retries(self, fake):
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result([_OVERVIEW])])}

        ai_overview_search('best tracker', LABS_US)

        call = fake.calls[0]
        assert {key: value for key, value in call.task.items() if key != 'tag'} == {
            'keyword': 'best tracker', 'location_code': 2840, 'language_code': 'en', 'depth': 10,
            'load_async_ai_overview': True,
        }
        assert call.task['tag'].startswith('aio:')
        assert call.options == {'idempotent': False, 'timeout_s': 150.0, 'treat_no_results_as_empty': True}

    def test_escapes_percent_and_plus_in_keyword(self, fake):
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result([])])}

        ai_overview_search('100% c++', LABS_US)

        assert fake.calls[0].task['keyword'] == '100%25 c%2B%2B'

    def test_returns_success_with_text_citations_and_organic_top_ten(self, fake):
        items = [organic_item(1, 'example.com'), _OVERVIEW]
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result(items)])}

        result = ai_overview_search('best tracker', LABS_US)

        assert (result.status, result.answer_text) == ('success', 'Use Example Tracker.')
        assert result.citations == ('https://tracker.example.com/blog', 'https://analytics.example.org/docs')
        assert [item.domain for item in result.organic] == ['example.com']

    def test_records_the_row_metadata(self, fake):
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result([_OVERVIEW])], cost=0.004, task_id='t-9')}

        metadata = ai_overview_search('best tracker', LABS_US).metadata

        assert {key: value for key, value in metadata.items() if key != 'latency_ms'} == {
            'model': 'google-serp', 'cost_usd': 0.004, 'location_code': 2840, 'language_code': 'en',
            'check_url': 'https://www.google.com/search?q=example+keyword', 'datetime': '2026-09-18 09:00:00 +00:00',
            'item_types': ['ai_overview'], 'asynchronous_ai_overview': True, 'dataforseo_task_id': 't-9',
            'attempts': 1,
        }

    def test_returns_no_answer_with_organic_results_when_the_page_has_no_overview(self, fake):
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result([organic_item(1, 'example.com')])])}

        result = ai_overview_search('best tracker', LABS_US)

        assert (result.status, result.answer_markdown, result.answer_text, result.citations) == ('no_answer', None, '', ())
        assert len(result.organic) == 1

    def test_returns_no_answer_without_citations_when_the_overview_is_empty(self, fake):
        empty = ai_overview_item('  ', references=[{'url': 'https://example.com/a'}])
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([serp_result([empty])])}

        result = ai_overview_search('best tracker', LABS_US)

        assert (result.status, result.citations) == ('no_answer', ())

    def test_classifies_no_search_results_message_as_no_answer(self, fake):
        fake.by_path = {ORGANIC_LIVE_PATH: task_result([], cost=0.002, no_results=True)}

        result = ai_overview_search('best tracker', LABS_US)

        assert (result.status, result.organic, result.metadata['cost_usd']) == ('no_answer', (), 0.002)

    def test_classifies_invalid_field_40501_as_error(self, fake, sleep, aio_error):
        error = aio_error(dataforseo_error('INTERNAL_ERROR', 40501, cost=0.002))

        assert (error.provider_status, len(fake.calls), sleep.call_count) == (40501, 1, 0)

    def test_raises_internal_error_with_the_cost_when_the_result_is_unreadable(self, aio_error):
        error = aio_error(task_result([{'items': 'not-a-list'}], cost=0.004))

        assert (error.code, error.cost_usd) == ('INTERNAL_ERROR', 0.004)

    def test_adds_earlier_failed_attempts_cost_when_the_retried_result_is_unreadable(self, fake, sleep):
        fake.sequence = [dataforseo_error('UPSTREAM_UNAVAILABLE', 50301, cost=0.003),
                         task_result([{'items': 'not-a-list'}], cost=0.004)]

        with pytest.raises(DataForSeoError) as raised:
            ai_overview_search('best tracker', LABS_US)

        assert (raised.value.code, raised.value.cost_usd) == ('INTERNAL_ERROR', pytest.approx(0.007))

    def test_retries_upstream_task_failures_up_to_three_attempts(self, fake, sleep, aio_error):
        error = aio_error(dataforseo_error('UPSTREAM_UNAVAILABLE', 50000))

        assert (error.provider_status, len(fake.calls)) == (50000, 3)
        assert [call.args for call in sleep.call_args_list] == [(3.0,), (3.0,)]

    def test_reports_the_attempt_count_when_a_retry_succeeds(self, fake, sleep):
        fake.sequence = [dataforseo_error('UPSTREAM_UNAVAILABLE', 50301),
                         task_result([serp_result([_OVERVIEW])], cost=0.004)]

        result = ai_overview_search('best tracker', LABS_US)

        assert (result.status, result.metadata['attempts'], sleep.call_count) == ('success', 2, 1)

    @pytest.mark.parametrize('provider_status', [503, 500, None])
    def test_does_not_retry_http_5xx_or_timeout(self, fake, sleep, aio_error, provider_status):
        aio_error(dataforseo_error('UPSTREAM_UNAVAILABLE', provider_status))

        assert (len(fake.calls), sleep.call_count) == (1, 0)


def test_excludes_no_answer_rows_from_every_kpi():
    answered = {'provider': 'openai', 'status': 'success', 'keyword': 'best tracker', 'brands': [], 'citations': []}
    no_answer = {**answered, 'status': 'no_answer', 'response': ''}

    with_no_answer = brand_kpis(answers_from_rows([answered, no_answer]))

    assert with_no_answer == brand_kpis(answers_from_rows([answered]))
