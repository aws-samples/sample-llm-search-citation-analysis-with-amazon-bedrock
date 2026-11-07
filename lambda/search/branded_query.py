"""Whether a query names the tracked brand: a *branded* prompt.

An answer to a query that names the brand ("is Hotel Example good?") mentions
the brand almost by construction, so it says little about how visible the
brand is to someone who did not ask for it. Every answer row records
``branded`` at write time; the KPI alerts compare neutral (non-branded)
answers by default and the Visibility tab can filter on it.

A query is branded when it names a first-party brand name or alias as a
whole word (case-, accent- and whitespace-insensitive, any script), or names
an owned domain or a subdomain of one. Domains are label-guarded, so
``example.com.evil.test`` and ``notexample.com`` do not name ``example.com``.
The decision is fixed when the row is written: later brand-configuration
edits do not rewrite history.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from shared.kpi_engine import owned_domains_from

#: Names shorter than this are not matched: a one-letter alias would mark almost every query.
MIN_NAME_LENGTH = 2

# `\w` is Unicode-aware for `str` patterns (letters and digits of every script, and `_`).
# Accents are folded away before matching, so a combining mark never splits a word.
_NAME_BEFORE = r'(?<!\w)'
_NAME_AFTER = r'(?!\w)'
# A domain is preceded by a dot (a subdomain), a slash, a space... but not by a letter or a hyphen,
# and followed by anything but a further label: `.com.` at the end of a sentence still names it.
_DOMAIN_BEFORE = r'(?<![\w-])'
_DOMAIN_AFTER = r'(?![\w-]|\.[\w-])'


def fold_text(text: str) -> str:
    """``text`` compatibility-decomposed, without combining marks, case-folded: "Café" and "CAFE" fold alike."""
    decomposed = unicodedata.normalize('NFKD', text)
    return ''.join(char for char in decomposed if unicodedata.category(char) != 'Mn').casefold()


def _name_pattern(name: str) -> str | None:
    """The whole-word pattern of one brand name (inner whitespace matches any run of it), or ``None`` when too short."""
    words = fold_text(name).split()
    if len(' '.join(words)) < MIN_NAME_LENGTH:
        return None
    return _NAME_BEFORE + r'\s+'.join(map(re.escape, words)) + _NAME_AFTER


def _domain_pattern(domain: str) -> str:
    return _DOMAIN_BEFORE + re.escape(fold_text(domain)) + _DOMAIN_AFTER


def branded_query_matcher(names: Iterable[str], owned_domains: Iterable[str]) -> Callable[[str], bool]:
    """A test of whether a query names one of ``names`` or ``owned_domains`` (compiled once, used per row)."""
    patterns = [pattern for pattern in map(_name_pattern, names) if pattern]
    patterns.extend(_domain_pattern(domain) for domain in owned_domains if domain)
    if not patterns:
        return lambda _query: False
    combined = re.compile('|'.join(patterns))
    return lambda query: bool(query) and combined.search(fold_text(query)) is not None


def first_party_names(brand_config: Mapping[str, Any]) -> list[str]:
    """The configured first-party names of a brand configuration (``tracked_brands.first_party``)."""
    tracked = brand_config.get('tracked_brands')
    names = tracked.get('first_party') if isinstance(tracked, Mapping) else None
    return [name for name in names if isinstance(name, str)] if isinstance(names, (list, tuple)) else []


def branded_query_matcher_for(brand_config: Mapping[str, Any]) -> Callable[[str], bool]:
    """The matcher of a brand configuration: its first-party names (market aliases included) and owned domains."""
    return branded_query_matcher(first_party_names(brand_config), owned_domains_from(brand_config))
