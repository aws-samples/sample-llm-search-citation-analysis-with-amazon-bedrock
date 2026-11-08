"""Which of a Perplexity Agent API answer's sources the answer cites.

A ``web_search`` run adds one ``search_results`` output item per search,
ahead of the ``message``. Every result carries an ``id`` and all items share
one id space, so a marker in the answer text names a result: ``[1]``, ``[2]``
(``[web:1]`` with some presets, ``[1, 3]`` for several at once). Whether the
model writes markers depends on the prompt, so an answer can carry none.

The rule:

- the message's annotations (``url_citation``) are cited;
- markers that resolve to a result: those results are cited;
- when the answer has either signal, every other result was only retrieved
  (read while searching, not a source of the answer);
- when it has neither (no annotation, no marker that matches an id), the
  answer gives no finer signal, and Perplexity documents the
  ``search_results`` as the sources of its answer, so every result counts as
  cited. Counting them as retrieved would report a cited answer as citing
  nothing.

URLs written in the text are cited either way; the caller adds them.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any, NamedTuple

#: One bracket of markers: ``[1]``, ``[web:2]``, ``[1, 3]``, ``[web:1, web:4]``.
_MARKER_BRACKET = re.compile(r'\[((?:web:)?\d+(?:\s*,\s*(?:web:)?\d+)*)\]')
_MARKER_ID = re.compile(r'\d+')


class PerplexitySources(NamedTuple):
    """An answer's source URLs, raw: ``cited`` (annotations, then cited results) and ``retrieved``."""

    cited: list[str]
    retrieved: list[str]


def _marker_ids(text: str) -> set[int]:
    """The result ids the markers in ``text`` name."""
    return {
        int(number)
        for bracket in _MARKER_BRACKET.finditer(text)
        for number in _MARKER_ID.findall(bracket.group(1))
    }


def _result_id(result: dict[str, Any], position: int) -> int:
    """The result's ``id``, or its 1-based position across every item when it has none."""
    value = result.get('id')
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return position


def _search_results(response: dict[str, Any]) -> Iterator[tuple[int, str]]:
    """``(id, url)`` of every result with a URL, across all ``search_results`` items, in order."""
    position = 0
    for item in response.get('output') or []:
        if not isinstance(item, dict) or item.get('type') != 'search_results':
            continue
        for result in item.get('results') or []:
            if not isinstance(result, dict):
                continue
            position += 1
            url = result.get('url')
            if isinstance(url, str) and url:
                yield _result_id(result, position), url


def _annotation_urls(response: dict[str, Any]) -> Iterator[str]:
    """The URL of every annotation on the text parts of the ``message`` items."""
    for item in response.get('output') or []:
        if not isinstance(item, dict) or item.get('type') != 'message':
            continue
        for part in item.get('content') or []:
            for annotation in (part.get('annotations') if isinstance(part, dict) else None) or []:
                url = annotation.get('url') if isinstance(annotation, dict) else None
                if isinstance(url, str) and url:
                    yield url


def perplexity_sources(response: dict[str, Any], text: str) -> PerplexitySources:
    """The URLs the answer ``text`` of ``response`` cites and those it only retrieved (see the module rule)."""
    annotated = list(_annotation_urls(response))
    results = list(_search_results(response))
    referenced = _marker_ids(text) & {result_id for result_id, _ in results}
    if not annotated and not referenced:
        return PerplexitySources([url for _, url in results], [])
    cited = [url for result_id, url in results if result_id in referenced]
    retrieved = [url for result_id, url in results if result_id not in referenced]
    return PerplexitySources(annotated + cited, retrieved)
