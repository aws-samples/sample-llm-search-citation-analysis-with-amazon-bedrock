"""Shared per-keyword visibility loading and aggregation behind ``/visibility``.

The HTTP visibility endpoint reports the latest run of a keyword, or an exact
run when given its timestamp.
"""

from __future__ import annotations

from typing import Any

from shared.constants import UNRANKED_SENTINEL
from shared.dynamo_decimal import to_int
from shared.visibility_score import (
    calculate_share_of_voice,
    calculate_visibility_score,
    mean,
    sentiment_to_score,
    summarize_first_party_prominence,
)

METRICS_PROJECTION = '#ts, provider, brands, query_prompt_id'


def _selected_rows(
    rows: list[dict[str, Any]],
    exact_timestamp: str | None,
    query_prompt_id: str | None,
) -> tuple[str | None, list[dict[str, Any]]]:
    if not rows:
        return None, []

    timestamp = exact_timestamp or max(str(item.get('timestamp', '')) for item in rows)
    selected = [item for item in rows if item.get('timestamp') == timestamp]
    if query_prompt_id:
        selected = [
            item
            for item in selected
            if item.get('query_prompt_id', 'default') == query_prompt_id
        ]
    return timestamp, selected


def _brand_rollup(rows: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], int]:
    brand_data: dict[str, dict[str, Any]] = {}
    total_mentions = 0

    for item in rows:
        provider = item.get('provider', 'unknown')
        for brand in item.get('brands', []):
            name = str(brand.get('name', '')).lower()
            if not name:
                continue

            data = brand_data.setdefault(name, {
                'original_name': brand.get('name'),
                'classification': brand.get('classification', 'other'),
                'providers': set(),
                'mentions': 0,
                'ranks': [],
                'sentiments': [],
            })
            data['providers'].add(provider)
            mention_count = to_int(brand.get('mention_count'), 1)
            data['mentions'] += mention_count
            data['ranks'].append(to_int(brand.get('rank'), UNRANKED_SENTINEL))
            if brand.get('sentiment'):
                data['sentiments'].append(sentiment_to_score(brand.get('sentiment')))
            total_mentions += mention_count

    return brand_data, total_mentions


def _brand_metrics(
    brand_data: dict[str, dict[str, Any]],
    total_mentions: int,
    total_providers: int,
) -> list[dict[str, Any]]:
    metrics: list[dict[str, Any]] = []
    for data in brand_data.values():
        providers = data['providers']
        ranks = data['ranks']
        sentiments = data['sentiments']
        mentions = to_int(data['mentions'], 0)
        best_rank = min(ranks) if ranks else UNRANKED_SENTINEL
        avg_sentiment = sum(sentiments) / len(sentiments) if sentiments else 0.0
        metrics.append({
            'name': data['original_name'],
            'visibility_score': calculate_visibility_score(
                provider_count=len(providers),
                total_mentions=mentions,
                best_rank=best_rank,
                avg_sentiment_score=float(avg_sentiment),
                total_providers=total_providers,
            ),
            'provider_count': len(providers),
            'providers': list(providers),
            'total_mentions': mentions,
            'best_rank': best_rank,
            'classification': data.get('classification', 'other'),
        })

    metrics.sort(key=lambda item: item['visibility_score'], reverse=True)
    shares = calculate_share_of_voice(
        {item['name']: item['total_mentions'] for item in metrics},
        total_mentions,
    )
    for item in metrics:
        item['share_of_voice'] = shares.get(item['name'], 0)
    return metrics


def calculate_keyword_visibility(
    keyword: str,
    rows: list[dict[str, Any]],
    total_providers: int,
    *,
    query_prompt_id: str | None = None,
    exact_timestamp: str | None = None,
) -> dict[str, Any]:
    """Calculate the established visibility payload from projected rows.

    ``exact_timestamp`` is mandatory for post-run evaluation and optional for
    API callers, which retain their latest-timestamp behavior.
    """
    if not rows:
        return {'error': 'No data found for keyword'}

    timestamp, selected = _selected_rows(rows, exact_timestamp, query_prompt_id)
    if timestamp is None or (exact_timestamp is not None and not selected):
        return {'error': 'No data found for keyword'}

    prominence = summarize_first_party_prominence([
        [
            brand
            for brand in item.get('brands', [])
            if brand.get('classification') == 'first_party'
        ]
        for item in selected
    ])
    brand_data, total_mentions = _brand_rollup(selected)
    brands = _brand_metrics(brand_data, total_mentions, total_providers)
    first_party = [item for item in brands if item['classification'] == 'first_party']
    competitors = [item for item in brands if item['classification'] == 'competitor']
    others = [item for item in brands if item['classification'] == 'other']

    return {
        'keyword': keyword,
        'timestamp': timestamp,
        'total_mentions': total_mentions,
        'total_providers': total_providers,
        'brands': brands,
        'first_party': first_party,
        'competitors': competitors,
        'others': others,
        'prominence': prominence,
        'summary': {
            'first_party_avg_score': round(mean(item['visibility_score'] for item in first_party), 1),
            'competitor_avg_score': round(mean(item['visibility_score'] for item in competitors), 1),
            'first_party_total_sov': round(sum(item['share_of_voice'] for item in first_party), 2),
            'competitor_total_sov': round(sum(item['share_of_voice'] for item in competitors), 2),
        },
    }
