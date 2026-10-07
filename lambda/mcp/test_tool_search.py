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
