"""Large, realistic SearchResults data sets for the ``/brand-mentions`` tests.

Every row carries about ten brands with the extraction's Spanish prose
(``sentiment_reason``, ``sentiment_quote``, ``ranking_context``), which is
what made a group answer of that route grow past Lambda's 6 MiB cap.
"""

from __future__ import annotations

from typing import Any

from testing.report_scope_fixtures import RUN_TS
from testing.response_size import long_text
from testing.search_results_fixtures import search_result_row

VOLUME_GROUP_ID = 'volumen'
PROVIDERS = ('openai', 'perplexity', 'gemini', 'claude', 'bedrock', 'brave', 'tavily', 'exa', 'serpapi')
PERSONAS = ('default', 'familia')
TRACKED = (('Hotel Coruña', 'first_party'), ('Parador Rival', 'competitor'), ('Hostal Marina', 'competitor'))
OTHER_BRANDS_PER_ROW = 7


def volume_keyword_text(index: int) -> str:
    return f'hoteles con encanto en galicia {index:04d}'


def volume_keywords(count: int) -> list[dict[str, Any]]:
    """``count`` active keywords of the group ``VOLUME_GROUP_ID``."""
    return [
        {'id': f'kw{index}', 'keyword': volume_keyword_text(index), 'status': 'active', 'group_ids': {VOLUME_GROUP_ID}}
        for index in range(count)
    ]


def prose_brand(name: str, classification: str, rank: int) -> dict[str, Any]:
    """One extracted brand with the full set of Spanish prose fields."""
    return {
        'name': name,
        'classification': classification,
        'rank': rank,
        'mention_count': 2,
        'first_position': rank * 40,
        'sentiment': 'positive' if rank % 2 else 'neutral',
        'sentiment_reason': long_text(160),
        'sentiment_quote': long_text(160),
        'ranking_context': long_text(160),
    }


def row_brands(keyword_index: int) -> list[dict[str, Any]]:
    """The three tracked brands plus ``OTHER_BRANDS_PER_ROW`` brands only this keyword names."""
    tracked = [prose_brand(name, classification, rank) for rank, (name, classification) in enumerate(TRACKED, 1)]
    others = [
        prose_brand(f'Pensión {keyword_index}-{other}', 'other', len(TRACKED) + other + 1)
        for other in range(OTHER_BRANDS_PER_ROW)
    ]
    return tracked + others


def volume_rows(
    keyword_count: int, *, response_chars: int = 0, providers: tuple[str, ...] = PROVIDERS,
) -> dict[str, list[dict[str, Any]]]:
    """One run (``RUN_TS``) of every keyword: one row per provider and persona."""
    return {
        volume_keyword_text(index): [
            search_result_row(
                volume_keyword_text(index), provider, row_brands(index), timestamp=RUN_TS, query_prompt_id=persona,
                response=long_text(response_chars), metadata={'model': f'{provider}-model'},
                seo_feedback=long_text(400), geo_feedback=long_text(400),
            )
            for provider in providers
            for persona in PERSONAS
        ]
        for index in range(keyword_count)
    }
