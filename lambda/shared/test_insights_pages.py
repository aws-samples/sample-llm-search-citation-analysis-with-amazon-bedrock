"""Tests for shared.insights_pages: an answer lists the first rows of each long fact list; its pages reach the whole list."""

from __future__ import annotations

from shared.insights_pages import FACTS_PAGE, PROMPT_ENGINE_MAX_KEYWORDS, facts_page, listed_facts, with_page_tokens
from shared.snapshot_artifacts import decode_snapshot_cursor

_PAGES = [{'url': f'hotel.example/p{index:03}', 'citations': 500 - index} for index in range(260)]
_KEYWORDS = [{'keyword': f'spa {index:03}', 'visibility_score': index} for index in range(130)]
_FACTS = {
    'engines': [{'engine': 'openai'}],
    'owned_pages': {'pages': _PAGES, 'sections': [], 'engines': [], 'document_citations': 0, 'page_citations': 0},
    'prompt_engine': {'engines': ['openai'], 'keywords': _KEYWORDS},
    'caveat_reasons': {'reasons': [{'competitor': 'Hotel Mar', 'reason': f'reason {index}'} for index in range(230)]},
}


def test_listed_facts_keep_the_first_twenty_five_pages_and_count_the_rest():
    pages = listed_facts(_FACTS)['owned_pages']

    assert (pages['pages'], pages['pages_omitted'], pages['pages_total']) == (_PAGES[:25], 235, 260)


def test_listed_facts_keep_the_first_fifty_keywords_and_count_the_rest():
    prompt = listed_facts(_FACTS)['prompt_engine']

    assert (prompt['keywords'], prompt['omitted'], prompt['keywords_total']) == (_KEYWORDS[:PROMPT_ENGINE_MAX_KEYWORDS], 80, 130)


def test_listed_facts_leave_the_whole_facts_unchanged():
    listed_facts(_FACTS)

    assert len(_FACTS['owned_pages']['pages']) == 260


def test_the_answer_token_then_each_page_token_reach_every_page():
    body = with_page_tokens({'facts': listed_facts(_FACTS)}, 'build-1')
    rows = list(body['facts']['owned_pages']['pages'])
    token = body['facts']['owned_pages']['pages_next_token']
    while token:
        cursor = decode_snapshot_cursor(token)
        assert cursor is not None
        page = facts_page(_FACTS, 'owned_pages', cursor.offset, 'build-1')['facts']['owned_pages']
        rows.extend(page['pages'])
        token = page['next_token']

    assert rows == _PAGES


def test_a_prompt_engine_page_carries_its_engines_and_total():
    page = facts_page(_FACTS, 'prompt_engine', FACTS_PAGE, 'build-1')['facts']['prompt_engine']

    assert (page['engines'], page['keywords'], page['keywords_total'], page['next_token']) == (['openai'], _KEYWORDS[FACTS_PAGE:], 130, None)


def test_listed_facts_list_no_caveat_reason_and_count_them_all():
    reasons = listed_facts(_FACTS)['caveat_reasons']

    assert (reasons['reasons'], reasons['reasons_omitted'], reasons['reasons_total']) == ([], 230, 230)


def test_the_caveat_reasons_token_pages_every_reason_from_the_first():
    body = with_page_tokens({'facts': listed_facts(_FACTS)}, 'build-1')
    rows: list[dict[str, str]] = []
    token = body['facts']['caveat_reasons']['reasons_next_token']
    while token:
        cursor = decode_snapshot_cursor(token)
        assert cursor is not None
        page = facts_page(_FACTS, 'caveat_reasons', cursor.offset, 'build-1')['facts']['caveat_reasons']
        rows.extend(page['reasons'])
        token = page['next_token']

    assert rows == _FACTS['caveat_reasons']['reasons']
