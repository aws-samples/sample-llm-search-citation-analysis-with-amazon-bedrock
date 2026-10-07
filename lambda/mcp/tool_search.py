"""
``search_tools``: BM25 over the catalogue's names, descriptions and tags.

The index is built once per cold start from ``catalogue.OPERATIONS`` (a few
dozen short documents), so a query costs a handful of dictionary lookups. No
tokenizer dependency: terms are lower-cased runs of letters and digits, with a
crude plural fold so ``prompts`` finds ``prompt``.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Iterable, Sequence

from catalogue import OPERATIONS, Tool

K1 = 1.5
B = 0.75
DEFAULT_LIMIT = 5

_TERM = re.compile(r'[a-z0-9]+')


def _fold(term: str) -> str:
    """``answers`` → ``answer``, ``citations`` → ``citation``; ``kpis`` → ``kpi``; short words untouched."""
    if len(term) > 3 and term.endswith('s') and not term.endswith('ss'):
        return term[:-1]
    return term


def tokenize(text: str) -> list[str]:
    return [_fold(term) for term in _TERM.findall(text.lower())]


def _document(tool: Tool) -> list[str]:
    return tokenize(' '.join((tool.name, tool.description, *tool.tags)))


class ToolIndex:
    """A BM25 index over a fixed set of tools."""

    def __init__(self, tools: Sequence[Tool]) -> None:
        self._tools = tuple(tools)
        self._documents = [Counter(_document(tool)) for tool in self._tools]
        self._lengths = [sum(document.values()) for document in self._documents]
        self._average_length = (sum(self._lengths) / len(self._lengths)) if self._lengths else 0.0
        frequencies = Counter(term for document in self._documents for term in document)
        total = len(self._documents)
        self._idf = {term: math.log(1 + (total - count + 0.5) / (count + 0.5)) for term, count in frequencies.items()}

    def _score(self, index: int, terms: Iterable[str]) -> float:
        document = self._documents[index]
        norm = K1 * (1 - B + B * self._lengths[index] / self._average_length)
        score = 0.0
        for term in terms:
            frequency = document.get(term, 0)
            if frequency:
                score += self._idf[term] * frequency * (K1 + 1) / (frequency + norm)
        return score

    def search(self, query: str, limit: int = DEFAULT_LIMIT) -> list[Tool]:
        """The best-matching tools for ``query``, best first; only tools sharing a term with the query."""
        terms = set(tokenize(query))
        scored = [(self._score(index, terms), index) for index in range(len(self._tools))]
        ranked = sorted(((score, index) for score, index in scored if score > 0), key=lambda pair: (-pair[0], pair[1]))
        return [self._tools[index] for _score, index in ranked[:limit]]


_index: ToolIndex | None = None


def tool_index() -> ToolIndex:
    """The catalogue index, built on first use."""
    global _index
    if _index is None:
        _index = ToolIndex(OPERATIONS)
    return _index


def search_tools(query: str, limit: int = DEFAULT_LIMIT) -> list[Tool]:
    return tool_index().search(query, limit)
