"""
Tests for shared.research_jobs — the job/step row shape both the research API
and the research worker rely on.

- merged expansion keywords are deduplicated on keyword identity, keep the
  best relevance and every proposing provider, and rank by relevance
- merged competitor analyses union each category without duplicates
- the final status follows the step outcomes (completed / partial / failed)
- the public view strips raw responses and exposes progressive results
"""

from __future__ import annotations

from decimal import Decimal

from shared.research_agent import LEGACY_DIMENSION_CATALOG
from shared.research_jobs import (
    RESEARCH_STALE_AFTER_SECONDS,
    RESEARCH_TTL_SECONDS,
    build_job_item,
    final_status,
    merge_competitor_analyses,
    merge_expansion_keywords,
    public_view,
    step_id_for,
    summarize_job,
    ttl_epoch,
)


def _step(provider: str, status: str = 'completed', **fields) -> dict:
    return {'provider': provider, 'status': status, **fields}


class TestBuildJobItem:
    def test_starts_pending_with_no_steps_and_a_ttl(self):
        item = build_job_item('job-1', 'expansion', {'seed_keyword': 'hotels', 'count': 20}, timestamp='2026-09-18T10:00:00Z')

        assert item['status'] == 'pending'
        assert item['steps'] == {}
        assert (item['steps_total'], item['steps_done'], item['keyword_count']) == (0, 0, 0)
        assert item['ttl'] > 0

    def test_carries_the_request_fields_and_timestamps(self):
        item = build_job_item('job-1', 'competitor', {'url': 'https://a.com', 'domain': 'a.com'}, timestamp='2026-09-18T10:00:00Z')

        assert (item['id'], item['type'], item['url'], item['domain']) == ('job-1', 'competitor', 'https://a.com', 'a.com')
        assert (item['created_at'], item['updated_at']) == ('2026-09-18T10:00:00Z', '2026-09-18T10:00:00Z')


class TestTtl:
    def test_expires_ninety_days_after_now(self):
        assert ttl_epoch(now=1_000) == 1_000 + RESEARCH_TTL_SECONDS
        assert RESEARCH_TTL_SECONDS == 90 * 24 * 3600

    def test_stale_threshold_exceeds_the_thirty_minute_state_machine_timeout(self):
        assert RESEARCH_STALE_AFTER_SECONDS > 30 * 60


class TestStepIds:
    def test_step_id_is_round_then_provider(self):
        assert step_id_for('openai') == 'r1-openai'
        assert step_id_for('gemini', round_number=2) == 'r2-gemini'


class TestMergeExpansionKeywords:
    def test_deduplicates_keywords_that_differ_only_in_case_and_surrounding_spaces(self):
        merged = merge_expansion_keywords([
            _step('perplexity', keywords=[{'keyword': 'Hotel Malaga', 'relevance': 7}]),
            _step('openai', keywords=[{'keyword': ' hotel malaga ', 'relevance': 9}]),
        ])

        assert [entry['keyword'] for entry in merged] == ['hotel malaga']

    def test_keeps_the_entry_with_the_highest_relevance(self):
        merged = merge_expansion_keywords([
            _step('perplexity', keywords=[{'keyword': 'hotel malaga', 'relevance': 7, 'intent': 'informational'}]),
            _step('openai', keywords=[{'keyword': 'hotel malaga', 'relevance': 9, 'intent': 'commercial'}]),
        ])

        assert merged[0]['relevance'] == 9
        assert merged[0]['intent'] == 'commercial'

    def test_records_every_provider_that_proposed_the_keyword(self):
        merged = merge_expansion_keywords([
            _step('perplexity', keywords=[{'keyword': 'hotel malaga', 'relevance': 7}]),
            _step('openai', keywords=[{'keyword': 'hotel malaga', 'relevance': 9}]),
            _step('gemini', keywords=[{'keyword': 'hotel malaga', 'relevance': 5}]),
        ])

        assert merged[0]['providers'] == ['perplexity', 'openai', 'gemini']

    def test_ranks_by_relevance_then_provider_agreement_then_text(self):
        merged = merge_expansion_keywords([
            _step('perplexity', keywords=[
                {'keyword': 'b keyword', 'relevance': 8},
                {'keyword': 'a keyword', 'relevance': 8},
                {'keyword': 'top keyword', 'relevance': 9},
            ]),
            _step('openai', keywords=[{'keyword': 'b keyword', 'relevance': 6}]),
        ])

        assert [entry['keyword'] for entry in merged] == ['top keyword', 'b keyword', 'a keyword']

    def test_reads_decimal_relevance_as_written_by_dynamodb(self):
        merged = merge_expansion_keywords([
            _step('openai', keywords=[{'keyword': 'low', 'relevance': Decimal('3')}, {'keyword': 'high', 'relevance': Decimal('9.5')}]),
        ])

        assert [entry['keyword'] for entry in merged] == ['high', 'low']

    def test_ignores_entries_without_a_usable_keyword(self):
        merged = merge_expansion_keywords([
            _step('openai', keywords=[{'keyword': ''}, {'keyword': '   '}, 'not a dict', {'intent': 'x'}, {'keyword': 'ok'}]),
        ])

        assert [entry['keyword'] for entry in merged] == ['ok']

    def test_returns_empty_list_when_no_step_completed(self):
        assert merge_expansion_keywords([]) == []


class TestMergeCompetitorAnalyses:
    def test_unions_each_category_without_duplicates(self):
        merged = merge_competitor_analyses([
            _step('perplexity', analysis={'primary_keywords': [{'keyword': 'hotel deals'}], 'content_gaps': [{'keyword': 'spa hotel'}]}),
            _step('openai', analysis={'primary_keywords': [{'keyword': 'Hotel Deals'}, {'keyword': 'beach hotel'}]}),
        ])

        assert [entry['keyword'] for entry in merged['primary_keywords']] == ['hotel deals', 'beach hotel']
        assert [entry['keyword'] for entry in merged['content_gaps']] == ['spa hotel']

    def test_tags_each_keyword_with_the_provider_that_found_it(self):
        merged = merge_competitor_analyses([
            _step('openai', analysis={'secondary_keywords': [{'keyword': 'best resorts'}]}),
        ])

        assert merged['secondary_keywords'][0]['provider'] == 'openai'

    def test_takes_domain_industry_and_focus_from_the_first_provider_that_knows_them(self):
        merged = merge_competitor_analyses([
            _step('perplexity', analysis={'industry': 'unknown', 'page_focus': ''}),
            _step('openai', analysis={'domain': 'a.com', 'industry': 'hospitality', 'page_focus': 'resort bookings'}),
        ])

        assert (merged['domain'], merged['industry'], merged['page_focus']) == ('a.com', 'hospitality', 'resort bookings')

    def test_keeps_the_scraped_seo_elements_once(self):
        merged = merge_competitor_analyses([
            _step('perplexity', analysis={'seo_elements': {'title': 'first'}}),
            _step('openai', analysis={'seo_elements': {'title': 'second'}}),
        ])

        assert merged['seo_elements'] == {'title': 'first'}

    def test_returns_the_default_shape_when_no_step_completed(self):
        merged = merge_competitor_analyses([])

        assert merged['industry'] == 'unknown'
        assert (merged['primary_keywords'], merged['secondary_keywords'], merged['longtail_keywords'], merged['content_gaps']) == ([], [], [], [])


class TestFinalStatus:
    def test_completed_when_every_step_succeeded(self):
        job = {'steps': {'a': _step('openai'), 'b': _step('gemini')}}

        assert final_status(job) == 'completed'

    def test_partial_when_some_steps_failed(self):
        job = {'steps': {'a': _step('openai'), 'b': _step('perplexity', 'failed')}}

        assert final_status(job) == 'partial'

    def test_failed_when_no_step_succeeded(self):
        job = {'steps': {'a': _step('openai', 'failed'), 'b': _step('perplexity', 'failed')}}

        assert final_status(job) == 'failed'

    def test_failed_when_there_are_no_steps_at_all(self):
        assert final_status({'steps': {}}) == 'failed'


class TestSummarizeJob:
    def test_counts_done_and_failed_steps_separately(self):
        job = {
            'type': 'expansion',
            'steps': {
                'a': _step('openai', keywords=[{'keyword': 'x', 'relevance': 1}]),
                'b': _step('perplexity', 'failed'),
                'c': _step('gemini', 'running'),
            },
        }

        summary = summarize_job(job)

        assert (summary['steps_done'], summary['steps_failed'], summary['keyword_count']) == (2, 1, 1)
        assert summary['provider'] == 'openai'

    def test_competitor_summary_counts_keywords_across_categories(self):
        job = {
            'type': 'competitor',
            'steps': {
                'a': _step('openai', analysis={'primary_keywords': [{'keyword': 'x'}], 'content_gaps': [{'keyword': 'y'}]}),
            },
        }

        summary = summarize_job(job)

        assert summary['keyword_count'] == 2
        assert 'keywords' not in summary


class TestPublicView:
    def _running_job(self) -> dict:
        return {
            'id': 'job-1', 'type': 'expansion', 'status': 'running', 'steps_total': 2, 'ttl': 123,
            'raw_response': 'legacy',
            'steps': {
                'r1-perplexity': _step('perplexity', 'failed', error_message='401', raw_response='...'),
                'r1-openai': _step('openai', keywords=[{'keyword': 'hotel', 'relevance': 8}], keyword_count=1, raw_response='[...]'),
            },
        }

    def test_strips_raw_responses_and_ttl(self):
        view = public_view(self._running_job())

        assert 'raw_response' not in view
        assert 'ttl' not in view
        assert all('raw_response' not in step for step in view['steps'])

    def test_lists_steps_sorted_by_id_with_their_outcome(self):
        view = public_view(self._running_job())

        assert [(step['step_id'], step['status']) for step in view['steps']] == [('r1-openai', 'completed'), ('r1-perplexity', 'failed')]
        assert view['steps'][1]['error_message'] == '401'

    def test_exposes_merged_results_while_running(self):
        view = public_view(self._running_job())

        assert [entry['keyword'] for entry in view['keywords']] == ['hotel']
        assert (view['steps_done'], view['steps_total']) == (2, 2)

    def test_leaves_a_finalized_result_as_persisted(self):
        job = {**self._running_job(), 'status': 'partial', 'keywords': [{'keyword': 'persisted'}], 'keyword_count': 1}

        view = public_view(job)

        assert [entry['keyword'] for entry in view['keywords']] == ['persisted']

    def test_includes_the_raw_response_only_on_request(self):
        job = {'id': 'legacy', 'type': 'expansion', 'status': 'completed', 'raw_response': 'blob'}

        assert 'raw_response' not in public_view(job)
        assert public_view(job, include_raw=True)['raw_response'] == 'blob'


    def test_agent_steps_expose_their_planned_query_dimension_and_round(self):
        job = {
            'id': 'job-a', 'type': 'agent', 'status': 'running',
            'steps': {'r1-q1-openai': {**_step('openai', keyword_count=3), 'round': 1, 'query': 'hoteles coruña', 'dimension': 'destination', 'rationale': 'core'}},
        }

        step = public_view(job)['steps'][0]

        assert (step['round'], step['query'], step['dimension']) == (1, 'hoteles coruña', 'destination')
        assert 'rationale' not in step

    def test_signals_step_exposes_how_many_queries_it_covers(self):
        job = {
            'id': 'job-a', 'type': 'agent', 'status': 'running',
            'steps': {'r1-signals-serpapi': {**_step('serpapi'), 'round': 1, 'queries': [{'query': 'a'}, {'query': 'b'}]}},
        }

        step = public_view(job)['steps'][0]

        assert step['query_count'] == 2
        assert 'queries' not in step

    def test_provider_steps_carry_no_agent_fields(self):
        step = public_view(self._running_job())['steps'][0]

        assert set(step) == {'step_id', 'provider', 'status', 'keyword_count', 'error_message', 'started_at', 'finished_at'}

    def test_completes_the_industry_profile_of_a_legacy_agent_run(self):
        job = {'id': 'job-a', 'type': 'agent', 'status': 'completed', 'config': {'seed': 'Hotel Gran Marino', 'dimensions': ['destination']}}

        config = public_view(job)['config']

        assert (config['subject'], config['audience']) == ('hotel', 'travellers')
        assert config['dimension_catalog'] == LEGACY_DIMENSION_CATALOG
        assert config['tracking_count'] == 15
        assert job['config'] == {'seed': 'Hotel Gran Marino', 'dimensions': ['destination']}

    def test_caps_a_legacy_tracking_default_at_the_saved_target(self):
        job = {
            'id': 'job-a',
            'type': 'agent',
            'status': 'completed',
            'config': {'seed': 'Hotel Gran Marino', 'target_count': 10},
        }

        config = public_view(job)['config']

        assert config['tracking_count'] == 10
        assert 'tracking_count' not in job['config']

    def test_keeps_the_snapshotted_profile_of_a_current_agent_run(self):
        catalog = [{'id': 'menu', 'label': 'Menu & drinks', 'description': 'd'}, {'id': 'location', 'label': 'Location', 'description': 'd'}]
        job = {'id': 'job-c', 'type': 'agent', 'status': 'completed', 'config': {'seed': 'Café Central', 'subject': 'café', 'audience': 'coffee drinkers', 'dimension_catalog': catalog}}

        config = public_view(job)['config']

        assert (config['subject'], config['audience'], config['dimension_catalog']) == ('café', 'coffee drinkers', catalog)

    def test_leaves_non_agent_configs_alone(self):
        job = {'id': 'job-e', 'type': 'expansion', 'status': 'completed', 'config': {'seed': 'hotel'}}

        assert public_view(job)['config'] == {'seed': 'hotel'}
