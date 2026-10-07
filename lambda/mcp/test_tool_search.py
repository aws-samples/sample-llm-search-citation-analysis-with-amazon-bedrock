"""
``search_tools``: the BM25 index over the catalogue finds the right operation for a plain-words need.
"""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st
from tool_search import DEFAULT_LIMIT, ToolIndex, search_tools, tokenize, tool_index


def _ranking(query: str) -> list[str]:
    """Every matching tool, best first."""
    return [tool.name for tool in search_tools(query, limit=100)]


def test_share_of_voice_finds_get_visibility_first():
    assert search_tools('share of voice')[0].name == 'get_visibility'


def test_an_engine_answer_for_a_prompt_ranks_the_answer_tools_before_the_provider_list():
    names = _ranking('ChatGPT answer for a prompt')

    answer_tools = [names.index(name) for name in ('get_brand_mentions', 'get_sentiment_examples') if name in names]
    providers = names.index('list_providers') if 'list_providers' in names else len(names)
    assert answer_tools != []
    assert min(answer_tools) < providers


def test_which_engines_are_enabled_finds_the_provider_list():
    assert _ranking('which engines are enabled')[0] == 'list_providers'


def test_a_query_sharing_no_term_with_the_catalogue_finds_nothing():
    assert search_tools('zzqx plorf wibble') == []


def test_an_empty_query_finds_nothing():
    assert search_tools('') == []


def test_returns_at_most_five_tools_by_default():
    assert (DEFAULT_LIMIT, len(search_tools('keyword'))) == (5, 5)


def test_folds_plurals_so_prompts_and_answers_match_their_singulars():
    assert tokenize('Prompts, answers & KPIs!') == ['prompt', 'answer', 'kpi']


def test_leaves_short_words_and_double_s_endings_alone():
    assert tokenize('sov is less') == ['sov', 'is', 'less']


def test_builds_the_catalogue_index_once_per_process():
    assert tool_index() is tool_index()


def test_an_index_over_no_tools_answers_every_query_with_nothing():
    assert ToolIndex(()).search('visibility') == []


@given(st.text(min_size=0, max_size=60), st.integers(min_value=0, max_value=10))
def test_never_returns_more_than_the_limit_nor_the_same_tool_twice(query, limit):
    names = [tool.name for tool in search_tools(query, limit=limit)]

    assert len(names) <= limit
    assert len(set(names)) == len(names)


def test_start_an_analysis_run_finds_the_run_estimate_and_start():
    assert {tool.name for tool in search_tools('start an analysis run')[:2]} == {'estimate_run', 'start_run'}


def test_how_much_would_a_run_cost_finds_estimate_run_first():
    assert _ranking('how much would a run cost')[0] == 'estimate_run'


def test_find_new_keyword_ideas_finds_the_research_operations():
    assert {tool.name for tool in search_tools('find new keyword ideas')[:2]} == {'estimate_research', 'start_research'}


def test_write_a_landing_page_finds_the_content_brief_operations():
    assert {tool.name for tool in search_tools('write a landing page')[:2]} == {'estimate_content_brief', 'generate_content_brief'}


def test_is_my_run_finished_finds_get_run_status_first():
    assert _ranking('is my run finished')[0] == 'get_run_status'


def test_report_insights_finds_get_report_insights_first():
    assert _ranking('report insights and key takeaways')[0] == 'get_report_insights'


def test_scheduled_runs_finds_list_schedules_first():
    assert _ranking('scheduled runs')[0] == 'list_schedules'


def test_kpi_alerts_finds_list_alerts_first():
    assert _ranking('kpi alerts')[0] == 'list_alerts'


def test_research_job_result_finds_get_research_job_first():
    assert _ranking('research job result')[0] == 'get_research_job'


def test_content_studio_history_finds_list_content_items_first():
    assert _ranking('content studio history')[0] == 'list_content_items'
