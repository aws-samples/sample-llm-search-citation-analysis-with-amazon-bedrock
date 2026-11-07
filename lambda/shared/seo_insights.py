"""SEO recommendations: where Google standing and AI answers disagree (pure rules on SEO vs GEO rows).

Each rule reads the rows of ``shared.seo_geo`` and yields at most one recommendation in the Action Center's
shape ``{id, type, priority, title, description, action, keywords, impact}``. The ``id`` is
``shared.utils.recommendation_id`` (type, title and keywords), the same identity the Action Center's
recommendations have, so ``POST /api/recommendations/{id}/status`` tracks these too. Titles never carry
counts, so the id only changes when the keywords do.

* ``aio_missing_you`` (high): Google shows an AI Overview, you rank in the top 3, and the overview does
  not cite you.
* ``aio_competitor_cited`` (high): the AI Overview cites a competitor that ranks below you organically
  (or not at all in the top 10).
* ``ai_gap`` (medium): you rank in the top 10 but fewer than 50% of AI answers name you.
* ``seo_gap`` (medium): at least 50% of AI answers name you but you are not in the top 10.

``keywords`` lists the ``MAX_KEYWORDS`` largest-volume keywords of the rule (rows arrive sorted by volume);
the description counts all of them.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from shared.seo_geo import AI_GAP, SEO_GAP, SEO_TOP_POSITION
from shared.utils import recommendation_id

Row = Mapping[str, Any]

MAX_KEYWORDS = 5
#: "You rank top 3": the positions the AI Overview missing you is most striking for.
TOP_POSITIONS = 3

PRIORITY_ORDER = {'high': 0, 'medium': 1, 'low': 2}


def _volume_note(rows: Sequence[Row]) -> str:
    volume = sum(volume for row in rows if isinstance(volume := row.get('search_volume'), int))
    return f'{volume:,} monthly searches across these keywords' if volume else 'Search volume not fetched yet'


def _recommendation(
    rule_type: str, priority: str, title: str, description: str, action: str, rows: Sequence[Row],
) -> dict[str, Any]:
    recommendation = {
        'type': rule_type,
        'priority': priority,
        'title': title,
        'description': description,
        'action': action,
        'keywords': [str(row.get('keyword') or '') for row in rows[:MAX_KEYWORDS]],
        'impact': _volume_note(rows),
    }
    return {'id': recommendation_id(recommendation), **recommendation}


def _plural(count: int) -> str:
    return f'{count} keyword' if count == 1 else f'{count} keywords'


def _position(row: Row) -> int | None:
    value = row.get('organic_position')
    return value if isinstance(value, int) else None


def aio_missing_you(rows: Sequence[Row]) -> list[dict[str, Any]]:
    """AI Overview shown, you rank top 3, the overview does not cite you."""
    matches = [
        row for row in rows
        if row.get('ai_overview_shown') is True and row.get('ai_overview_cites_you') is False
        and (position := _position(row)) is not None and position <= TOP_POSITIONS
    ]
    if not matches:
        return []
    return [_recommendation(
        'aio_missing_you', 'high', 'AI Overviews leave you out despite a top-3 ranking',
        f'On {_plural(len(matches))} you rank in Google\'s top {TOP_POSITIONS}, yet the AI Overview above the results '
        'does not cite any of your pages.',
        'Make the ranking page answer the query in its first paragraphs, with clear headings, facts and dates the '
        'overview can quote.',
        matches,
    )]


def _outranked_cited(row: Row) -> bool:
    position = _position(row)
    cited = row.get('ai_overview_cited_competitors')
    positions = row.get('competitor_positions')
    if position is None or not isinstance(cited, list) or not isinstance(positions, Mapping):
        return False
    return any(not isinstance(theirs := positions.get(name), int) or position < theirs for name in cited)


def aio_competitor_cited(rows: Sequence[Row]) -> list[dict[str, Any]]:
    """The AI Overview cites a competitor you outrank organically."""
    matches = [row for row in rows if row.get('ai_overview_shown') is True and _outranked_cited(row)]
    if not matches:
        return []
    return [_recommendation(
        'aio_competitor_cited', 'high', 'AI Overviews cite competitors you outrank',
        f'On {_plural(len(matches))} the AI Overview cites a competitor whose page ranks below yours in Google.',
        'Compare the cited competitor pages with yours: cover the facts, comparisons and formats they offer that '
        'the overview quotes.',
        matches,
    )]


def ai_gap(rows: Sequence[Row]) -> list[dict[str, Any]]:
    """Top-10 organic, AI mention rate under 50%."""
    matches = [row for row in rows if row.get('quadrant') == AI_GAP]
    if not matches:
        return []
    return [_recommendation(
        'ai_gap', 'medium', 'Ranks on Google but AI answers rarely name you',
        f'On {_plural(len(matches))} you rank in Google\'s top {SEO_TOP_POSITION}, but fewer than half of the AI '
        'answers name your brand.',
        'Get your brand mentioned on the sources AI engines cite for these topics, and state plainly on your '
        'ranking pages what your brand offers.',
        matches,
    )]


def seo_gap(rows: Sequence[Row]) -> list[dict[str, Any]]:
    """AI answers name you, Google does not rank you in the top 10."""
    matches = [row for row in rows if row.get('quadrant') == SEO_GAP]
    if not matches:
        return []
    return [_recommendation(
        'seo_gap', 'medium', "AI knows you, Google doesn't rank you",
        f'On {_plural(len(matches))} at least half of the AI answers name your brand, but none of your pages is in '
        f'Google\'s top {SEO_TOP_POSITION}.',
        'Create or improve a page targeting each keyword: AI engines already associate your brand with it.',
        matches,
    )]


RULES: tuple[Callable[[Sequence[Row]], list[dict[str, Any]]], ...] = (aio_missing_you, aio_competitor_cited, ai_gap, seo_gap)


def seo_recommendations(rows: Sequence[Row]) -> list[dict[str, Any]]:
    """Every rule's recommendation over the SEO vs GEO rows, high priority first (rule order within one)."""
    recommendations = [recommendation for rule in RULES for recommendation in rule(rows)]
    return sorted(recommendations, key=lambda item: PRIORITY_ORDER[item['priority']])


__all__ = [
    'RULES',
    'ai_gap',
    'aio_competitor_cited',
    'aio_missing_you',
    'seo_gap',
    'seo_recommendations',
]
