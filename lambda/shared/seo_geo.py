"""
SEO vs GEO: organic Google standing against AI-answer visibility, per keyword and market.

The rules only (pure functions); ``lambda/seo/seo-geo.py`` loads the data. The
definitions (also in ``docs/seo-metrics.md``):

* the **run** of a keyword is its latest analysis run with a Google AI Overviews
  row (``google_ai_overview``, status ``success`` or ``no_answer``; an ``error``
  row carries no data) and every row stamped with that run's timestamp;
* ``organic_position`` is the best ``position`` of an owned domain
  (``first_party_domains``; the host itself or a subdomain, ``www.`` stripped,
  ``kpi_engine.matches_domain``) among the AI Overviews row's organic top 10
  (``search_results``); ``competitor_positions`` the same per competitor
  (``competitor_domains``; a competitor without domains is left out);
* ``ai_overview_shown`` is the AI Overviews row's status (``success`` → ``True``,
  ``no_answer`` → ``False``); ``ai_overview_cites_you`` whether an owned domain is
  among its references;
* ``ai_mention_rate`` / ``answers`` are ``kpi_engine.brand_kpis`` over that run's
  answers for the keyword (the ``mention_rate`` KPI, not a second formula);
* ``citation_overlap`` is the percentage of distinct URLs cited by the run's AI
  answers (the AI Overview's references included) that are also in its organic
  top 10;
* the **quadrant**: SEO strong = ``organic_position <= SEO_TOP_POSITION``, GEO
  strong = ``ai_mention_rate >= GEO_MENTION_RATE``; no AI Overviews row or no
  answer → ``no_data``;
* ``ai_overview_cited_competitors``: the competitors with a domain among the AI
  Overview's references, in name order;
* from ``OrganicSignals`` (sources other than that results page, see
  ``shared.seo_geo_traffic``): ``estimated_traffic`` (the owned domains'
  estimated monthly visits for the keyword in their latest domain snapshot),
  ``ranked_position`` (a tracked rank when one is given, else the snapshot's
  organic position, 1-100) and ``organic_position_source``: ``serp_top10``
  when ``organic_position`` is known, else where ``ranked_position`` came from
  (``rank_tracking`` / ``ranked_keywords``), else ``None``. The quadrant keeps
  reading ``organic_position`` only, so it always describes the same results
  page as the AI Overview.

Owned domains match like every other KPI (``kpi_engine.matches_domain``): the host or a
subdomain, with ``www.``, the port and edge dots stripped.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from shared.kpi_engine import answers_from_rows, brand_kpis, matches_domain, normalize_domain, percent
from shared.utils import normalize_url

#: Organic positions up to this one are "SEO strong" (Google's first page).
SEO_TOP_POSITION = 10

#: AI mention rates (percent) from this one up are "GEO strong".
GEO_MENTION_RATE = 50

#: The SearchResults provider id of the Google AI Overviews engine.
AIO_PROVIDER = 'google_ai_overview'

#: The AI Overviews row statuses that describe the results page (``error`` does not).
AIO_DATA_STATUSES = frozenset({'success', 'no_answer'})

BOTH_STRONG = 'both_strong'
AI_GAP = 'ai_gap'
SEO_GAP = 'seo_gap'
BOTH_WEAK = 'both_weak'
NO_DATA = 'no_data'
QUADRANTS: tuple[str, ...] = (BOTH_STRONG, AI_GAP, SEO_GAP, BOTH_WEAK, NO_DATA)

Row = Mapping[str, Any]


def thresholds() -> dict[str, int]:
    """The quadrant thresholds, as the API reports them."""
    return {'seo_top_position': SEO_TOP_POSITION, 'geo_mention_rate': GEO_MENTION_RATE}


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------

def is_aio_data_row(row: Row) -> bool:
    """Whether ``row`` is an AI Overviews row that describes the results page."""
    return row.get('provider') == AIO_PROVIDER and row.get('status') in AIO_DATA_STATUSES


def latest_aio_run(rows: Iterable[Row]) -> tuple[str | None, list[Row]]:
    """The timestamp of the newest run with an AI Overviews row, and every row of that run.

    ``(None, [])`` when no stored run has one.
    """
    pool = list(rows)
    stamps = [str(row.get('timestamp') or '') for row in pool if is_aio_data_row(row)]
    latest = max((stamp for stamp in stamps if stamp), default=None)
    if latest is None:
        return None, []
    return latest, [row for row in pool if row.get('timestamp') == latest]


def _aio_row(run: Sequence[Row]) -> Row | None:
    return next((row for row in run if is_aio_data_row(row)), None)


# ---------------------------------------------------------------------------
# Organic results
# ---------------------------------------------------------------------------

def _position(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        position = int(str(value))
    except (TypeError, ValueError):
        return None
    return position if position >= 1 else None


def organic_entries(search_results: object) -> list[tuple[int, str, str]]:
    """``(position, domain, url)`` of each usable organic result (a position and a host)."""
    values = search_results if isinstance(search_results, list) else []
    entries: list[tuple[int, str, str]] = []
    for value in values:
        if not isinstance(value, Mapping):
            continue
        url = value.get('url')
        url_text = url if isinstance(url, str) else ''
        domain = normalize_domain(value.get('domain')) or normalize_domain(url_text)
        position = _position(value.get('position'))
        if domain and position is not None:
            entries.append((position, domain, url_text))
    return entries


def best_position(entries: Sequence[tuple[int, str, str]], domains: Sequence[str]) -> int | None:
    """The best position of a result on one of ``domains`` (or a subdomain), ``None`` when none ranks."""
    if not domains:
        return None
    return min((position for position, domain, _url in entries if matches_domain(domain, domains)), default=None)


def _url_key(url: str) -> str | None:
    """A URL's identity for overlap matching: host (``normalize_domain``), path without a trailing ``/``, query.

    Tracking parameters are dropped (``normalize_url``); the scheme is ignored.
    """
    host = normalize_domain(url)
    if not host:
        return None
    parsed = urlsplit(normalize_url(url.strip()))
    query = f'?{parsed.query}' if parsed.query else ''
    return f'{host}{parsed.path.rstrip("/")}{query}'


def _url_keys(urls: Iterable[object]) -> set[str]:
    return {key for key in (_url_key(url) for url in urls if isinstance(url, str)) if key}


# ---------------------------------------------------------------------------
# One keyword
# ---------------------------------------------------------------------------

def _cited_urls(run: Sequence[Row], aio: Row) -> set[str]:
    """Distinct URLs cited by the run's answers and by the AI Overview."""
    cited = _url_keys(url for answer in answers_from_rows(run) for url in answer.cited_urls)
    citations = aio.get('citations')
    return cited | _url_keys(citations if isinstance(citations, list) else [])


def citation_overlap(run: Sequence[Row], aio: Row, entries: Sequence[tuple[int, str, str]]) -> float | None:
    """Percentage of the run's distinct cited URLs that are in the organic top 10; ``None`` without citations."""
    cited = _cited_urls(run, aio)
    organic = _url_keys(url for _position, _domain, url in entries)
    return percent(len(cited & organic), len(cited))


def _cited_hosts(aio: Row) -> list[str]:
    citations = aio.get('citations')
    hosts = (normalize_domain(url) for url in (citations if isinstance(citations, list) else []))
    return [host for host in hosts if host is not None]


def _cites_owned(aio: Row, owned_domains: Sequence[str]) -> bool | None:
    if not owned_domains:
        return None
    return any(matches_domain(host, owned_domains) for host in _cited_hosts(aio))


def cited_competitors(aio: Row, competitor_domains: Mapping[str, Sequence[str]]) -> list[str]:
    """The competitors with a domain (or a subdomain of one) among the AI Overview's references, in name order."""
    hosts = _cited_hosts(aio)
    return sorted(name for name, domains in competitor_domains.items() if any(matches_domain(host, domains) for host in hosts))


def quadrant(organic_position: int | None, mention_rate: float | None, *, has_aio: bool) -> str:
    """The SEO vs GEO quadrant; ``no_data`` without an AI Overviews row or without an answer (no rate)."""
    if not has_aio or mention_rate is None:
        return NO_DATA
    seo_strong = organic_position is not None and organic_position <= SEO_TOP_POSITION
    geo_strong = mention_rate >= GEO_MENTION_RATE
    if seo_strong:
        return BOTH_STRONG if geo_strong else AI_GAP
    return SEO_GAP if geo_strong else BOTH_WEAK


@dataclass(frozen=True)
class OrganicSignals:
    """What sources other than the AI Overviews results page say about the keyword's organic standing."""

    estimated_traffic: float | None = None
    """The owned domains' estimated monthly visits for the keyword (latest domain snapshots)."""
    snapshot_position: int | None = None
    """The owned domains' best organic position in those snapshots (1-100)."""
    tracked_position: int | None = None
    """A rank-tracked position, preferred over the snapshot's when given."""


def _organic_fields(organic_position: int | None, signals: OrganicSignals) -> dict[str, Any]:
    ranked, ranked_source = (
        (signals.tracked_position, 'rank_tracking') if signals.tracked_position is not None
        else (signals.snapshot_position, 'ranked_keywords')
    )
    if organic_position is not None:
        source: str | None = 'serp_top10'
    else:
        source = ranked_source if ranked is not None else None
    return {
        'estimated_traffic': signals.estimated_traffic,
        'ranked_position': ranked,
        'organic_position_source': source,
    }


def _empty_row(competitor_domains: Mapping[str, Sequence[str]]) -> dict[str, Any]:
    return {
        'organic_position': None,
        'competitor_positions': dict.fromkeys(competitor_domains),
        'ai_overview_shown': None,
        'ai_overview_cites_you': None,
        'ai_overview_cited_competitors': [],
        'ai_mention_rate': None,
        'answers': 0,
        'citation_overlap': None,
        'quadrant': NO_DATA,
        'last_run': None,
    }


def seo_geo_row(
    keyword: Row,
    run: Sequence[Row],
    *,
    owned_domains: Sequence[str],
    competitor_domains: Mapping[str, Sequence[str]],
    search_volume: int | None,
    signals: OrganicSignals | None = None,
) -> dict[str, Any]:
    """The API ``SeoGeoRow`` of one Keywords item from the rows of its run (``latest_aio_run``)."""
    identity = {
        'keyword_id': str(keyword.get('id') or ''),
        'keyword': str(keyword.get('keyword') or ''),
        'search_volume': search_volume,
    }
    organic_signals = signals or OrganicSignals()
    aio = _aio_row(run)
    if aio is None:
        return {**identity, **_empty_row(competitor_domains), **_organic_fields(None, organic_signals)}
    entries = organic_entries(aio.get('search_results'))
    kpis = brand_kpis(answers_from_rows(run))
    organic_position = best_position(entries, owned_domains)
    return {
        **identity,
        'organic_position': organic_position,
        **_organic_fields(organic_position, organic_signals),
        'competitor_positions': {
            name: best_position(entries, domains) for name, domains in competitor_domains.items()
        },
        'ai_overview_shown': aio.get('status') == 'success',
        'ai_overview_cites_you': _cites_owned(aio, owned_domains),
        'ai_overview_cited_competitors': cited_competitors(aio, competitor_domains),
        'ai_mention_rate': kpis['mention_rate'],
        'answers': kpis['answers'],
        'citation_overlap': citation_overlap(run, aio, entries),
        'quadrant': quadrant(organic_position, kpis['mention_rate'], has_aio=True),
        'last_run': str(aio.get('timestamp') or '') or None,
    }


# ---------------------------------------------------------------------------
# The table
# ---------------------------------------------------------------------------

def summarize(rows: Iterable[Row]) -> dict[str, int]:
    """Keywords per quadrant (every quadrant present, zero when empty)."""
    counts = dict.fromkeys(QUADRANTS, 0)
    for row in rows:
        counts[row['quadrant']] += 1
    return counts


def sort_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Largest search volume first (unknown volumes last), then keyword text."""
    def order(row: Row) -> tuple[bool, int, str]:
        volume = row.get('search_volume')
        known = isinstance(volume, int)
        return (not known, -volume if isinstance(volume, int) else 0, str(row.get('keyword') or '').casefold())

    return sorted(rows, key=order)


__all__ = [
    'AIO_PROVIDER',
    'AI_GAP',
    'GEO_MENTION_RATE',
    'QUADRANTS',
    'SEO_GAP',
    'SEO_TOP_POSITION',
    'OrganicSignals',
    'citation_overlap',
    'cited_competitors',
    'latest_aio_run',
    'quadrant',
    'seo_geo_row',
    'sort_rows',
    'summarize',
    'thresholds',
]
