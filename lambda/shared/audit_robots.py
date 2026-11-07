"""
robots.txt per RFC 9309: parsing, group selection and rule matching.

* **Fetch status** (``policy_for``): 2xx is parsed; 4xx means no restrictions (allow all); 5xx, 429 (a site
  asking crawlers to back off, which search engines treat like a server error), a network error, a timeout or an
  unresolved redirect means *complete disallow* (RFC 9309 §2.3.1.3-4), so a site whose robots.txt is down is
  treated by compliant crawlers as closed.
* **Groups**: consecutive ``User-agent`` lines open one group; every group naming the product token
  (case-insensitive; ``Googlebot/2.1`` names ``googlebot``) is merged; without one the ``*`` groups apply;
  without either everything is allowed.
* **Rules**: ``Allow`` / ``Disallow`` path patterns with ``*`` (any run of characters) and a final ``$`` (end of
  URL); the longest matching pattern wins, a tie goes to ``Allow``, an empty ``Disallow`` is no rule.
  Percent-encoding is normalized on both sides (unreserved characters decoded, other escapes upper-cased,
  non-ASCII encoded as UTF-8). ``/robots.txt`` itself is always allowed.
* ``Sitemap:`` lines are collected wherever they appear.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import quote

ROBOTS_PATH = '/robots.txt'
_UNRESERVED = re.compile(r'[A-Za-z0-9\-._~]')
_PERCENT = re.compile(r'%([0-9A-Fa-f]{2})')
_TOKEN = re.compile(r'[A-Za-z_\-*]+')

PolicyKind = Literal['parsed', 'allow_all', 'disallow_all']


@dataclass(frozen=True)
class RobotsRule:
    allow: bool
    pattern: str
    line: int


@dataclass(frozen=True)
class RobotsGroup:
    agents: tuple[str, ...]
    rules: tuple[RobotsRule, ...]


@dataclass(frozen=True)
class RobotsTxt:
    groups: tuple[RobotsGroup, ...] = ()
    sitemaps: tuple[str, ...] = ()


@dataclass(frozen=True)
class Verdict:
    """Whether a path may be crawled, and the rule that decided it (``None``: no rule matched)."""

    allowed: bool
    rule: RobotsRule | None = None


@dataclass(frozen=True)
class RobotsPolicy:
    """The robots.txt of one origin as a crawler must apply it."""

    kind: PolicyKind
    status: int
    robots: RobotsTxt = field(default_factory=RobotsTxt)

    def verdict(self, token: str, path: str) -> Verdict:
        if path == ROBOTS_PATH or self.kind == 'allow_all':
            return Verdict(allowed=True)
        if self.kind == 'disallow_all':
            return Verdict(allowed=False)
        return evaluate(self.robots, token, path)

    def allows(self, tokens: tuple[str, ...], path: str) -> bool:
        """Allowed for the first of ``tokens`` that has its own group, else for ``*``."""
        return self.verdict(_first_named(self.robots, tokens), path).allowed


def _normalize_octets(text: str) -> str:
    def decode(match: re.Match[str]) -> str:
        char = chr(int(match.group(1), 16))
        return char if _UNRESERVED.fullmatch(char) else f'%{match.group(1).upper()}'

    encoded = quote(text, safe="/?=&;:@+$,!*'()%#[]~-._")
    return _PERCENT.sub(decode, encoded)


def _agent_token(value: str) -> str:
    match = _TOKEN.match(value.strip())
    return match.group(0).lower() if match else ''


def _split_line(raw: str) -> tuple[str, str] | None:
    line = raw.split('#', 1)[0].strip()
    if ':' not in line:
        return None
    key, value = line.split(':', 1)
    return key.strip().lower(), value.strip()


class _Builder:
    def __init__(self) -> None:
        self.groups: list[RobotsGroup] = []
        self.sitemaps: list[str] = []
        self.agents: list[str] = []
        self.rules: list[RobotsRule] = []

    def close_group(self) -> None:
        if self.agents:
            self.groups.append(RobotsGroup(agents=tuple(self.agents), rules=tuple(self.rules)))
        self.agents, self.rules = [], []

    def add(self, key: str, value: str, number: int) -> None:
        if key == 'user-agent':
            if self.rules:
                self.close_group()
            token = _agent_token(value)
            if token:
                self.agents.append(token)
        elif key in ('allow', 'disallow') and self.agents and value:
            self.rules.append(RobotsRule(allow=key == 'allow', pattern=_normalize_octets(value), line=number))
        elif key == 'sitemap' and value:
            self.sitemaps.append(value)


def parse_robots(text: str) -> RobotsTxt:
    """The groups and sitemaps of a robots.txt body."""
    builder = _Builder()
    for number, raw in enumerate(text.lstrip('\ufeff').splitlines(), start=1):
        parsed = _split_line(raw)
        if parsed is not None:
            builder.add(*parsed, number)
    builder.close_group()
    return RobotsTxt(groups=tuple(builder.groups), sitemaps=tuple(builder.sitemaps))


def _pattern_regex(pattern: str) -> re.Pattern[str]:
    anchored = pattern.endswith('$')
    body = pattern[:-1] if anchored else pattern
    regex = '.*'.join(re.escape(part) for part in body.split('*'))
    return re.compile(regex + ('$' if anchored else ''))


def _rules_for(robots: RobotsTxt, token: str) -> tuple[RobotsRule, ...] | None:
    wanted = token.lower()
    named = [group for group in robots.groups if wanted in group.agents]
    chosen = named or [group for group in robots.groups if '*' in group.agents]
    if not chosen:
        return None
    return tuple(rule for group in chosen for rule in group.rules)


def _first_named(robots: RobotsTxt, tokens: tuple[str, ...]) -> str:
    for token in tokens:
        if any(token.lower() in group.agents for group in robots.groups):
            return token
    return '*'


def evaluate(robots: RobotsTxt, token: str, path: str) -> Verdict:
    """The verdict for ``token`` on ``path`` (path plus query) under parsed rules."""
    rules = _rules_for(robots, token)
    if not rules:
        return Verdict(allowed=True)
    target = _normalize_octets(path or '/')
    best: RobotsRule | None = None
    for rule in rules:
        if not _pattern_regex(rule.pattern).match(target):
            continue
        longer = best is None or len(rule.pattern) > len(best.pattern)
        tie_allows = best is not None and len(rule.pattern) == len(best.pattern) and rule.allow
        if longer or tie_allows:
            best = rule
    return Verdict(allowed=best is None or best.allow, rule=best)


def policy_for(status: int, body: str) -> RobotsPolicy:
    """The policy a fetch of robots.txt yields (``status`` 0 for no response)."""
    if 200 <= status < 300:
        return RobotsPolicy(kind='parsed', status=status, robots=parse_robots(body))
    if 400 <= status < 500 and status != 429:
        return RobotsPolicy(kind='allow_all', status=status)
    return RobotsPolicy(kind='disallow_all', status=status)
