"""
Who the AI engines cite: the citation facts of the Insights report.

Both facts count (answer, URL) pairs over ``kpi_engine.Answer.cited_urls``,
so a page cited twice in one answer counts once, as every citation KPI does:

* **citation ownership** — per AI engine, how many citations point at the
  brand's own domains, at each tracked competitor's domains
  (``competitor_domains`` of the brand configuration) and at everyone else.
* **owned pages** — the brand's most-cited URLs, grouped into sections by
  host and first path segment, with the documents (PDFs and other file
  downloads) told apart from web pages. The grouping knows no brand: a
  document is recognised from its path alone.

Pure functions, no I/O; ``shared.insights_engine`` assembles them with the
other facts.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from typing import Any
from urllib.parse import urlparse

from shared.kpi_engine import COMPETITOR, Answer, matches_domain, normalize_domain

#: Path suffixes of a file download rather than a web page.
DOCUMENT_SUFFIXES: tuple[str, ...] = ('.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx')
#: Path segments under which sites serve file downloads.
DOCUMENT_SEGMENTS = frozenset({'static-files', 'files', 'download', 'downloads', 'dam'})
#: How many of the most-cited owned URLs the owned-pages fact lists.
OWNED_PAGES_LIMIT = 25

OWNED = 'owned'
THIRD_PARTY = 'third_party'

CompetitorDomains = Mapping[str, Sequence[str]]
"""The domains of each tracked competitor, by competitor name (``competitor_domains_from``)."""


def competitor_domains_from(brand_config: Mapping[str, Any]) -> dict[str, list[str]]:
    """The domains of each tracked competitor (``competitor_domains``), normalised, by competitor name.

    A competitor without a usable domain is left out, so an empty result
    means no competitor domain is configured.
    """
    configured = brand_config.get('competitor_domains')
    if not isinstance(configured, Mapping):
        return {}
    domains_by_brand: dict[str, list[str]] = {}
    for brand, domains in configured.items():
        values = domains if isinstance(domains, (list, tuple, set)) else []
        normalized = sorted({domain for domain in map(normalize_domain, values) if domain})
        name = brand.strip() if isinstance(brand, str) else ''
        if name and normalized:
            domains_by_brand[name] = normalized
    return dict(sorted(domains_by_brand.items()))


def _by_engine(answers: Iterable[Answer]) -> dict[str, list[Answer]]:
    grouped: dict[str, list[Answer]] = defaultdict(list)
    for answer in answers:
        grouped[answer.provider].append(answer)
    return dict(sorted(grouped.items()))


def _host(url: str) -> str:
    """The host of a cited URL; ``cited_urls`` only holds URLs with one."""
    return normalize_domain(url) or ''


# ---------------------------------------------------------------------------
# Citation ownership
# ---------------------------------------------------------------------------

def _owner(domain: str, owned_domains: Sequence[str], competitor_domains: CompetitorDomains) -> tuple[str, str]:
    """``(owned, '')``, ``(competitor, its name)`` or ``(third_party, '')``; an owned domain wins over a competitor's."""
    if matches_domain(domain, owned_domains):
        return OWNED, ''
    brand = next((brand for brand, domains in competitor_domains.items() if matches_domain(domain, domains)), None)
    return (COMPETITOR, brand) if brand is not None else (THIRD_PARTY, '')


def _ownership_row(engine: str, answers: list[Answer], owned_domains: Sequence[str], competitor_domains: CompetitorDomains) -> dict[str, Any]:
    counts: dict[tuple[str, str], int] = defaultdict(int)
    for answer in answers:
        for url in answer.cited_urls:
            counts[_owner(_host(url), owned_domains, competitor_domains)] += 1
    return {
        'engine': engine,
        'answers': len(answers),
        'citations': sum(counts.values()),
        'owned': counts[OWNED, ''],
        'competitors': {brand: counts[COMPETITOR, brand] for brand in competitor_domains},
        'third_party': counts[THIRD_PARTY, ''],
    }


def citation_ownership_facts(
    answers: Iterable[Answer],
    owned_domains: Iterable[str] = (),
    competitor_domains: CompetitorDomains | None = None,
) -> dict[str, Any]:
    """Per AI engine (in name order), the (answer, URL) citations of the owned domains, each competitor and third parties.

    ``citations`` is their total, so ``owned + sum(competitors) + third_party``.
    Without competitor domains every non-owned citation is third party; the
    two flags say which of the split is measured.
    """
    owned = [domain for domain in owned_domains if normalize_domain(domain)]
    competitors = dict(competitor_domains or {})
    return {
        'owned_configured': bool(owned),
        'competitors_configured': bool(competitors),
        'engines': [_ownership_row(engine, rows, owned, competitors) for engine, rows in _by_engine(answers).items()],
    }


# ---------------------------------------------------------------------------
# Owned pages
# ---------------------------------------------------------------------------

def page_of(url: str) -> tuple[str, str, bool]:
    """``(page, section, is_document)`` of a cited URL.

    ``page`` is the host and path without scheme, query, fragment or trailing
    slash; ``section`` the host and first path segment; a document ends in a
    file suffix (``DOCUMENT_SUFFIXES``) or sits under a download segment
    (``DOCUMENT_SEGMENTS``).
    """
    host = _host(url)
    text = url.strip()
    try:
        path = urlparse(text if '//' in text else f'//{text}').path
    except ValueError:
        path = ''
    segments = [segment for segment in path.split('/') if segment]
    lowered = [segment.lower() for segment in segments]
    is_document = (bool(lowered) and lowered[-1].endswith(DOCUMENT_SUFFIXES)) or any(segment in DOCUMENT_SEGMENTS for segment in lowered)
    page = '/'.join([host, *segments])
    section = f'{host}/{segments[0]}' if segments else host
    return page, section, is_document


def _owned_citations(answers: Iterable[Answer], owned_domains: Sequence[str]) -> list[tuple[Answer, str, str, bool]]:
    """Every (answer, owned page) pair once, with the page's section and kind."""
    pairs: list[tuple[Answer, str, str, bool]] = []
    for answer in answers:
        pages = {page_of(url) for url in answer.cited_urls if matches_domain(_host(url), owned_domains)}
        pairs.extend((answer, page, section, is_document) for page, section, is_document in sorted(pages))
    return pairs


def _page_rows(pairs: list[tuple[Answer, str, str, bool]]) -> list[dict[str, Any]]:
    citing: dict[str, list[Answer]] = defaultdict(list)
    kinds: dict[str, tuple[str, bool]] = {}
    for answer, page, section, is_document in pairs:
        citing[page].append(answer)
        kinds[page] = (section, is_document)
    rows = [
        {
            'url': page,
            'section': kinds[page][0],
            'is_document': kinds[page][1],
            'citations': len(answers),
            'engines': sorted({answer.provider for answer in answers}),
        }
        for page, answers in citing.items()
    ]
    rows.sort(key=lambda row: (-row['citations'], row['url']))
    return rows


def _section_rows(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, Any]] = {}
    for page in pages:
        section = totals.setdefault(page['section'], {'section': page['section'], 'citations': 0, 'document_citations': 0, 'pages': 0})
        section['citations'] += page['citations']
        section['document_citations'] += page['citations'] if page['is_document'] else 0
        section['pages'] += 1
    return sorted(totals.values(), key=lambda row: (-row['citations'], row['section']))


def _split(pairs: Iterable[tuple[Answer, str, str, bool]]) -> dict[str, int]:
    kinds = [is_document for _answer, _page, _section, is_document in pairs]
    return {'document_citations': sum(kinds), 'page_citations': len(kinds) - sum(kinds)}


def owned_pages_facts(answers: Iterable[Answer], owned_domains: Iterable[str] = ()) -> dict[str, Any]:
    """The brand's most-cited owned pages, their sections, and documents against web pages per AI engine.

    ``pages`` holds the ``OWNED_PAGES_LIMIT`` most-cited pages (citations =
    answers citing the page), ``sections`` every section's totals over all
    owned pages, ``engines`` each engine citing an owned page with its
    document and web-page citations, and the two totals cover every engine.
    Empty without owned domains.
    """
    owned = [domain for domain in owned_domains if normalize_domain(domain)]
    pairs = _owned_citations(answers, owned) if owned else []
    pages = _page_rows(pairs)
    by_engine: dict[str, list[tuple[Answer, str, str, bool]]] = defaultdict(list)
    for pair in pairs:
        by_engine[pair[0].provider].append(pair)
    return {
        'pages': pages[:OWNED_PAGES_LIMIT],
        'pages_omitted': max(len(pages) - OWNED_PAGES_LIMIT, 0),
        'sections': _section_rows(pages),
        'engines': [{'engine': engine, **_split(by_engine[engine])} for engine in sorted(by_engine)],
        **_split(pairs),
    }


__all__ = [
    'DOCUMENT_SEGMENTS',
    'DOCUMENT_SUFFIXES',
    'OWNED_PAGES_LIMIT',
    'CompetitorDomains',
    'citation_ownership_facts',
    'competitor_domains_from',
    'owned_pages_facts',
    'page_of',
]
