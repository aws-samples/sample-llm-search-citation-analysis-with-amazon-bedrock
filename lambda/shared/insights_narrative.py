"""
The written narrative of a keyword group's run: its language, its validation
and its storage in ``CitationAnalysis-ReportInsights``.

After each run the GenerateInsights step (``lambda/report-insights``) asks
Bedrock to write up to ``MAX_NARRATIVE_INSIGHTS`` insights and
``MAX_NARRATIVE_RECOMMENDATIONS`` recommendations for every group the run
fully covers, from the group's computed insights (``shared.insights_engine``)
and KPIs only. Nothing the model writes is trusted:

* **ids** — every item must cite at least one insight, and every id it cites
  must be one of the computed insights;
* **numbers** — every number in an item (integers, decimals, percentages;
  four-digit years and the ``top-1`` / ``top-3`` KPI names aside) must equal,
  rounded to the precision written, a number in the evidence of the insights
  it cites or in the group's KPIs.

An item failing either check is dropped and counted. The surviving narrative
is stored per group and run (PK ``scope_key`` = ``group#<id>``, SK
``run_timestamp``, TTL as the KPI snapshots), so reading a report never calls
Bedrock: ``load_narrative`` reads it back for the scope's latest run.

The narrative is written in the group's keyword language
(``keyword_language``): the language most of its keywords are written in,
English when they are mixed or none can be told. The languages in play are
Spanish, Portuguese, English, French and German; for short search keywords a
word and letter vote over those five is more reliable (and deterministic)
than a general-purpose statistical detector, so no dependency is added.
"""

from __future__ import annotations

import logging
import os
import re
from collections import Counter
from collections.abc import Iterable, Mapping
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

from shared.dynamo_decimal import to_int
from shared.kpi_alerts import ttl_for_timestamp
from shared.utils import get_dynamodb_resource

logger = logging.getLogger(__name__)

#: The most insights and recommendations a narrative keeps.
MAX_NARRATIVE_INSIGHTS = 3
MAX_NARRATIVE_RECOMMENDATIONS = 6
#: The longest item text and recommendation title kept; a longer one is dropped.
MAX_ITEM_TEXT_LENGTH = 1500
MAX_TITLE_LENGTH = 200

#: The narrative's sections, each with the most items it keeps and whether its items carry a title.
NARRATIVE_SECTIONS: tuple[tuple[str, int, bool], ...] = (
    ('insights', MAX_NARRATIVE_INSIGHTS, False),
    ('recommendations', MAX_NARRATIVE_RECOMMENDATIONS, True),
)

GROUP_SCOPE_PREFIX = 'group#'

# ---------------------------------------------------------------------------
# Keyword language
# ---------------------------------------------------------------------------

DEFAULT_LANGUAGE = 'en'
#: The languages a narrative can be written in, by ISO 639-1 code, with the name the prompt uses.
LANGUAGE_NAMES: dict[str, str] = {
    'en': 'English',
    'es': 'Spanish',
    'pt': 'Portuguese',
    'fr': 'French',
    'de': 'German',
}

#: Function words and common search words of each language; a word in several languages votes for each.
_LANGUAGE_WORDS: dict[str, frozenset[str]] = {
    'en': frozenset(['the', 'and', 'of', 'for', 'to', 'in', 'with', 'best', 'cheap', 'cheapest', 'how', 'what', 'where', 'which', 'near', 'from', 'is', 'are', 'my', 'your', 'price', 'prices', 'flights', 'flight', 'reviews', 'book', 'booking', 'deals', 'vs', 'or', 'on', 'at', 'luggage', 'baggage', 'points', 'stars', 'miles']),
    'es': frozenset(['el', 'la', 'los', 'las', 'de', 'del', 'en', 'con', 'para', 'por', 'y', 'que', 'qué', 'un', 'una', 'mejor', 'mejores', 'barato', 'baratos', 'barata', 'baratas', 'precio', 'precios', 'cómo', 'como', 'dónde', 'donde', 'cuál', 'cuánto', 'vuelos', 'vuelo', 'desde', 'hasta', 'al', 'más', 'reservar', 'opiniones', 'viaje', 'viajes', 'ofertas', 'tarifas', 'equipaje', 'o', 'puntos', 'estrellas', 'millas']),
    'pt': frozenset(['o', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'com', 'para', 'por', 'e', 'que', 'um', 'uma', 'melhor', 'melhores', 'barato', 'baratos', 'barata', 'baratas', 'preço', 'preços', 'como', 'onde', 'qual', 'quanto', 'voo', 'voos', 'passagem', 'passagens', 'desde', 'até', 'ao', 'mais', 'reservar', 'viagem', 'viagens', 'ofertas', 'tarifas', 'bagagem', 'ou', 'pontos', 'estrelas', 'milhas']),
    'fr': frozenset(['le', 'la', 'les', 'de', 'des', 'du', 'en', 'avec', 'pour', 'par', 'et', 'que', 'un', 'une', 'meilleur', 'meilleurs', 'meilleure', 'pas', 'cher', 'prix', 'comment', 'où', 'quel', 'quelle', 'vol', 'vols', 'depuis', 'au', 'aux', 'plus', 'réserver', 'avis', 'voyage', 'voyages', 'offres', 'bagages', 'ou', 'points', 'étoiles']),
    'de': frozenset(['der', 'die', 'das', 'den', 'dem', 'des', 'und', 'mit', 'für', 'von', 'zu', 'zum', 'zur', 'im', 'in', 'ein', 'eine', 'beste', 'besten', 'günstig', 'günstige', 'billig', 'preis', 'preise', 'wie', 'wo', 'welche', 'flug', 'flüge', 'ab', 'nach', 'bis', 'mehr', 'buchen', 'bewertungen', 'reise', 'reisen', 'angebote', 'gepäck', 'oder', 'punkte', 'sterne', 'meilen']),
}

#: Letters that only some of the languages write; each distinct one votes for each of its languages.
_LANGUAGE_LETTERS: dict[str, tuple[str, ...]] = {
    'ñ': ('es',), '¿': ('es',), '¡': ('es',),
    'ã': ('pt',), 'õ': ('pt',),
    'è': ('fr',), 'ù': ('fr',), 'û': ('fr',), 'œ': ('fr',), 'ë': ('fr',), 'ï': ('fr',), 'î': ('fr',),
    'ä': ('de',), 'ö': ('de',), 'ü': ('de',), 'ß': ('de',),
    'ç': ('pt', 'fr'), 'â': ('pt', 'fr'), 'ê': ('pt', 'fr'), 'ô': ('pt', 'fr'), 'à': ('pt', 'fr'),
    'á': ('es', 'pt'), 'í': ('es', 'pt'), 'ó': ('es', 'pt'), 'ú': ('es', 'pt'),
    'é': ('es', 'pt', 'fr'),
}

#: Word endings only one of the languages writes.
_LANGUAGE_SUFFIXES: dict[str, str] = {
    'ción': 'es', 'ciones': 'es',
    'ção': 'pt', 'ções': 'pt',
    'ung': 'de', 'ungen': 'de', 'keit': 'de', 'heit': 'de',
    'eux': 'fr', 'euse': 'fr',
}

_WORD = re.compile(r"[^\W\d_]+")


def _language_scores(keyword: str) -> Counter[str]:
    text = keyword.casefold()
    scores: Counter[str] = Counter()
    for word in _WORD.findall(text):
        scores.update(language for language, words in _LANGUAGE_WORDS.items() if word in words)
        scores.update(language for suffix, language in _LANGUAGE_SUFFIXES.items() if word.endswith(suffix))
    for letter in set(text):
        scores.update(_LANGUAGE_LETTERS.get(letter, ()))
    return scores


def detect_language(keyword: str) -> str | None:
    """The language ``keyword`` is written in, or ``None`` when no single language scores highest."""
    ranked = _language_scores(keyword).most_common(2)
    if not ranked or (len(ranked) == 2 and ranked[0][1] == ranked[1][1]):
        return None
    return ranked[0][0]


def keyword_language(keywords: Iterable[str]) -> str:
    """The language most of ``keywords`` are written in; English when they are mixed or none can be told.

    Only the keywords whose language can be told vote (a brand name or a
    place name says nothing), and the winner needs more than half of their
    votes.
    """
    votes = Counter(language for keyword in keywords if (language := detect_language(keyword)) is not None)
    if not votes:
        return DEFAULT_LANGUAGE
    language, count = votes.most_common(1)[0]
    return language if count * 2 > sum(votes.values()) else DEFAULT_LANGUAGE


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

_NUMBER = re.compile(r'\d+(?:[.,]\d+)?')
#: KPI names that carry a digit: ``top-1 share``, ``top 3 share``. They name a KPI, they state no number.
_KPI_NAME_DIGITS = re.compile(r'\btop[-\s]?[13]\b', re.IGNORECASE)
_YEARS = range(1900, 2101)


def _is_year(token: str) -> bool:
    return len(token) == 4 and token.isdigit() and int(token) in _YEARS


def written_numbers(text: str) -> list[str]:
    """Every number ``text`` states, as written: years and the KPI names' digits left out."""
    return [token for token in _NUMBER.findall(_KPI_NAME_DIGITS.sub(' ', text)) if not _is_year(token)]


def _readings(token: str) -> list[tuple[float, int]]:
    """The ``(value, decimals)`` a written number can mean: a decimal point or comma, or a thousands separator."""
    whole, separator, fraction = token.replace(',', '.').partition('.')
    if not separator:
        return [(float(whole), 0)]
    readings = [(float(f'{whole}.{fraction}'), len(fraction))]
    if len(fraction) == 3:
        readings.append((float(whole + fraction), 0))
    return readings


def _numbers_in(values: Iterable[Any]) -> set[float]:
    """The absolute value of every number in ``values``, and of every number written in their strings."""
    numbers: set[float] = set()
    for value in values:
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, int | float):
            numbers.add(abs(float(value)))
        elif isinstance(value, str):
            numbers.update(reading for token in written_numbers(value) for reading, _decimals in _readings(token))
    return numbers


def _rounded(value: float, decimals: int) -> Decimal:
    """``value`` rounded half up to ``decimals`` places, as a reader rounds it (``round`` rounds half to even)."""
    return Decimal(str(value)).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)


def _stated(token: str, allowed: set[float]) -> bool:
    return any(
        _rounded(source, decimals) == Decimal(str(value))
        for value, decimals in _readings(token)
        for source in allowed
    )


def _bounded_text(value: Any, max_length: int) -> str | None:
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        return None
    return value.strip()


def _cited_ids(value: Any, known: Mapping[str, Mapping[str, Any]]) -> list[str] | None:
    if not isinstance(value, list) or not value or not all(isinstance(entry, str) and entry in known for entry in value):
        return None
    return list(dict.fromkeys(value))


def _valid_item(
    item: Any,
    known: Mapping[str, Mapping[str, Any]],
    kpi_numbers: set[float],
    titled: bool,
) -> dict[str, Any] | None:
    """``item`` cleaned to its fields, or ``None`` when it must be dropped."""
    if not isinstance(item, Mapping):
        return None
    text = _bounded_text(item.get('text'), MAX_ITEM_TEXT_LENGTH)
    title = _bounded_text(item.get('title'), MAX_TITLE_LENGTH) if titled else ''
    ids = _cited_ids(item.get('insight_ids'), known)
    if text is None or title is None or ids is None:
        return None
    allowed = kpi_numbers | _numbers_in(
        value for insight_id in ids for value in (known[insight_id].get('subject'), *known[insight_id]['evidence'].values())
    )
    if not all(_stated(token, allowed) for token in written_numbers(f'{title} {text}')):
        return None
    return {'title': title, 'text': text, 'insight_ids': ids} if titled else {'text': text, 'insight_ids': ids}


def validate_narrative(
    narrative: Any,
    insights: Iterable[Mapping[str, Any]],
    kpis: Mapping[str, Any],
) -> tuple[dict[str, list[dict[str, Any]]], int]:
    """The items of a model's ``narrative`` that rest on ``insights`` and ``kpis``, and how many were dropped.

    ``narrative`` is the model's parsed JSON: ``insights`` (``text``,
    ``insight_ids``) and ``recommendations`` (``title``, ``text``,
    ``insight_ids``). An item is dropped when it is malformed, cites an id
    that is not one of ``insights`` or states a number that is in neither
    the evidence of the insights it cites nor ``kpis``; items past a
    section's limit are dropped too. A section that is missing is empty.
    """
    known = {str(insight['id']): insight for insight in insights}
    kpi_numbers = _numbers_in(kpis.values())
    source = narrative if isinstance(narrative, Mapping) else {}
    kept: dict[str, list[dict[str, Any]]] = {}
    dropped = 0
    for section, limit, titled in NARRATIVE_SECTIONS:
        raw = source.get(section)
        valid = [
            clean for item in (raw if isinstance(raw, list) else [])
            if (clean := _valid_item(item, known, kpi_numbers, titled)) is not None
        ]
        dropped += (len(raw) if isinstance(raw, list) else 0) - min(len(valid), limit)
        kept[section] = valid[:limit]
    return kept, dropped


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def group_scope_key(group_id: str) -> str:
    """The ``scope_key`` a keyword group's narratives are stored under."""
    return f'{GROUP_SCOPE_PREFIX}{group_id}'


def narrative_item(
    *,
    scope_key: str,
    run_timestamp: str,
    narrative: Mapping[str, list[dict[str, Any]]],
    model: str,
    language: str,
    dropped: int,
    generated_at: str,
) -> dict[str, Any]:
    """The ``CitationAnalysis-ReportInsights`` item of one scope's run, expiring with the run's KPI snapshot."""
    return {
        'scope_key': scope_key,
        'run_timestamp': run_timestamp,
        'narrative': {section: list(narrative.get(section, [])) for section, _limit, _titled in NARRATIVE_SECTIONS},
        'model': model,
        'language': language,
        'dropped': dropped,
        'generated_at': generated_at,
        'ttl': ttl_for_timestamp(run_timestamp),
    }


def narrative_from_item(item: Mapping[str, Any]) -> dict[str, Any]:
    """The ``narrative`` object ``GET /api/reports/insights`` returns, from a stored item."""
    stored = item.get('narrative')
    sections = stored if isinstance(stored, Mapping) else {}
    return {
        'run_timestamp': item['run_timestamp'],
        'model': item.get('model'),
        'generated_at': item.get('generated_at'),
        'language': item.get('language') or DEFAULT_LANGUAGE,
        **{section: list(sections.get(section) or []) for section, _limit, _titled in NARRATIVE_SECTIONS},
        'dropped': to_int(item.get('dropped')),
    }


def report_insights_table() -> Any | None:
    """The ``CitationAnalysis-ReportInsights`` table, or ``None`` where it is not configured."""
    table_name = os.environ.get('DYNAMODB_TABLE_REPORT_INSIGHTS')
    return get_dynamodb_resource().Table(table_name) if table_name else None


def load_narrative(scope_key: str, run_timestamp: str | None, *, table: Any | None = None) -> dict[str, Any] | None:
    """The narrative stored for the scope's latest run (``run_timestamp``); ``None`` when there is none.

    A scope without a run, a table that is not configured and a read that
    fails all answer ``None``: the report then shows its computed insights
    without a narrative.
    """
    if not run_timestamp:
        return None
    target = table if table is not None else report_insights_table()
    if target is None:
        return None
    try:
        item = target.get_item(Key={'scope_key': scope_key, 'run_timestamp': run_timestamp}).get('Item')
    except (BotoCoreError, ClientError):
        logger.exception('Stored narrative could not be read')
        return None
    return narrative_from_item(item) if item else None


__all__ = [
    'DEFAULT_LANGUAGE',
    'LANGUAGE_NAMES',
    'MAX_NARRATIVE_INSIGHTS',
    'MAX_NARRATIVE_RECOMMENDATIONS',
    'detect_language',
    'group_scope_key',
    'keyword_language',
    'load_narrative',
    'narrative_from_item',
    'narrative_item',
    'report_insights_table',
    'validate_narrative',
    'written_numbers',
]
