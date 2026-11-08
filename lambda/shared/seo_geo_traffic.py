"""SEO vs GEO with estimated search traffic: the domain snapshots set beside the AI answers (pure rules).

The rows of ``shared.seo_geo`` gain the organic signals of the latest domain snapshots
(``shared.domain_snapshots``) of the market, and the scope gains a comparison of the **share of estimated
search traffic** against the **share of AI mentions**:

* per keyword, the owned domains' snapshot traffic and position: the snapshots of every owned domain
  merged (best position, summed estimated visits; a domain already covered by another as its subdomain
  is never snapshotted twice, ``distinct_domains``);
* ``rank_positions`` (keyword id -> tracked position) is an optional, better source for the position: a
  tracked rank is checked more often and deeper than a snapshot's;
* ``traffic_comparison``: for you and each competitor with domains, the estimated visits summed over the
  scope's keywords and their share of the total across you and the competitors (``traffic_share``), next
  to the ``share_of_voice`` KPI over the same runs' answers (``kpi_engine``: your brands together, or one
  competitor's row of ``brand_table``). Anyone without a snapshot has ``None`` traffic and share, so a
  missing snapshot never reads as zero traffic. Estimated traffic is DataForSEO's model, never clicks.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from shared.brand_names import COMPETITOR, normalize_brand_key
from shared.domain_snapshots import KeywordTraffic
from shared.kpi_engine import answers_from_rows, brand_kpis, brand_table
from shared.seo_geo import OrganicSignals, seo_geo_row, sort_rows
from shared.utils import normalize_keyword

Row = Mapping[str, Any]

#: The ``name`` of your entry in ``traffic_comparison``.
OWNED_ENTRY_NAME = 'You'


@dataclass(frozen=True)
class SearchTraffic:
    """The latest snapshots' keywords of a market, by ``normalize_keyword`` text."""

    owned: Mapping[str, KeywordTraffic] | None = None
    """Every owned domain's snapshots merged; ``None`` when none of them has a snapshot."""
    competitors: Mapping[str, Mapping[str, KeywordTraffic]] = field(default_factory=dict)
    """Per competitor name, its domains' snapshots merged; a competitor without a snapshot is absent."""


def merge_traffic(maps: Iterable[Mapping[str, KeywordTraffic]]) -> dict[str, KeywordTraffic]:
    """Several domains' keywords as one: the best position and the summed estimated visits per keyword."""
    merged: dict[str, KeywordTraffic] = {}
    for traffic in maps:
        for keyword, (position, etv) in traffic.items():
            known_position, known_etv = merged.get(keyword, (None, None))
            positions = [value for value in (known_position, position) if value is not None]
            visits = [value for value in (known_etv, etv) if value is not None]
            merged[keyword] = (min(positions) if positions else None, sum(visits) if visits else None)
    return merged


def organic_signals(
    keyword: Row, traffic: SearchTraffic | None, rank_positions: Mapping[str, int | None] | None,
) -> OrganicSignals:
    """The organic signals of one Keywords item."""
    text = keyword.get('keyword')
    key = normalize_keyword(text) if isinstance(text, str) else ''
    owned = traffic.owned if traffic is not None else None
    position, etv = owned.get(key, (None, None)) if owned is not None else (None, None)
    tracked = (rank_positions or {}).get(str(keyword.get('id') or ''))
    return OrganicSignals(estimated_traffic=etv, snapshot_position=position, tracked_position=tracked)


def seo_geo_rows(
    keywords: Sequence[Row],
    runs: Sequence[Sequence[Row]],
    *,
    owned_domains: Sequence[str],
    competitor_domains: Mapping[str, Sequence[str]],
    volumes: Mapping[str, int | None],
    traffic: SearchTraffic | None = None,
    rank_positions: Mapping[str, int | None] | None = None,
) -> list[dict[str, Any]]:
    """Every keyword's ``SeoGeoRow`` (``runs[i]`` is ``keywords[i]``'s run), largest search volume first."""
    return sort_rows(
        seo_geo_row(
            keyword, run, owned_domains=owned_domains, competitor_domains=competitor_domains,
            search_volume=volumes.get(str(keyword.get('id') or '')),
            signals=organic_signals(keyword, traffic, rank_positions),
        )
        for keyword, run in zip(keywords, runs, strict=True)
    )


def _scope_traffic(traffic: Mapping[str, KeywordTraffic] | None, keys: set[str]) -> float | None:
    if traffic is None:
        return None
    return round(sum(etv for key in keys if (etv := traffic.get(key, (None, None))[1]) is not None), 1)


def _share(value: float | None, total: float) -> float | None:
    return round(value / total * 100, 1) if value is not None and total > 0 else None


def _competitor_voice(answers: Sequence[Any]) -> dict[str, float | None]:
    return {
        normalize_brand_key(row['name']): row['share_of_voice']
        for row in brand_table(answers) if row['classification'] == COMPETITOR
    }


def traffic_comparison(
    keywords: Sequence[Row],
    runs: Sequence[Sequence[Row]],
    traffic: SearchTraffic,
    competitor_names: Sequence[str],
) -> list[dict[str, Any]]:
    """You, then each competitor in ``competitor_names`` order: estimated traffic and its share against AI share of voice."""
    keys = {normalize_keyword(str(item.get('keyword') or '')) for item in keywords} - {''}
    answers = answers_from_rows(row for run in runs for row in run)
    owned_voice = brand_kpis(answers)['share_of_voice']
    voices = _competitor_voice(answers)
    no_voice = None if owned_voice is None else 0.0
    entries = [
        (OWNED_ENTRY_NAME, True, _scope_traffic(traffic.owned, keys), owned_voice),
        *(
            (name, False, _scope_traffic(traffic.competitors.get(name), keys), voices.get(normalize_brand_key(name), no_voice))
            for name in competitor_names
        ),
    ]
    total = sum(value for _name, _owned, value, _voice in entries if value is not None)
    return [
        {
            'name': name,
            'owned': owned,
            'estimated_traffic': value,
            'traffic_share': _share(value, total),
            'share_of_voice': voice,
        }
        for name, owned, value, voice in entries
    ]


__all__ = [
    'OWNED_ENTRY_NAME',
    'SearchTraffic',
    'merge_traffic',
    'organic_signals',
    'seo_geo_rows',
    'traffic_comparison',
]
