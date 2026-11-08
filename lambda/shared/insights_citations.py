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

Each fact is counted per keyword (``*_partial``), summed over a scope
(``merge_*``) and shaped (``*_from``), so a scope snapshot and a live request
compute it the same way. Pure functions, no I/O; ``shared.insights_engine``
assembles them with the other facts.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any
from urllib.parse import urlparse

from shared.kpi_engine import COMPETITOR, Answer, matches_domain, normalize_domain

#: Path suffixes of a file download rather than a web page.
DOCUMENT_SUFFIXES: tuple[str, ...] = ('.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx')
#: Path segments under which sites serve file downloads.
DOCUMENT_SEGMENTS = frozenset({'static-files', 'files', 'download', 'downloads', 'dam'})
#: How many of the most-cited owned URLs an answer's owned-pages fact lists first (``shared.insights_pages``).
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


def ownership_partial(answers: Iterable[Answer], owned_domains: Sequence[str], competitor_domains: CompetitorDomains) -> dict[str, dict[str, Any]]:
    """Per AI engine of one keyword's answers: answers, and the (answer, URL) citations of the owned domains, each competitor and third parties."""
    rows: dict[str, dict[str, Any]] = {}
    for answer in answers:
        row = rows.setdefault(answer.provider, {'answers': 0, 'owned': 0, 'third_party': 0, 'competitors': {}})
        row['answers'] += 1
        for url in answer.cited_urls:
            owner, brand = _owner(_host(url), owned_domains, competitor_domains)
            if owner == COMPETITOR:
                row['competitors'][brand] = row['competitors'].get(brand, 0) + 1
            else:
                row[owner] += 1
    return rows


def merge_ownership(acc: dict[str, dict[str, Any]], part: Mapping[str, Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """``acc`` with ``part``'s counts added (``ownership_partial`` shapes); ``part`` is left as it is."""
    for engine, counts in part.items():
        row = acc.setdefault(engine, {'answers': 0, 'owned': 0, 'third_party': 0, 'competitors': {}})
        for key in ('answers', 'owned', 'third_party'):
            row[key] += int(counts[key])
        for brand, cited in counts['competitors'].items():
            row['competitors'][brand] = row['competitors'].get(brand, 0) + int(cited)
    return acc


def citation_ownership_from(
    ownership: Mapping[str, Mapping[str, Any]], owned_configured: bool, competitor_domains: CompetitorDomains | None = None,
) -> dict[str, Any]:
    """The citation-ownership fact of a scope's merged ``ownership_partial`` counts.

    Per AI engine (in name order), the (answer, URL) citations of the owned
    domains, each competitor and third parties; ``citations`` is their total,
    so ``owned + sum(competitors) + third_party``. Without competitor domains
    every non-owned citation is third party; the two flags say which of the
    split is measured.
    """
    competitors = dict(competitor_domains or {})
    engines = []
    for engine in sorted(ownership):
        row = ownership[engine]
        by_brand = {brand: int(row['competitors'].get(brand, 0)) for brand in competitors}
        engines.append({
            'engine': engine,
            'answers': int(row['answers']),
            'citations': int(row['owned']) + int(row['third_party']) + sum(by_brand.values()),
            'owned': int(row['owned']),
            'competitors': by_brand,
            'third_party': int(row['third_party']),
        })
    return {'owned_configured': owned_configured, 'competitors_configured': bool(competitors), 'engines': engines}


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


def owned_pages_partial(answers: Iterable[Answer], owned_domains: Sequence[str]) -> dict[str, Any]:
    """One keyword's owned pages: per page its section, kind, citing answers and engines; per engine its document and page citations.

    Every (answer, owned page) pair counts once. Empty without owned domains.
    """
    pages: dict[str, dict[str, Any]] = {}
    engines: dict[str, list[int]] = {}
    if not owned_domains:
        return {'pages': pages, 'engines': engines}
    for answer in answers:
        cited = {page_of(url) for url in answer.cited_urls if matches_domain(_host(url), owned_domains)}
        for page, section, is_document in sorted(cited):
            row = pages.setdefault(page, {'section': section, 'is_document': is_document, 'citations': 0, 'engines': []})
            row['citations'] += 1
            if answer.provider not in row['engines']:
                row['engines'] = sorted([*row['engines'], answer.provider])
            split = engines.setdefault(answer.provider, [0, 0])
            split[0 if is_document else 1] += 1
    return {'pages': pages, 'engines': engines}


def merge_owned_pages(acc: dict[str, Any], part: Mapping[str, Any]) -> dict[str, Any]:
    """``acc`` with ``part``'s pages and engine counts added (``owned_pages_partial`` shapes); ``part`` is left as it is."""
    for page, counted in part['pages'].items():
        row = acc['pages'].get(page)
        if row is None:
            acc['pages'][page] = {**counted, 'engines': list(counted['engines'])}
            continue
        row['citations'] += int(counted['citations'])
        row['engines'] = sorted({*row['engines'], *counted['engines']})
    for engine, (documents, web_pages) in part['engines'].items():
        split = acc['engines'].setdefault(engine, [0, 0])
        split[0] += int(documents)
        split[1] += int(web_pages)
    return acc


def _section_rows(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, Any]] = {}
    for page in pages:
        section = totals.setdefault(page['section'], {'section': page['section'], 'citations': 0, 'document_citations': 0, 'pages': 0})
        section['citations'] += page['citations']
        section['document_citations'] += page['citations'] if page['is_document'] else 0
        section['pages'] += 1
    return sorted(totals.values(), key=lambda row: (-row['citations'], row['section']))


def _split(documents: int, web_pages: int) -> dict[str, int]:
    return {'document_citations': documents, 'page_citations': web_pages}


def owned_pages_from(owned: Mapping[str, Any]) -> dict[str, Any]:
    """The owned-pages fact of a scope's merged ``owned_pages_partial``.

    ``pages`` holds every owned page, most cited first (citations = answers
    citing the page; an answer lists the first ``OWNED_PAGES_LIMIT``,
    ``shared.insights_pages``), ``sections`` every section's totals over all
    owned pages, ``engines`` each engine citing an owned page with its
    document and web-page citations, and the two totals cover every engine.
    """
    pages = [
        {'url': page, 'section': row['section'], 'is_document': bool(row['is_document']), 'citations': int(row['citations']), 'engines': list(row['engines'])}
        for page, row in owned['pages'].items()
    ]
    pages.sort(key=lambda row: (-row['citations'], row['url']))
    engines = owned['engines']
    return {
        'pages': pages,
        'sections': _section_rows(pages),
        'engines': [{'engine': engine, **_split(int(engines[engine][0]), int(engines[engine][1]))} for engine in sorted(engines)],
        **_split(sum(int(split[0]) for split in engines.values()), sum(int(split[1]) for split in engines.values())),
    }


__all__ = [
    'DOCUMENT_SEGMENTS',
    'DOCUMENT_SUFFIXES',
    'OWNED_PAGES_LIMIT',
    'CompetitorDomains',
    'citation_ownership_from',
    'competitor_domains_from',
    'merge_owned_pages',
    'merge_ownership',
    'owned_pages_from',
    'owned_pages_partial',
    'ownership_partial',
    'page_of',
]
