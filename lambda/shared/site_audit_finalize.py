"""
Last step of an audit: the cross-page and site-level checks, then the summary.

* cross-page checks (``shared.audit_multipage``) over every stored page; orphans only when the crawl is complete
  (no stop, nothing left pending);
* ``crawl-rate-limited`` when the throttle stopped the crawl;
* AI readiness of the site: robots.txt access of every AI crawler on ``/`` and on each crawled 2xx HTML page,
  the start page's Organization / WebSite markup (when the start page was readable HTML), and ``/llms.txt``
  (same host only, when robots.txt allows the audit crawler to read it; up to 20 of its links are checked);
* the summary (``shared.site_audit_summary``), the AI-readiness panel data and the link-graph summary item.

A cancelled audit is left as it is.
"""

from __future__ import annotations

from typing import Any

from shared.audit_fetch import CRAWLER_NAME, MAX_LLMS_TXT_BYTES, TEXT_ACCEPT
from shared.audit_geo import bot_access, organization_issues, robots_issues
from shared.audit_issues import Issue
from shared.audit_llms_txt import LLMS_TIMEOUT_S, LLMS_TXT_PATH, LlmsTxt, llms_issues, read_llms_txt
from shared.audit_multipage import PageSummary, multipage_issues, orphans_checkable
from shared.audit_robots import RobotsPolicy
from shared.audit_urls import host_of, path_and_query
from shared.site_audit_crawl import robots_policy
from shared.site_audit_fetcher import FetchDeferredError, PoliteFetcher
from shared.site_audit_repository import AuditStore
from shared.site_audit_summary import summarize


def page_summary(item: dict[str, Any]) -> PageSummary:
    """The cross-page view of a stored page item."""
    links = item.get('internal_links')
    return PageSummary(
        url=str(item['url']),
        status=int(item.get('status', 0)),
        fetch_class=str(item.get('fetch_class', 'error')),
        is_html=bool(item.get('is_html')),
        redirect_url=item.get('redirect_url') or None,
        title=str(item.get('title') or ''),
        meta_description=str(item.get('meta_description') or ''),
        content_hash=str(item.get('content_hash') or ''),
        word_count=int(item.get('word_count', 0)),
        indexable=bool(item.get('indexable', True)),
        canonical=str(item.get('canonical') or ''),
        javascript_shell=bool(item.get('javascript_shell')),
        internal_links=tuple(str(link) for link in links) if isinstance(links, list) else (),
        links_truncated=bool(item.get('links_truncated')),
    )


def _start_page_issues(store: AuditStore, audit_id: str, start_url: str) -> list[Issue]:
    item = store.page(audit_id, start_url)
    if item is None:
        return []
    page = page_summary(item)
    if not (page.is_live and page.is_html) or page.javascript_shell:
        return []
    types = [str(kind) for kind in item.get('schema_types') or []]
    return organization_issues(
        start_url, types, int(item.get('organizations', 0)), int(item.get('organizations_with_same_as', 0)),
    )


def check_llms_txt(fetcher: PoliteFetcher, policy: RobotsPolicy, origin: str) -> tuple[LlmsTxt | None, list[str]]:
    """``/llms.txt`` and its broken sampled links; ``(None, [])`` when robots.txt keeps the crawler out."""
    if not policy.allows((CRAWLER_NAME,), LLMS_TXT_PATH):
        return None, []
    host = host_of(origin)
    try:
        result = fetcher.fetch(
            f'{origin}{LLMS_TXT_PATH}', max_bytes=MAX_LLMS_TXT_BYTES, accept=TEXT_ACCEPT, timeout_s=LLMS_TIMEOUT_S,
            follow_hop=lambda target: host_of(target) == host,
        )
    except FetchDeferredError:
        return None, []
    llms = read_llms_txt(result)
    broken: list[str] = []
    for link in llms.links:
        if not policy.allows((CRAWLER_NAME,), path_and_query(link)):
            continue
        try:
            answer = fetcher.fetch(link, max_bytes=MAX_LLMS_TXT_BYTES, accept=TEXT_ACCEPT, timeout_s=LLMS_TIMEOUT_S)
        except FetchDeferredError:
            break
        if answer.status >= 400:
            broken.append(link)
    return llms, broken


def finalize(store: AuditStore, audit: dict[str, Any], fetcher: PoliteFetcher, *, completed_at: str) -> dict[str, Any]:
    """Run the closing checks; returns the changes to save on the audit item."""
    audit_id, start_url, origin = str(audit['audit_id']), str(audit['start_url']), str(audit['origin'])
    stop_reason = str(audit.get('stop_reason') or '')
    pages = [page_summary(item) for item in store.pages(audit_id)]
    crawl_complete = not stop_reason and not store.has_pending(audit_id)
    issues = multipage_issues(pages, start_url, crawl_complete=crawl_complete)
    if stop_reason == 'rate_limited':
        issues.append(Issue('crawl-rate-limited', start_url))
    policy = robots_policy(audit_id)
    accesses = bot_access(policy, [path_and_query(page.url) for page in pages if page.is_live and page.is_html])
    issues.extend(robots_issues(policy, accesses, start_url))
    issues.extend(_start_page_issues(store, audit_id, start_url))
    llms, broken = check_llms_txt(fetcher, policy, origin)
    if llms is not None:
        issues.extend(llms_issues(llms, start_url, broken))
    store.put_issues(audit_id, issues)
    store.put_link_summary(audit_id, {
        'pages': len(pages),
        'edges': sum(len(page.internal_links) for page in pages),
        'pages_with_truncated_links': sum(1 for page in pages if page.links_truncated),
        'orphan_check': orphans_checkable(pages, crawl_complete),
    })
    summary = summarize(store.issues(audit_id), int(audit.get('pages_crawled', 0)))
    return {
        'status': 'completed', 'phase': 'done', 'completed_at': completed_at, 'summary': summary,
        'crawl_complete': crawl_complete, 'throttle': fetcher.throttle.to_state(),
        'ai_readiness': {
            'robots_status': policy.status,
            'robots_kind': policy.kind,
            'bots': [access.as_json() for access in accesses],
            'llms_txt': llms.state if llms is not None else 'not_checked',
        },
    }
