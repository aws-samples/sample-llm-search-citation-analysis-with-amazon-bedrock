"""
Site-level "AI readiness" checks: robots.txt access of AI crawlers, the start page's organization markup, and
the raw-versus-rendered comparison of a page.

**AI crawlers** (``AI_CRAWLERS``, product tokens as their operators document them, checked 2026-10):
search crawlers feed AI search answers, user-triggered fetchers load a page when a user asks about it, and
training crawlers collect model training data (``Google-Extended`` and ``Applebot-Extended`` are opt-out tokens
with no crawler of their own).

Per crawler, robots.txt (``shared.audit_robots``) is evaluated on ``/`` and on the path of every crawled 2xx
HTML page: ``blocked`` when ``/`` is blocked, ``partial`` when only some pages are, ``allowed`` otherwise. A
robots.txt that does not answer (5xx, timeout) is reported once as ``robots-unreachable`` rather than as
every crawler blocked.

**Rendered comparison** (``rendered_issues``) needs a copy of the page rendered with JavaScript; without one
only the raw-HTML shell check (``javascript-rendering-suspected``) applies.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from shared.audit_issues import Issue
from shared.audit_page import PageFacts
from shared.audit_robots import RobotsPolicy
from shared.audit_structured import ORGANIZATION_TYPES, SITE_TYPES

BotClass = Literal['search', 'user_fetch', 'training']
Access = Literal['allowed', 'partial', 'blocked']


@dataclass(frozen=True)
class AiCrawler:
    token: str
    vendor: str
    bot_class: BotClass


AI_CRAWLERS: tuple[AiCrawler, ...] = (
    AiCrawler('OAI-SearchBot', 'OpenAI', 'search'),
    AiCrawler('ChatGPT-User', 'OpenAI', 'user_fetch'),
    AiCrawler('GPTBot', 'OpenAI', 'training'),
    AiCrawler('Claude-SearchBot', 'Anthropic', 'search'),
    AiCrawler('Claude-User', 'Anthropic', 'user_fetch'),
    AiCrawler('ClaudeBot', 'Anthropic', 'training'),
    AiCrawler('PerplexityBot', 'Perplexity', 'search'),
    AiCrawler('Perplexity-User', 'Perplexity', 'user_fetch'),
    AiCrawler('Googlebot', 'Google', 'search'),
    AiCrawler('Google-Extended', 'Google', 'training'),
    AiCrawler('Bingbot', 'Microsoft', 'search'),
    AiCrawler('Applebot-Extended', 'Apple', 'training'),
    AiCrawler('CCBot', 'Common Crawl', 'training'),
)
MAX_BLOCKED_URLS = 20
CONTENT_MIN_RENDERED_WORDS = 150
NAVIGATION_MIN_RENDERED_LINKS = 5
NAVIGATION_RATIO_MIN_LINKS = 10


@dataclass(frozen=True)
class BotAccess:
    crawler: AiCrawler
    access: Access
    blocked_paths: tuple[str, ...]
    rule: str
    line: int | None

    def as_json(self) -> dict[str, object]:
        return {
            'token': self.crawler.token, 'vendor': self.crawler.vendor, 'bot_class': self.crawler.bot_class,
            'access': self.access, 'blocked_paths': list(self.blocked_paths), 'rule': self.rule, 'line': self.line,
        }


def bot_access(policy: RobotsPolicy, page_paths: Sequence[str]) -> list[BotAccess]:
    """The access of every AI crawler to ``/`` and to ``page_paths``."""
    results: list[BotAccess] = []
    for crawler in AI_CRAWLERS:
        home = policy.verdict(crawler.token, '/')
        blocked = tuple(path for path in page_paths if not policy.verdict(crawler.token, path).allowed)
        access: Access = 'blocked' if not home.allowed else ('partial' if blocked else 'allowed')
        rule = home.rule
        results.append(BotAccess(
            crawler=crawler, access=access, blocked_paths=blocked[:MAX_BLOCKED_URLS],
            rule=f"{'Allow' if rule.allow else 'Disallow'}: {rule.pattern}" if rule else '',
            line=rule.line if rule else None,
        ))
    return results


def _class_issue(issue_type: str, start_url: str, entries: Sequence[BotAccess]) -> list[Issue]:
    if not entries:
        return []
    first = entries[0]
    details = {'bots': [entry.crawler.token for entry in entries], 'matched_rule': first.rule, 'line': first.line}
    return [Issue(issue_type, start_url, details)]


def _inverted(accesses: Sequence[BotAccess], start_url: str) -> list[Issue]:
    issues: list[Issue] = []
    for vendor in sorted({entry.crawler.vendor for entry in accesses}):
        mine = [entry for entry in accesses if entry.crawler.vendor == vendor]
        search_blocked = [entry for entry in mine if entry.crawler.bot_class == 'search' and entry.access == 'blocked']
        training_allowed = [e for e in mine if e.crawler.bot_class == 'training' and e.access == 'allowed']
        if search_blocked and training_allowed:
            details = {'vendor': vendor, 'search_bots': [entry.crawler.token for entry in search_blocked],
                       'training_bots': [entry.crawler.token for entry in training_allowed]}
            issues.append(Issue('ai-search-blocked-training-allowed', start_url, details, dedupe_key=vendor))
    return issues


def robots_issues(policy: RobotsPolicy, accesses: Sequence[BotAccess], start_url: str) -> list[Issue]:
    """The robots.txt AI-readiness issues of the site."""
    if policy.kind == 'disallow_all':
        return [Issue('robots-unreachable', start_url, {'status_code': policy.status})]

    def of(bot_class: BotClass, access: Access) -> list[BotAccess]:
        return [entry for entry in accesses if entry.crawler.bot_class == bot_class and entry.access == access]

    partial = [
        Issue('ai-search-bot-partially-blocked', start_url,
              {'bot': entry.crawler.token, 'blocked_urls': list(entry.blocked_paths)}, dedupe_key=entry.crawler.token)
        for entry in of('search', 'partial')
    ]
    return [
        *_class_issue('ai-search-bot-blocked', start_url, of('search', 'blocked')),
        *partial,
        *_class_issue('ai-user-fetch-blocked', start_url, of('user_fetch', 'blocked')),
        *_class_issue('ai-training-bot-blocked', start_url, of('training', 'blocked')),
        *_inverted(accesses, start_url),
    ]


def organization_issues(start_url: str, types: Sequence[str], organizations: int, with_same_as: int) -> list[Issue]:
    """``organization-schema-missing`` / ``organization-sameas-missing`` of the start page's structured data."""
    if not any(kind in ORGANIZATION_TYPES or kind in SITE_TYPES for kind in types):
        return [Issue('organization-schema-missing', start_url)]
    if organizations > 0 and with_same_as == 0:
        return [Issue('organization-sameas-missing', start_url)]
    return []


def _metadata_differs(raw: PageFacts, rendered: PageFacts) -> list[str]:
    fields: list[str] = []
    for name, before, after in (
        ('title', raw.title, rendered.title),
        ('meta_description', raw.meta_description, rendered.meta_description),
        ('canonical', raw.canonical, rendered.canonical),
    ):
        missing_raw = not before and bool(after)
        changed = name != 'meta_description' and bool(before) and bool(after) and before != after
        if missing_raw or changed:
            fields.append(name)
    return fields


def rendered_issues(url: str, raw: PageFacts, rendered: PageFacts) -> list[Issue]:
    """What only appears after JavaScript runs, from the raw and the rendered copy of one page."""
    issues: list[Issue] = []
    words_raw, words_rendered = raw.word_count, rendered.word_count
    if words_rendered >= CONTENT_MIN_RENDERED_WORDS and (words_raw < 0.5 * words_rendered or raw.javascript_shell):
        issues.append(Issue('content-requires-javascript', url, {'raw_words': words_raw, 'rendered_words': words_rendered}))
    changed = _metadata_differs(raw, rendered)
    if changed:
        issues.append(Issue('metadata-requires-javascript', url, {'fields': changed}))
    if raw.h1_count == 0 and rendered.h1_count >= 1:
        issues.append(Issue('h1-requires-javascript', url))
    links_raw, links_rendered = len(raw.internal_links), len(rendered.internal_links)
    few_raw = links_raw == 0 and links_rendered >= NAVIGATION_MIN_RENDERED_LINKS
    ratio = links_rendered >= NAVIGATION_RATIO_MIN_LINKS and links_raw < 0.5 * links_rendered
    if few_raw or ratio:
        issues.append(Issue('navigation-requires-javascript', url, {'raw_links': links_raw, 'rendered_links': links_rendered}))
    return issues
