"""
``/llms.txt`` of the audited site: present, valid, and whether its links work.

* **Present**: 200, not served as HTML, not a bot challenge, and the first non-blank line starts with ``# `` (the
  H1 title the proposal requires). A 200 that fails the other rules is ``invalid``; anything else is
  ``missing``. Redirects are followed only within the same host.
* **Links**: Markdown ``[text](url)`` links in list items, resolved against the file, same-site only; at most
  ``MAX_CHECKED_LINKS`` are fetched (politely, by the caller) and any answer >= 400 is broken.

No major answer engine documents reading ``llms.txt``, so a missing file is informational only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from shared.audit_classify import classify_fetch
from shared.audit_fetch import FetchResult
from shared.audit_issues import Issue
from shared.audit_urls import is_same_origin, normalize_url

LLMS_TXT_PATH = '/llms.txt'
MAX_CHECKED_LINKS = 20
MAX_BROKEN_URLS = 10
LLMS_TIMEOUT_S = 10.0
_LIST_LINK = re.compile(r'^\s*[-*+]\s+.*?\[[^\]]*\]\(([^)\s]+)')

LlmsState = Literal['present', 'invalid', 'missing']


@dataclass(frozen=True)
class LlmsTxt:
    state: LlmsState
    links: tuple[str, ...] = ()


def read_llms_txt(result: FetchResult) -> LlmsTxt:
    """The state and the same-site list links of a fetched ``/llms.txt``."""
    if result.status != 200:
        return LlmsTxt(state='missing')
    text = result.text()
    first_line = next((line for line in text.splitlines() if line.strip()), '')
    challenge = classify_fetch(result.status, result.headers, text) != 'ok'
    if 'text/html' in result.content_type or challenge or not first_line.startswith('# '):
        return LlmsTxt(state='invalid')
    links: list[str] = []
    for line in text.splitlines():
        match = _LIST_LINK.match(line)
        url = normalize_url(match.group(1), result.url) if match else None
        if url and is_same_origin(url, result.url) and url not in links:
            links.append(url)
    return LlmsTxt(state='present', links=tuple(links[:MAX_CHECKED_LINKS]))


def llms_issues(llms: LlmsTxt, start_url: str, broken: list[str]) -> list[Issue]:
    """The llms.txt issues, given the sampled links that answered >= 400."""
    if llms.state == 'missing':
        return [Issue('llms-txt-missing', start_url)]
    if llms.state == 'invalid':
        return [Issue('llms-txt-invalid', start_url)]
    if broken:
        return [Issue('llms-txt-broken-links', start_url, {'broken_urls': broken[:MAX_BROKEN_URLS]})]
    return []
