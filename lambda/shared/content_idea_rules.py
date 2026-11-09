"""
The content ideas of Content Studio (``GET /api/content-studio/ideas``).

Each keyword's **latest run** earns up to three ideas (``keyword_idea_entry``):
a visibility gap, a ranking improvement or leadership maintenance, a
provider gap, and a negative-sentiment fix. A scope's ideas
(``ideas_artifact`` then ``served_ideas``) are the 50 most urgent, by
priority then keyword, with the calendar-driven seasonal ideas of its first
keywords mixed in when served. Before brand extraction has run anywhere in
the scope, each keyword with citations gets a citation-analysis idea instead.

The rules were in ``api/content-studio.py``; its live path and the
``content-ideas`` artifact share them here. Idea ids are minted when served,
as before (each response numbers its own ideas).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from shared.brand_visibility import classify_brand, tracked_brand_names
from shared.config import LLM_PROVIDERS, provider_display_name
from shared.constants import priority_rank
from shared.scope_order import UNRANKED, brand_rank, keyword_order
from shared.search_results import latest_run
from shared.utils import utc_now

#: Ideas one response lists, and citation-analysis ideas before brand extraction.
#: Ideas an ideas page lists by default (2.45.0 wave 5: the scope's every idea is paged, ``ideas_total`` counts them all).
MAX_IDEAS = 50
#: Keywords the seasonal suggestions look at, and URLs an idea carries.
SEASONAL_KEYWORDS = 10
IDEA_URLS = 10


_SEASONAL_THEMES = {
    1: ['new year', 'winter', 'january deals', 'fresh start'],
    2: ['valentine', 'romantic', 'couples', 'winter getaway'],
    3: ['spring break', 'march', 'spring travel', 'easter'],
    4: ['spring', 'easter', 'april', 'outdoor'],
    5: ['memorial day', 'spring', 'may', "mother's day"],
    6: ['summer', 'june', "father's day", 'graduation'],
    7: ['summer vacation', 'july', 'independence day', 'beach'],
    8: ['back to school', 'august', 'summer', 'late summer'],
    9: ['fall', 'september', 'labor day', 'autumn'],
    10: ['fall', 'october', 'halloween', 'autumn travel'],
    11: ['thanksgiving', 'november', 'black friday', 'holiday prep'],
    12: ['holiday', 'christmas', 'december', 'new year', 'winter'],
}
_INDUSTRY_SEASONAL = {
    'hotels': {
        1: 'Winter Escape Packages', 2: 'Romantic Getaway Guide', 3: 'Spring Break Destinations',
        6: 'Summer Family Vacation Guide', 11: 'Holiday Travel Planning', 12: "New Year's Eve Celebrations",
    },
    'restaurants': {
        2: "Valentine's Day Dining Guide", 5: "Mother's Day Brunch Spots", 6: "Father's Day Dinner Ideas",
        11: 'Thanksgiving Dining Options', 12: 'Holiday Party Venues',
    },
    'retail': {8: 'Back to School Shopping Guide', 11: 'Black Friday Deals Preview', 12: 'Holiday Gift Guide'},
    'travel': {3: 'Spring Break Planning', 6: 'Summer Vacation Ideas', 12: 'Holiday Travel Tips'},
}


def _with_id(idea: Mapping[str, Any]) -> dict[str, Any]:
    return {'id': str(uuid.uuid4()), **idea}


def _seasonal_idea(keyword: str, theme: str) -> dict[str, Any]:
    return {
        'type': 'seasonal_content',
        'priority': 'medium',
        'title': f'Seasonal Content: "{keyword}"',
        'description': f'This keyword is relevant for {theme} season. Create timely content to capture seasonal traffic.',
        'keyword': keyword,
        'source': 'seasonal_analysis',
        'seasonal_theme': theme,
        'competitor_urls': [],
        'actionable': True,
        'content_angle': 'seasonal',
    }


def _matching_theme(keyword: str, themes: Sequence[str]) -> str | None:
    keyword_lower = keyword.lower()
    return next((theme for theme in themes if theme in keyword_lower or any(word in keyword_lower for word in theme.split())), None)


def seasonal_suggestions(keywords: Sequence[str], industry: str) -> list[dict[str, Any]]:
    """Seasonal, trending and evergreen ideas for this month from the scope's first keywords."""
    month = utc_now().month
    themes = _SEASONAL_THEMES.get(month, [])
    ideas = []
    for keyword in keywords[:SEASONAL_KEYWORDS]:
        theme = _matching_theme(keyword, themes)
        if theme is not None:
            ideas.append(_with_id(_seasonal_idea(keyword, theme)))
    industry_content = _INDUSTRY_SEASONAL.get(industry, {}).get(month)
    if industry_content and keywords:
        ideas.append(_with_id({
            'type': 'trending_topic',
            'priority': 'medium',
            'title': f'Trending: {industry_content}',
            'description': f'Create content for this trending topic in {industry}. High search volume expected this month.',
            'keyword': keywords[0],
            'source': 'trend_analysis',
            'trending_topic': industry_content,
            'competitor_urls': [],
            'actionable': True,
            'content_angle': 'trending',
        }))
    if keywords:
        ideas.append(_with_id({
            'type': 'evergreen_content',
            'priority': 'low',
            'title': f'Evergreen Guide: Ultimate {keywords[0].title()} Resource',
            'description': 'Create comprehensive evergreen content that ranks year-round and establishes authority.',
            'keyword': keywords[0],
            'source': 'evergreen_analysis',
            'competitor_urls': [],
            'actionable': True,
            'content_angle': 'evergreen',
        }))
    return ideas


def system_idea(idea_type: str, title: str, description: str) -> dict[str, Any]:
    """A non-actionable placeholder shown while there is nothing to analyse."""
    return _with_id({
        'type': idea_type, 'priority': 'high', 'title': title, 'description': description,
        'keyword': None, 'source': 'system', 'competitor_urls': [], 'actionable': False,
    })


@dataclass
class _KeywordVisibility:
    """How tracked brands appeared in one keyword's latest run."""

    fp_found: bool = False
    fp_best_rank: int = UNRANKED
    fp_providers: set[str] = field(default_factory=set)
    fp_sentiment: list[str] = field(default_factory=list)
    comp_mentions: list[dict[str, Any]] = field(default_factory=list)
    all_providers: set[str] = field(default_factory=set)
    competitor_citations: set[str] = field(default_factory=set)
    all_citations: set[str] = field(default_factory=set)

    def competitor_urls(self) -> list[str]:
        return sorted(self.competitor_citations)[:IDEA_URLS]

    def every_url(self) -> list[str]:
        return sorted(self.all_citations)[:IDEA_URLS]


def _record_brand(visibility: _KeywordVisibility, provider: str, brand: Mapping[str, Any], citations: list[str], tracked: tuple[list[str], list[str]]) -> None:
    rank = brand_rank(brand)
    classification = classify_brand(dict(brand), *tracked)
    if classification == 'first_party':
        visibility.fp_found = True
        visibility.fp_best_rank = min(visibility.fp_best_rank, rank)
        visibility.fp_providers.add(provider)
        visibility.fp_sentiment.append(brand.get('sentiment', 'neutral'))
    elif classification == 'competitor':
        visibility.comp_mentions.append({'name': brand.get('name'), 'rank': rank, 'provider': provider})
        visibility.competitor_citations.update(citations)


def _visibility(rows: Iterable[Mapping[str, Any]], tracked: tuple[list[str], list[str]]) -> _KeywordVisibility:
    visibility = _KeywordVisibility()
    for row in rows:
        provider = row.get('provider', '')
        visibility.all_providers.add(provider)
        citations = list(row.get('citations') or [])
        visibility.all_citations.update(citations)
        for brand in row.get('brands') or []:
            _record_brand(visibility, provider, brand, citations, tracked)
    return visibility


def _ranked_keyword_idea(keyword: str, visibility: _KeywordVisibility, copy: Mapping[str, str], competitor_urls: list[str]) -> dict[str, Any]:
    return {
        'type': copy['type'],
        'priority': copy['priority'],
        'title': copy['title'],
        'description': copy['description'],
        'keyword': keyword,
        'source': copy['source'],
        'current_rank': visibility.fp_best_rank,
        'competitor_brands': [item['name'] for item in visibility.comp_mentions[:3]],
        'competitor_urls': competitor_urls,
        'providers_present': sorted(visibility.fp_providers),
        'actionable': True,
        'content_angle': copy['content_angle'],
    }


def _visibility_gap_idea(keyword: str, visibility: _KeywordVisibility) -> dict[str, Any]:
    return {
        'type': 'visibility_gap',
        'priority': 'high',
        'title': f'Create Content for "{keyword}"',
        'description': f"Your brand doesn't appear but {len(visibility.comp_mentions)} competitors do.",
        'keyword': keyword,
        'source': 'visibility_analysis',
        'competitor_brands': [item['name'] for item in visibility.comp_mentions[:5]],
        'competitor_urls': visibility.competitor_urls(),
        'providers_missing': sorted(visibility.all_providers),
        'actionable': True,
        'content_angle': 'comprehensive_guide',
    }


def _primary_idea(keyword: str, visibility: _KeywordVisibility) -> dict[str, Any] | None:
    best = visibility.fp_best_rank
    if not visibility.fp_found:
        return _visibility_gap_idea(keyword, visibility) if visibility.comp_mentions else None
    if best > 2 and visibility.comp_mentions:
        return _ranked_keyword_idea(keyword, visibility, {
            'type': 'ranking_improvement',
            'priority': 'medium' if best > 3 else 'low',
            'title': f'Improve Ranking for "{keyword}"',
            'description': f'Your brand ranks #{best}. Create better content to reach #1.',
            'source': 'ranking_analysis',
            'content_angle': 'differentiation',
        }, visibility.competitor_urls())
    if best <= 2:
        return _ranked_keyword_idea(keyword, visibility, {
            'type': 'leadership_maintenance',
            'priority': 'low',
            'title': f'Maintain Leadership for "{keyword}"',
            'description': f"You're #{best}! Create fresh content to stay ahead of {len(visibility.comp_mentions)} competitors.",
            'source': 'leadership_analysis',
            'content_angle': 'thought_leadership',
        }, visibility.every_url())
    return None


def _provider_gap_idea(keyword: str, visibility: _KeywordVisibility) -> dict[str, Any] | None:
    # Answer engines only: web-search providers return links, not answers, so they cannot "miss" the brand.
    missing = sorted((visibility.all_providers - visibility.fp_providers) & set(LLM_PROVIDERS))
    if not visibility.fp_found or not missing:
        return None
    missing_names = ', '.join(provider_display_name(provider) for provider in missing)
    return {
        'type': 'provider_gap',
        'priority': 'medium',
        'title': f'Target {missing_names} for "{keyword}"',
        'description': f'Your brand appears on some AI engines but not on {missing_names}.',
        'keyword': keyword,
        'source': 'provider_analysis',
        'providers_missing': missing,
        'providers_present': sorted(visibility.fp_providers),
        'competitor_urls': visibility.competitor_urls(),
        'actionable': True,
        'content_angle': 'provider_optimization',
    }


def _sentiment_idea(keyword: str, visibility: _KeywordVisibility) -> dict[str, Any] | None:
    negative_count = sum(1 for sentiment in visibility.fp_sentiment if sentiment == 'negative')
    if not visibility.fp_found or negative_count == 0:
        return None
    return {
        'type': 'sentiment_improvement',
        'priority': 'high',
        'title': f'Address Negative Sentiment for "{keyword}"',
        'description': f'Your brand has negative sentiment in {negative_count} provider(s). Create positive content.',
        'keyword': keyword,
        'source': 'sentiment_analysis',
        'current_rank': visibility.fp_best_rank,
        'competitor_urls': visibility.every_url(),
        'providers_present': sorted(visibility.fp_providers),
        'actionable': True,
        'content_angle': 'reputation_management',
    }


def _citation_idea(keyword: str, rows: Iterable[Mapping[str, Any]]) -> dict[str, Any] | None:
    citations = sorted({citation for row in rows for citation in row.get('citations') or []})
    if not citations:
        return None
    return {
        'type': 'citation_opportunity',
        'priority': 'medium',
        'title': f'Analyze Citations for "{keyword}"',
        'description': f'Found {len(citations)} unique citations. Brand extraction not yet run for this data.',
        'keyword': keyword,
        'source': 'citation_analysis',
        'competitor_urls': citations[:IDEA_URLS],
        'actionable': True,
        'content_angle': 'comprehensive_guide',
    }


def keyword_idea_entry(keyword: str, rows: Sequence[Mapping[str, Any]], config: Mapping[str, Any]) -> dict[str, Any] | None:
    """What one keyword's latest run adds to a scope's ideas (ideas without ids); ``None`` without rows or a keyword."""
    if not keyword or not rows:
        return None
    _timestamp, latest = latest_run([dict(row) for row in rows])
    visibility = _visibility(latest, tracked_brand_names(dict(config)))
    ideas = [idea for idea in (_primary_idea(keyword, visibility), _provider_gap_idea(keyword, visibility), _sentiment_idea(keyword, visibility)) if idea]
    return {
        'keyword': keyword,
        'has_brands': any(row.get('brands') for row in latest),
        'ideas': ideas,
        'citation_idea': _citation_idea(keyword, latest),
    }


def idea_order(idea: Mapping[str, Any]) -> tuple[int, str]:
    """Most urgent first, then by keyword (stable, so one keyword's ideas keep their order)."""
    return priority_rank(idea.get('priority')), str(idea.get('keyword') or '')


def ideas_artifact(entries: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """What a scope's ideas are served from: every keyword idea (most urgent first), every citation idea and the first keywords."""
    ordered = sorted(entries, key=lambda entry: keyword_order(str(entry['keyword'])))
    ideas = sorted((idea for entry in ordered for idea in entry['ideas']), key=idea_order)
    return {
        'keywords': len(ordered),
        'has_brands': any(entry['has_brands'] for entry in ordered),
        'ideas': ideas,
        'citation_ideas': [entry['citation_idea'] for entry in ordered if entry['citation_idea']],
        'first_keywords': [str(entry['keyword']) for entry in ordered[:SEASONAL_KEYWORDS]],
    }


def served_ideas(artifact: Mapping[str, Any], industry: str) -> list[dict[str, Any]]:
    """Every idea of a scope from its ``ideas_artifact``, with ids and this month's seasonal ideas for ``industry``, most urgent first.

    The caller pages them, and answers the configuration placeholder when no first-party brand is set.
    """
    if not artifact['keywords']:
        return [system_idea('data', 'Run Your First Analysis', 'No search data found. Run an analysis to generate content ideas.')]
    if not artifact['has_brands']:
        return [_with_id(idea) for idea in artifact['citation_ideas']]
    ideas = [*(_with_id(idea) for idea in artifact['ideas']), *seasonal_suggestions(artifact['first_keywords'], industry)]
    ideas.sort(key=idea_order)
    return ideas


def configuration_idea() -> dict[str, Any]:
    """The placeholder answered while no first-party brand is configured."""
    return system_idea('configuration', 'Configure Your Brands First', 'Add your brand names in Settings to enable content recommendations.')


__all__ = [
    'MAX_IDEAS', 'configuration_idea', 'ideas_artifact', 'keyword_idea_entry', 'seasonal_suggestions', 'served_ideas', 'system_idea',
]
