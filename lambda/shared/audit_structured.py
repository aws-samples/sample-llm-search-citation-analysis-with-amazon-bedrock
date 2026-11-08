"""
JSON-LD structured data of a page: the schema.org types it declares and what is wrong with it.

Every JSON-LD block is parsed on its own; a top-level array and an ``@graph`` array are flattened into their
objects. A type is the last segment of ``@type`` (``schema:Organization`` and ``https://schema.org/Organization``
both read ``Organization``); ``@type`` may be a string or an array. Errors (``structured-data-invalid``): a
block that is not valid JSON, or an object (other than an ``@graph`` wrapper) without ``@type``; the message is
cut to 100 characters.

``Organization`` counts with its common subtypes (``Corporation``, ``LocalBusiness`` and its families...), and
``Article`` with its subtypes (``BlogPosting``, ``NewsArticle``...): answer engines read the subtype as the
parent type.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Any

MAX_ERROR_CHARS = 100

ORGANIZATION_TYPES = frozenset({
    'Organization', 'Corporation', 'LocalBusiness', 'OnlineBusiness', 'OnlineStore', 'NGO', 'Airline',
    'EducationalOrganization', 'GovernmentOrganization', 'MedicalOrganization', 'NewsMediaOrganization',
    'SportsOrganization', 'ResearchOrganization', 'PerformingGroup', 'Consortium', 'Store', 'Restaurant',
    'Hotel', 'LodgingBusiness', 'FoodEstablishment', 'ProfessionalService', 'FinancialService', 'LegalService',
    'TravelAgency', 'RealEstateAgent', 'AutomotiveBusiness', 'HealthAndBeautyBusiness',
    'HomeAndConstructionBusiness', 'EntertainmentBusiness', 'SportsActivityLocation',
})
SITE_TYPES = frozenset({'WebSite'})
ARTICLE_TYPES = frozenset({
    'Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'ScholarlyArticle', 'Report', 'LiveBlogPosting',
    'SocialMediaPosting', 'OpinionNewsArticle', 'ReportageNewsArticle', 'AnalysisNewsArticle',
    'BackgroundNewsArticle', 'ReviewNewsArticle',
})


@dataclass(frozen=True)
class StructuredData:
    types: tuple[str, ...]
    """Every schema.org type declared, sorted, once each."""
    errors: tuple[tuple[int, str], ...]
    """``(block_index, message)`` of every block that is invalid."""
    organizations_with_same_as: int
    organizations: int
    faq_question_counts: tuple[int, ...]

    @property
    def has_article(self) -> bool:
        return any(kind in ARTICLE_TYPES for kind in self.types)


def _short_type(value: str) -> str:
    return value.rstrip('/').rsplit('/', 1)[-1].rsplit(':', 1)[-1].strip()


def object_types(item: dict[str, Any]) -> tuple[str, ...]:
    raw = item.get('@type')
    values = raw if isinstance(raw, list) else [raw]
    return tuple(_short_type(value) for value in values if isinstance(value, str) and value.strip())


def _objects(document: Any) -> Iterator[dict[str, Any]]:
    items = document if isinstance(document, list) else [document]
    for item in items:
        if not isinstance(item, dict):
            continue
        graph = item.get('@graph')
        if isinstance(graph, list):
            yield from (node for node in graph if isinstance(node, dict))
            if '@type' not in item:
                continue
        yield item


def _has_same_as(item: dict[str, Any]) -> bool:
    raw = item.get('sameAs')
    values = raw if isinstance(raw, list) else [raw]
    return any(isinstance(value, str) and value.strip().lower().startswith(('http://', 'https://')) for value in values)


def _question_count(item: dict[str, Any]) -> int:
    raw = item.get('mainEntity')
    entries = raw if isinstance(raw, list) else [raw]
    return sum(1 for entry in entries if isinstance(entry, dict) and 'Question' in object_types(entry))


@dataclass
class _Tally:
    types: set[str]
    errors: list[tuple[int, str]]
    organizations: int = 0
    with_same_as: int = 0

    def add_object(self, index: int, item: dict[str, Any], faq_counts: list[int]) -> None:
        kinds = object_types(item)
        if not kinds:
            self.errors.append((index, 'An object has no @type'))
            return
        self.types.update(kinds)
        if any(kind in ORGANIZATION_TYPES for kind in kinds):
            self.organizations += 1
            self.with_same_as += int(_has_same_as(item))
        if 'FAQPage' in kinds:
            faq_counts.append(_question_count(item))


def read_json_ld(blocks: Iterable[str]) -> StructuredData:
    """The types, errors, organizations and FAQ question counts of a page's JSON-LD blocks."""
    tally = _Tally(types=set(), errors=[])
    faq_counts: list[int] = []
    for index, block in enumerate(blocks):
        try:
            document = json.loads(block)
        except json.JSONDecodeError as error:
            tally.errors.append((index, f'Invalid JSON: {error.msg}'[:MAX_ERROR_CHARS]))
            continue
        for item in _objects(document):
            tally.add_object(index, item, faq_counts)
    return StructuredData(
        types=tuple(sorted(tally.types)),
        errors=tuple(tally.errors),
        organizations_with_same_as=tally.with_same_as,
        organizations=tally.organizations,
        faq_question_counts=tuple(faq_counts),
    )
