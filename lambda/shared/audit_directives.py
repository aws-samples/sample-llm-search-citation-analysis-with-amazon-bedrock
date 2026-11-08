"""
Indexing directives of a page: meta robots tags, the ``X-Robots-Tag`` header and the ``Link`` canonical.

* ``X-Robots-Tag`` may name a crawler (``googlebot: noindex, nofollow``); the directives after a name apply to
  it until the next name. A colon after a known directive (``max-snippet: 0``) is a value, not a name.
* **Indexable** follows search-engine practice for the generic rule: a page is not indexable when its meta
  robots or any ``X-Robots-Tag`` value contains ``noindex``.
* **Snippet restrictions** (``nosnippet``, ``max-snippet:0``, and the ``noai`` / ``noimageai`` opt-outs) are read
  from the generic, ``googlebot`` and ``bingbot`` directives: any of them keeps the text out of AI answers.
* **Bing-only noindex**: a ``bingbot`` noindex while the generic directives allow indexing.
"""

from __future__ import annotations

import re
from collections.abc import Mapping

GENERIC = '*'
VALUE_DIRECTIVES = frozenset({'max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after'})
SNIPPET_OPT_OUTS = frozenset({'nosnippet', 'max-snippet:0', 'noai', 'noimageai'})
SNIPPET_BOTS = (GENERIC, 'googlebot', 'bingbot')
_LINK_CANONICAL = re.compile(r'<([^>]*)>\s*;[^,]*\brel\s*=\s*"?canonical"?', re.IGNORECASE)


def _directive(text: str) -> str:
    return re.sub(r'\s*:\s*', ':', text.strip().lower())


def parse_x_robots_tag(header: str) -> dict[str, tuple[str, ...]]:
    """Directives per crawler (``'*'`` for the generic ones) of an ``X-Robots-Tag`` value."""
    found: dict[str, list[str]] = {}
    bot = GENERIC
    for part in header.split(','):
        text = part.strip()
        if not text:
            continue
        name, sep, rest = text.partition(':')
        if sep and name.strip().lower() not in VALUE_DIRECTIVES and ' ' not in name.strip():
            bot = name.strip().lower()
            text = rest
        if text.strip():
            found.setdefault(bot, []).append(_directive(text))
    return {key: tuple(values) for key, values in found.items()}


def meta_directives(content: str) -> tuple[str, ...]:
    return tuple(_directive(part) for part in content.split(',') if part.strip())


def link_header_canonical(header: str) -> str:
    """The URL of a ``Link: <url>; rel="canonical"`` header, or ``''``."""
    match = _LINK_CANONICAL.search(header or '')
    return match.group(1).strip() if match else ''


def is_indexable(robots_meta: str, x_robots_tag: str) -> bool:
    return 'noindex' not in f'{robots_meta},{x_robots_tag}'.lower()


def _directives_by_bot(bot_meta: Mapping[str, str], x_robots_tag: str) -> dict[str, set[str]]:
    by_bot: dict[str, set[str]] = {}
    for name, content in bot_meta.items():
        key = GENERIC if name == 'robots' else name
        by_bot.setdefault(key, set()).update(meta_directives(content))
    for key, values in parse_x_robots_tag(x_robots_tag).items():
        by_bot.setdefault(key, set()).update(values)
    return by_bot


def snippet_restrictions(bot_meta: Mapping[str, str], x_robots_tag: str) -> list[str]:
    """``bot:directive`` of every snippet opt-out that applies to the generic, Google or Bing crawler."""
    by_bot = _directives_by_bot(bot_meta, x_robots_tag)
    return sorted(
        f'{bot}:{directive}' if bot != GENERIC else directive
        for bot in SNIPPET_BOTS
        for directive in by_bot.get(bot, set()) & SNIPPET_OPT_OUTS
    )


def noindex_for_bing_only(bot_meta: Mapping[str, str], x_robots_tag: str) -> bool:
    by_bot = _directives_by_bot(bot_meta, x_robots_tag)
    return 'noindex' in by_bot.get('bingbot', set()) and 'noindex' not in by_bot.get(GENERIC, set())
