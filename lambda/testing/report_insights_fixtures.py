"""Insights, model narratives and answers for the narrative validator, the GenerateInsights worker and its API."""

from __future__ import annotations

from typing import Any

from testing.search_result_fixtures import successful_answer_row

RUN_TIMESTAMP = '2026-10-07T06:50:33.000000Z'

#: The ReportInsights worker's environment, as CDK sets it.
REPORT_INSIGHTS_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'search',
    'DYNAMODB_TABLE_KEYWORDS': 'keywords',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'brand-config',
    'DYNAMODB_TABLE_REPORT_INSIGHTS': 'report-insights',
}

ENGINE_INSIGHT_ID = 'engine_play:openai'
SUBBRAND_INSIGHT_ID = 'weak_subbrand:Aurora Miles'


def engine_insight(**evidence: Any) -> dict[str, Any]:
    """An ``engine_play`` insight on OpenAI: ranked first in 62.5% of 16 answers, cited in 12.5%."""
    return {
        'id': ENGINE_INSIGHT_ID,
        'kind': 'engine_play',
        'severity': 'high',
        'subject': 'openai',
        'evidence': {'top_1_share': 62.5, 'citation_rate': 12.5, 'answers': 16, 'play': 'get_cited', **evidence},
        'block': 'insights_engine_playbook',
    }


def subbrand_insight() -> dict[str, Any]:
    """A ``weak_subbrand`` insight on Aurora Miles: 4 mentions, 3.25 places behind."""
    return {
        'id': SUBBRAND_INSIGHT_ID,
        'kind': 'weak_subbrand',
        'severity': 'medium',
        'subject': 'Aurora Miles',
        'evidence': {'mentions': 4, 'average_position': 4.25, 'net_sentiment': 10.0, 'position_gap': 3.25, 'sentiment_gap': 15.0},
        'block': 'insights_brand_portfolio',
    }


#: The group KPIs every narrative test validates against.
GROUP_KPIS: dict[str, Any] = {'answers': 40, 'mention_rate': 72.5, 'average_position': 1.8, 'citation_rate': None}


def insight_item(text: str, *insight_ids: str) -> dict[str, Any]:
    """A model insight item citing ``insight_ids`` (the OpenAI insight by default)."""
    return {'text': text, 'insight_ids': list(insight_ids) or [ENGINE_INSIGHT_ID]}


def recommendation_item(text: str, *insight_ids: str, title: str = 'Earn OpenAI citations') -> dict[str, Any]:
    """A model recommendation item citing ``insight_ids`` (the OpenAI insight by default)."""
    return {'title': title, 'text': text, 'insight_ids': list(insight_ids) or [ENGINE_INSIGHT_ID]}


def model_narrative(insights: list[Any] | None = None, recommendations: list[Any] | None = None) -> dict[str, Any]:
    """The JSON object the model returns; its items may be malformed on purpose."""
    return {'insights': insights or [], 'recommendations': recommendations or []}


def ranked_answer_row(keyword: str, provider: str, rank: int, timestamp: str = RUN_TIMESTAMP) -> dict[str, Any]:
    """One successful answer naming Aurora Airways at ``rank`` and Borealis Air right after it."""
    return successful_answer_row(
        keyword=keyword,
        timestamp=timestamp,
        provider=provider,
        brands=[('Aurora Airways', 'first_party', rank), ('Borealis Air', 'competitor', rank + 1)],
        citations=['https://borealis.example/fares'],
    )


def stored_item(**overrides: Any) -> dict[str, Any]:
    """A ``CitationAnalysis-ReportInsights`` item as DynamoDB hands it back."""
    return {
        'scope_key': 'group#group-coruna',
        'run_timestamp': RUN_TIMESTAMP,
        'narrative': {
            'insights': [insight_item('OpenAI ranks Aurora Airways first in 62.5% of answers.')],
            'recommendations': [recommendation_item('Publish fare pages OpenAI can cite.')],
        },
        'model': 'global.anthropic.claude-sonnet-4-6',
        'language': 'es',
        'dropped': 1,
        'generated_at': '2026-10-07T06:55:00.000000Z',
        'ttl': 1822891833,
        **overrides,
    }
